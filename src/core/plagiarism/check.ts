import { mapLimit, RequestBudgetExceeded } from "../infra/http.ts";
import { maskProtected } from "../text/protect.ts";
import { blankQuotedText, splitReferences } from "../text/sections.ts";
import { tokenize } from "../text/tokens.ts";
import { buildBodyIndex, findRuns, findSelfRepeats, type Run } from "./match.ts";
import { findParaphrases } from "./paraphrase.ts";
import { selectPassages } from "./passages.ts";
import type { SourceDoc, SourceProvider } from "./providers.ts";
import type { LibraryDoc, MatchedSource, MatchedSpan, PlagiarismReport, PlagiarismVerdict, ProviderStat } from "./types.ts";

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

  const found = new Map<string, { doc: SourceDoc; runs: Run[] }>();
  // Every document seen, for the paraphrase pass (capped to bound the work).
  const seen = new Map<string, SourceDoc>();
  const addDoc = (doc: SourceDoc) => {
    if (doc.text.trim() === "") return;
    if (!seen.has(doc.id) && seen.size < 500) seen.set(doc.id, doc);
    if (found.has(doc.id)) return;
    const words = tokenize(doc.text).map((t) => t.word);
    const runs = findRuns(index, words, matchOpts);
    if (runs.length) found.set(doc.id, { doc, runs });
  };

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
    const passages = selectPassages(working, maxPassages);
    const jobs = passages.flatMap((p) => providers.map((provider) => ({ p, provider })));
    let done = 0;
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
        if (s.failures === 1) warnings.push(`${provider.name} could not be reached for some queries: ${err instanceof Error ? err.message : "unknown error"}.`);
      }
      options.onProgress?.(++done, jobs.length);
    });
    if (passages.length === 0) warnings.push("No passage was distinctive enough to search for.");
    for (const s of stats.values()) {
      if (s.queries > 0 && s.failures === s.queries) warnings.push(`${s.name} failed for every query, so it contributed nothing.`);
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

  const spans: MatchedSpan[] = [];
  let matchedWords = 0;
  for (let t = 0; t < tokens.length; ) {
    if ((covering[t] as number[]).length === 0) {
      t++;
      continue;
    }
    let end = t;
    while (end < tokens.length && (covering[end] as number[]).length > 0) end++;
    const ids = new Set<number>();
    for (let k = t; k < end; k++) for (const i of covering[k] as number[]) ids.add(i);
    const start = (tokens[t] as { start: number }).start;
    const stop = (tokens[end - 1] as { end: number }).end;
    spans.push({
      start,
      end: stop,
      words: end - t,
      text: body.slice(start, stop).replace(/\s+/g, " "),
      sourceIds: [...ids].sort((a, b) => (rank.get(a) as number) - (rank.get(b) as number)).map((i) => (entries[i] as { doc: SourceDoc }).doc.id),
    });
    matchedWords += end - t;
    t = end;
  }

  const sources: MatchedSource[] = order.map((i) => {
    const { doc } = entries[i] as { doc: SourceDoc };
    const n = perSource[i] as number;
    return {
      id: doc.id,
      title: doc.title,
      kind: doc.kind,
      provider: doc.provider,
      matchedWords: n,
      percent: round1((n / Math.max(1, tokens.length)) * 100),
      ...(doc.url ? { url: doc.url } : {}),
      ...(doc.doi ? { doi: doc.doi } : {}),
      ...(doc.year ? { year: doc.year } : {}),
      ...(doc.authors ? { authors: doc.authors } : {}),
    };
  });

  const similarity = tokens.length ? round1((matchedWords / tokens.length) * 100) : 0;

  // Reworded sentences: skip those already mostly covered by an exact match.
  const paraphrases =
    options.paraphrases === false
      ? []
      : findParaphrases(working, [...seen.values()].map((d) => ({ id: d.id, text: d.text }))).filter((pm) => {
          const inside = spans.filter((sp) => sp.start < pm.end && pm.start < sp.end).reduce((n, sp) => n + Math.min(sp.end, pm.end) - Math.max(sp.start, pm.start), 0);
          return inside < (pm.end - pm.start) * 0.5;
        });
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
      ...(doc.url ? { url: doc.url } : {}),
      ...(doc.doi ? { doi: doc.doi } : {}),
      ...(doc.year ? { year: doc.year } : {}),
      ...(doc.authors ? { authors: doc.authors } : {}),
    });
  }
  for (const pm of paraphrases) pm.text = body.slice(pm.start, pm.end).replace(/\s+/g, " ");
  return {
    similarity,
    verdict: verdictFor(similarity),
    words: tokens.length,
    matchedWords,
    spans,
    paraphrases,
    paraphrasePercent: tokens.length ? round1((paraphraseWords / tokens.length) * 100) : 0,
    sources,
    providers: [...stats.values()],
    excluded: { references: excludeRefs && split.referencesStart >= 0, quotes: excludeQuotes, referenceWords: tokenize(split.references).length },
    warnings,
    disclaimer: DISCLAIMER,
  };
}
