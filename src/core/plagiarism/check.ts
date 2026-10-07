import { mapLimit, RequestBudgetExceeded } from "../infra/http.ts";
import { maskProtected } from "../text/protect.ts";
import { findInTextCitations } from "../citations/intext.ts";
import { blankQuotedText, splitReferences } from "../text/sections.ts";
import { splitSentences } from "../text/sentences.ts";
import { tokenize, type Token } from "../text/tokens.ts";
import { buildBodyIndex, findRuns, findSelfRepeats, type Run } from "./match.ts";
import { cleanForSearch, findTricks, type TrickFlag } from "../integrity/tricks.ts";
import { findTorturedPhrases } from "../integrity/tortured.ts";
import { findParaphrases } from "./paraphrase.ts";
import { selectPassages } from "./passages.ts";
import type { SourceDoc, SourceProvider } from "./providers.ts";
import type {
  LibraryDoc,
  MatchedSource,
  MatchedSpan,
  ParaphraseSpan,
  PlagiarismReport,
  PlagiarismVerdict,
  ProviderStat,
  QuotedPassage,
  SourceExcerpt,
} from "./types.ts";

export interface PlagiarismOptions {
  providers?: SourceProvider[];
  library?: LibraryDoc[];
  minRun?: number;
  maxGap?: number;
  maxPassages?: number;
  concurrency?: number;
  excludeQuotes?: boolean;
  excludeReferences?: boolean;
  checkSelf?: boolean;
  /** Also look for reworded sentences. Default true. */
  paraphrases?: boolean;
  /** Hidden text found in the original file (white or tiny text), with offsets into the checked text. */
  hiddenText?: Array<{ start: number; end: number }>;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export const DISCLAIMER =
  "Veritome compares your text with titles, abstracts, snippets and any documents you supply. " +
  "It cannot read paywalled full texts or private repositories, so a low score is not proof of originality. " +
  "Treat every match as a lead to review, not a verdict.";

export function verdictFor(similarity: number): PlagiarismVerdict {
  return similarity < 10 ? "low" : similarity < 25 ? "moderate" : "high";
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A plain-language reason for a failed search, without URLs or status codes. */
export function failureReason(err: unknown): string {
  const m = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/\b429\b|rate.?limit|too many/i.test(m)) return "the service was busy and asked us to slow down";
  if (/timeout|timed out|abort/i.test(m)) return "the service did not answer in time";
  if (/\b5\d\d\b/.test(m)) return "the service had a server error";
  if (/\b40[13]\b/.test(m)) return "the service refused the request; an API key may be needed";
  return "the service could not be reached";
}

const yearOf = (e: { doc: SourceDoc }) => e.doc.year ?? 9999;

/**
 * Returns a function that finds an in-text citation in the sentence(s) around a range of the body, or the next
 * sentence when it is short (a citation is sometimes left on its own after a long quotation).
 */
export function citationFinder(body: string): (start: number, end: number) => string | undefined {
  const cites = findInTextCitations(body);
  const sentences = splitSentences(body);
  return (start, end) => {
    const inside = sentences.filter((x) => x.end > start && x.start < end);
    const from = Math.min(start, inside[0]?.start ?? start);
    const to = Math.max(end, inside[inside.length - 1]?.end ?? end);
    return cites.find((c) => c.start >= from && c.start <= to)?.raw;
  };
}

/** Quotations long enough to be left out of the score (the same rule as blankQuotedText). */
export function findQuotations(body: string, minLength = 40): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = [];
  for (const m of body.matchAll(/(["“])([^"“”\n]{1,2000}?)(["”])/g)) {
    if (m[0].length < minLength) continue;
    out.push({ start: m.index, end: m.index + m[0].length, text: m[0].replace(/\s+/g, " ") });
  }
  return out;
}

/** The credited source's own wording for a passage, with about 15 words of context either side. */
function sourceExcerpt(entry: { doc: SourceDoc; runs: Run[] }, srcTokens: Token[], from: number, to: number): SourceExcerpt | undefined {
  let best: Run | undefined;
  let bestOverlap = 0;
  for (const r of entry.runs) {
    const overlap = Math.min(r.end, to) - Math.max(r.start, from);
    if (overlap > bestOverlap) [best, bestOverlap] = [r, overlap];
  }
  if (!best || !srcTokens.length) return undefined;
  const a = Math.min(srcTokens.length - 1, Math.max(0, best.sourceStart + Math.max(0, from - best.start)));
  const b = Math.min(srcTokens.length - 1, a + Math.max(1, Math.min(best.end, to) - Math.max(best.start, from)) - 1);
  const ctxA = Math.max(0, a - 15);
  const ctxB = Math.min(srcTokens.length - 1, b + 15);
  const base = (srcTokens[ctxA] as Token).start;
  const text = entry.doc.text.slice(base, (srcTokens[ctxB] as Token).end);
  return {
    text: `${ctxA > 0 ? "…" : ""}${text}${ctxB < srcTokens.length - 1 ? "…" : ""}`.replace(/\s+/g, " "),
    // Offsets are recomputed after whitespace collapsing below.
    ...collapsedOffsets(entry.doc.text, base, (srcTokens[a] as Token).start, (srcTokens[b] as Token).end, ctxA > 0 ? 1 : 0),
  };
}

/** Maps offsets in the original source text to offsets in the excerpt after whitespace runs become single spaces. */
function collapsedOffsets(src: string, base: number, start: number, end: number, prefix: number): { matchStart: number; matchEnd: number } {
  const collapse = (s: string) => s.replace(/\s+/g, " ").length;
  return { matchStart: prefix + collapse(src.slice(base, start)), matchEnd: prefix + collapse(src.slice(base, end)) };
}

export async function checkPlagiarism(text: string, options: PlagiarismOptions = {}): Promise<PlagiarismReport> {
  const providers = options.providers ?? [];
  const excludeRefs = options.excludeReferences ?? true;
  const excludeQuotes = options.excludeQuotes ?? true;
  const warnings: string[] = [];

  const split = excludeRefs ? splitReferences(text) : { body: text, references: "", referencesStart: -1 };
  const body = split.body;
  let working = maskProtected(body).masked;
  if (excludeQuotes) working = blankQuotedText(working);
  const tokens = tokenize(working);
  const index = buildBodyIndex(tokens);
  const matchOpts = {
    ...(options.minRun !== undefined ? { minRun: options.minRun } : {}),
    ...(options.maxGap !== undefined ? { maxGap: options.maxGap } : {}),
  };

  const stats = new Map<string, ProviderStat>();
  const stat = (name: string, kind: ProviderStat["kind"], coverage: string) => {
    let s = stats.get(name);
    if (!s) stats.set(name, (s = { name, kind, coverage, queries: 0, failures: 0, documents: 0 }));
    return s;
  };

  // Sentence of every token, to judge whether a short match is a whole copied sentence or a stock phrase.
  const sentenceOf = new Int32Array(tokens.length);
  const sentenceSize: number[] = [];
  {
    const sents = splitSentences(working);
    let k = 0;
    sents.forEach((sn, si) => {
      sentenceSize[si] = 0;
      while (k < tokens.length && (tokens[k] as Token).start < sn.end) {
        sentenceOf[k] = si;
        sentenceSize[si]!++;
        k++;
      }
    });
    for (; k < tokens.length; k++) sentenceOf[k] = Math.max(0, sents.length - 1);
  }
  const significant = (runs: Run[]): Run[] => {
    const total = runs.reduce((n, r) => n + (r.end - r.start), 0);
    if (total >= 15) return runs;
    const perSentence = new Map<number, number>();
    for (const r of runs) for (let t = r.start; t < r.end; t++) perSentence.set(sentenceOf[t]!, (perSentence.get(sentenceOf[t]!) ?? 0) + 1);
    // A short run on its own (such as "the association between air pollution and") is a stock phrase, not copying,
    // unless it has 8 or more words and makes up most of its sentence. Six-word sentences such as "Our results
    // agree with this view" are too common to count.
    return runs.filter(
      (r) => r.end - r.start >= 10 || (r.end - r.start >= 8 && (perSentence.get(sentenceOf[r.start]!) ?? 0) >= 0.5 * (sentenceSize[sentenceOf[r.start]!] ?? Infinity)),
    );
  };

  const found = new Map<string, { doc: SourceDoc; runs: Run[] }>();
  // Every document seen, for the paraphrase pass (capped to bound the work).
  const seen = new Map<string, SourceDoc>();
  const addDoc = (doc: SourceDoc) => {
    if (doc.text.trim() === "") return;
    if (!seen.has(doc.id) && seen.size < 500) seen.set(doc.id, doc);
    if (found.has(doc.id)) return;
    const words = tokenize(doc.text).map((t) => t.word);
    const runs = significant(findRuns(index, words, matchOpts));
    if (runs.length) found.set(doc.id, { doc, runs });
  };

  const searched: Array<{ start: number; end: number }> = [];
  if (tokens.length < 8) warnings.push("The text is too short for a meaningful similarity check.");

  // Library documents.
  if (options.library?.length) {
    const s = stat("Your library", "library", "Full text of the documents you supplied.");
    for (const lib of options.library) {
      s.documents++;
      addDoc({ id: `lib:${lib.id}`, title: lib.title, text: lib.text, provider: "Your library", kind: "library", ...(lib.url ? { url: lib.url } : {}) });
    }
  }

  // Repetition inside the manuscript itself.
  if (options.checkSelf ?? true) {
    const repeats = findSelfRepeats(tokens, 12);
    if (repeats.length) {
      const s = stat("This document", "self", "Passages repeated within the text you submitted.");
      s.documents = 1;
      found.set("self", {
        doc: { id: "self", title: "Repeated elsewhere in this document", text: "", provider: "This document", kind: "self" },
        runs: repeats.map((r) => r.second),
      });
    }
  }

  // External search.
  const maxPassages = options.maxPassages ?? 40;
  if (providers.length && tokens.length >= 8) {
    // Queries use the restored wording, so disguised letters do not hide a passage from the search.
    const passages = selectPassages(working, maxPassages).map((p) => ({
      ...p,
      text: cleanForSearch(p.text),
      phrase: cleanForSearch(p.phrase),
      ...(p.phrases ? { phrases: p.phrases.map(cleanForSearch) } : {}),
      keywords: cleanForSearch(p.keywords),
    }));
    searched.push(...passages.map((p) => ({ start: p.start, end: p.end })));
    const jobs = passages.flatMap((p) => providers.map((provider) => ({ p, provider })));
    let done = 0;
    const firstError = new Map<string, unknown>();
    // Paced providers wait between requests, so more workers keep the others busy meanwhile.
    await mapLimit(jobs, options.concurrency ?? 6, async ({ p, provider }) => {
      if (options.signal?.aborted) return;
      const s = stat(provider.name, provider.kind, provider.coverage);
      s.queries++;
      try {
        const docs = await provider.search(p, options.signal);
        for (const d of docs) {
          if (!found.has(d.id)) s.documents++;
          addDoc(d);
        }
      } catch (err) {
        if (err instanceof RequestBudgetExceeded) {
          s.queries--;
          s.skipped = (s.skipped ?? 0) + 1;
          options.onProgress?.(++done, jobs.length);
          return;
        }
        s.failures++;
        if (!firstError.has(provider.name)) firstError.set(provider.name, err);
      }
      options.onProgress?.(++done, jobs.length);
    });
    if (passages.length === 0) warnings.push("No passage was distinctive enough to search for.");
    for (const s of stats.values()) {
      if (s.failures > 0) {
        const why = failureReason(firstError.get(s.name));
        warnings.push(
          s.failures === s.queries
            ? `${s.name} could not be searched this time (${why}), so it contributed nothing.`
            : `${s.name} could not be searched for ${s.failures} of ${s.queries} passages (${why}).`,
        );
      }
      if (s.skipped) warnings.push(`${s.name} limits how often it can be searched, so only part of the text (${s.queries} of ${s.queries + s.skipped} passages) was checked against it.`);
    }
  } else if (providers.length === 0 && !options.library?.length) {
    warnings.push("No search providers or library documents were configured, so only repetition within the text was checked.");
  }

  // Aggregate the covered words and the sources that explain them.
  const covering: number[][] = tokens.map(() => []);
  const entries = [...found.values()];
  entries.forEach((e, i) => {
    for (const run of e.runs) for (let t = run.start; t < Math.min(run.end, tokens.length); t++) (covering[t] as number[]).push(i);
  });

  const perSource = entries.map((e) => {
    const covered = new Set<number>();
    for (const run of e.runs) for (let t = run.start; t < run.end; t++) covered.add(t);
    return covered.size;
  });
  const order = entries.map((_, i) => i).sort((a, b) => (perSource[b] as number) - (perSource[a] as number));
  const rank = new Map(order.map((idx, r) => [idx, r]));

  // Citations and sentence bounds, to tell a cited match from an uncited one.
  const citeCheck = citationFinder(body);
  const sourceTokens = new Map<number, Token[]>();
  const tokensOf = (i: number) => {
    let t = sourceTokens.get(i);
    if (!t) sourceTokens.set(i, (t = tokenize((entries[i] as { doc: SourceDoc }).doc.text)));
    return t;
  };

  const spans: MatchedSpan[] = [];
  const primaryWords = new Map<number, number>();
  let matchedWords = 0;
  for (let t = 0; t < tokens.length; ) {
    if ((covering[t] as number[]).length === 0) {
      t++;
      continue;
    }
    let end = t;
    while (end < tokens.length && (covering[end] as number[]).length > 0) end++;
    const inSpan = new Map<number, number>();
    for (let k = t; k < end; k++) for (const i of new Set(covering[k] as number[])) inSpan.set(i, (inSpan.get(i) ?? 0) + 1);
    // Best first: the source sharing most of this passage; on a tie, the oldest (most likely the original), then overall rank.
    const ids = [...inSpan.keys()].sort(
      (a, b) =>
        (inSpan.get(b) as number) - (inSpan.get(a) as number) ||
        yearOf(entries[a] as { doc: SourceDoc }) - yearOf(entries[b] as { doc: SourceDoc }) ||
        (rank.get(a) as number) - (rank.get(b) as number),
    );
    const primary = ids[0] as number;
    primaryWords.set(primary, (primaryWords.get(primary) ?? 0) + (end - t));
    const start = (tokens[t] as { start: number }).start;
    const stop = (tokens[end - 1] as { end: number }).end;
    const cite = citeCheck(start, stop);
    const excerpt = sourceExcerpt(entries[primary] as { doc: SourceDoc; runs: Run[] }, tokensOf(primary), t, end);
    spans.push({
      start,
      end: stop,
      words: end - t,
      text: body.slice(start, stop).replace(/\s+/g, " "),
      sourceIds: ids.map((i) => (entries[i] as { doc: SourceDoc }).doc.id),
      cited: Boolean(cite),
      ...(cite ? { citation: cite } : {}),
      ...(excerpt ? { sourceExcerpt: excerpt } : {}),
    });
    matchedWords += end - t;
    t = end;
  }

  const total = Math.max(1, tokens.length);
  const sources: MatchedSource[] = order
    .map((i) => {
      const { doc } = entries[i] as { doc: SourceDoc };
      const n = perSource[i] as number;
      const p = primaryWords.get(i) ?? 0;
      return {
        id: doc.id,
        title: doc.title,
        kind: doc.kind,
        provider: doc.provider,
        matchedWords: n,
        percent: round1((n / total) * 100),
        primaryWords: p,
        primaryPercent: round1((p / total) * 100),
        ...(doc.url ? { url: doc.url } : {}),
        ...(doc.doi ? { doi: doc.doi } : {}),
        ...(doc.year ? { year: doc.year } : {}),
        ...(doc.authors ? { authors: doc.authors } : {}),
      };
    })
    .sort((a, b) => b.primaryWords - a.primaryWords || b.matchedWords - a.matchedWords);

  const similarity = tokens.length ? round1((matchedWords / tokens.length) * 100) : 0;

  // Reworded sentences: skip those already mostly covered by an exact match.
  const reworded =
    options.paraphrases === false
      ? []
      : findParaphrases(working, [...seen.values()].map((d) => ({ id: d.id, text: d.text }))).filter((pm) => {
          const inside = spans.filter((sp) => sp.start < pm.end && pm.start < sp.end).reduce((n, sp) => n + Math.min(sp.end, pm.end) - Math.max(sp.start, pm.start), 0);
          return inside < (pm.end - pm.start) * 0.5;
        });
  const paraphrases: ParaphraseSpan[] = reworded.map((pm) => ({ ...pm, cited: Boolean(citeCheck(pm.start, pm.end)) }));
  const paraphraseWords = paraphrases.reduce((n, pm) => n + tokenize(pm.text).length, 0);
  // Sources that only explain reworded sentences still belong in the list.
  for (const pm of paraphrases) {
    if (sources.some((x) => x.id === pm.sourceId)) continue;
    const doc = seen.get(pm.sourceId);
    if (!doc) continue;
    sources.push({
      id: doc.id,
      title: doc.title,
      kind: doc.kind,
      provider: doc.provider,
      matchedWords: 0,
      percent: 0,
      primaryWords: 0,
      primaryPercent: 0,
      ...(doc.url ? { url: doc.url } : {}),
      ...(doc.doi ? { doi: doc.doi } : {}),
      ...(doc.year ? { year: doc.year } : {}),
      ...(doc.authors ? { authors: doc.authors } : {}),
    });
  }
  for (const pm of paraphrases) pm.text = body.slice(pm.start, pm.end).replace(/\s+/g, " ");
  const disguises: TrickFlag[] = [
    ...findTricks(body),
    ...(options.hiddenText ?? [])
      .filter((h) => h.end <= body.length && h.end > h.start)
      .map((h) => ({ kind: "hidden_text" as const, start: h.start, end: h.end, text: body.slice(h.start, h.end), count: h.end - h.start })),
  ].sort((a, b) => a.start - b.start);
  const tortured = findTorturedPhrases(body);
  if (disguises.length) warnings.push("Parts of the text were disguised (look-alike letters, invisible characters or hidden text). They were restored before checking.");
  const quotes: QuotedPassage[] = excludeQuotes ? findQuotations(body).map((q) => ({ ...q, cited: Boolean(citeCheck(q.start, q.end)) })) : [];
  return {
    similarity,
    verdict: verdictFor(similarity),
    words: tokens.length,
    matchedWords,
    spans,
    paraphrases,
    paraphrasePercent: tokens.length ? round1((paraphraseWords / tokens.length) * 100) : 0,
    sources,
    quotes,
    searched,
    providers: [...stats.values()],
    disguises,
    tortured,
    excluded: { references: excludeRefs && split.referencesStart >= 0, quotes: excludeQuotes, referenceWords: tokenize(split.references).length },
    warnings,
    disclaimer: DISCLAIMER,
  };
}
