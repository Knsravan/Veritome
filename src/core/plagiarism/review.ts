import { TRICK_TEXT } from "../integrity/tricks.ts";
import { verdictFor } from "./check.ts";
import type { MatchedSource, MatchedSpan, ParaphraseSpan, PlagiarismReport, PlagiarismVerdict, QuotedPassage } from "./types.ts";

/** What kind of mistake a finding points to, from most to least serious. */
export type IssueKind = "copied_uncited" | "disguised" | "tortured" | "copied_cited" | "own_work" | "translated" | "reworded_uncited" | "quote_uncited" | "reworded_cited" | "repeated";

export interface Issue {
  kind: IssueKind;
  start: number;
  end: number;
  words: number;
  text: string;
  /** The source the passage is credited to, when there is one. */
  sourceId?: string;
  citation?: string;
  /** A short note specific to this finding, such as the standard term a mangled phrase replaced. */
  note?: string;
}

export const ISSUE_TEXT: Record<IssueKind, { title: string; why: string; fix: string; serious: boolean }> = {
  copied_uncited: {
    title: "Copied without a citation",
    why: "These words appear in a published source and nothing here says where they came from. Editors treat this as plagiarism.",
    fix: "Rewrite the idea in your own words and cite the source, or put the exact words in quotation marks and cite the source.",
    serious: true,
  },
  disguised: {
    title: "Disguised text",
    why: "The text has been altered so that it looks normal but checkers cannot read it: letters swapped for look-alikes from another alphabet, invisible characters or hidden text. Turnitin and journal editors treat this as a deliberate attempt to hide copying.",
    fix: "Retype the passage normally. If it came from a source, quote or rewrite it and cite the source.",
    serious: true,
  },
  tortured: {
    title: "Phrase typical of a paraphrasing tool",
    why: "A standard term has been replaced by an odd synonym phrase (for example “counterfeit consciousness” for “artificial intelligence”). Tools that swap words to hide copying produce these, and journals now screen for them.",
    fix: "Use the standard term, then compare the passage with its original source and cite it.",
    serious: true,
  },
  copied_cited: {
    title: "Cited, but copied word for word without quotation marks",
    why: "You credit the source, but using its exact words without quotation marks still counts as plagiarism in most style guides.",
    fix: "Put the copied words in quotation marks, or rewrite them in your own words and keep the citation.",
    serious: true,
  },
  own_work: {
    title: "Reused from your own earlier paper",
    why: "These words also appear in one of your published papers. Reusing your own published text without saying so is called text recycling or self-plagiarism; most journals ask you to cite the earlier paper, and some limit reused text even then.",
    fix: "Cite your earlier paper where you reuse its wording, and rewrite background and methods text where you can.",
    serious: false,
  },
  translated: {
    title: "Translated from a source without a citation",
    why: "This sentence says the same as a sentence in an English source, translated. Translating someone else's text does not make it your own; it is still plagiarism without a citation.",
    fix: "Cite the source, and write the idea in your own words rather than translating it.",
    serious: true,
  },
  reworded_uncited: {
    title: "Reworded from a source without a citation",
    why: "The sentence says the same thing as a source sentence in different words. Rewording does not remove the need to credit the idea.",
    fix: "Add a citation to the source, or check that the idea really is your own.",
    serious: false,
  },
  quote_uncited: {
    title: "Quotation without a citation",
    why: "Quoted words are left out of the score, but every quotation must say where it comes from.",
    fix: "Add a citation right after the quotation.",
    serious: false,
  },
  reworded_cited: {
    title: "Closely reworded, but cited",
    why: "The source is credited. Very close rewording can still read as patchwriting.",
    fix: "Usually fine. If the sentence follows the source's structure closely, rewrite it more freely.",
    serious: false,
  },
  repeated: {
    title: "Repeated within your own text",
    why: "The same long run of words appears twice in your document. It is counted in the score because checkers such as Turnitin count it too.",
    fix: "Fine for a definition or a repeated method step; otherwise cut or rephrase the second copy.",
    serious: false,
  },
};

const ORDER: IssueKind[] = ["copied_uncited", "disguised", "tortured", "copied_cited", "own_work", "translated", "reworded_uncited", "quote_uncited", "reworded_cited", "repeated"];
const countWords = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;

export interface ReviewFilters {
  /** Hide word-for-word matches shorter than this. Default 0 (show all). */
  minWords?: number;
  /** Source ids to leave out, such as the author's own preprint. */
  excludeSources?: ReadonlySet<string>;
}

/** A credited source, with the other services where the same work was found. */
export type ReviewedSource = MatchedSource & { alsoAt: string[] };

/** Titles that differ only in case, punctuation or an arXiv-style "[1512.03385]" prefix name the same work. */
export function sameWorkKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/^\[[^\]]*\]\s*/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface ReviewedReport {
  similarity: number;
  verdict: PlagiarismVerdict;
  matchedWords: number;
  spans: MatchedSpan[];
  paraphrases: ParaphraseSpan[];
  paraphrasePercent: number;
  /** Sources that are credited with at least one passage, best first. */
  primary: ReviewedSource[];
  /** Sources that also contain matched passages but are not credited with any. */
  others: MatchedSource[];
  issues: Issue[];
  /** Words in each kind of issue (quotation issues count quotations, not words). */
  breakdown: Record<IssueKind, number>;
  hidden: { smallMatches: number; excludedSources: number };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Applies the reader's filters and sorts every finding into a kind of mistake. Pure, so the page can
 * recompute it instantly when a filter changes.
 */
export function reviewReport(report: PlagiarismReport, filters: ReviewFilters = {}): ReviewedReport {
  const minWords = filters.minWords ?? 0;
  const excluded = filters.excludeSources ?? new Set<string>();
  const total = Math.max(1, report.words);
  let smallMatches = 0;

  const spans: MatchedSpan[] = [];
  for (const sp of report.spans) {
    const ids = sp.sourceIds.filter((id) => !excluded.has(id));
    if (!ids.length) continue;
    if (sp.words < minWords) {
      smallMatches++;
      continue;
    }
    if (ids.length === sp.sourceIds.length) spans.push(sp);
    else if (ids[0] === sp.sourceIds[0]) spans.push({ ...sp, sourceIds: ids });
    else {
      // The credited source was excluded, so its excerpt no longer applies.
      const { sourceExcerpt: _dropped, ...rest } = sp;
      spans.push({ ...rest, sourceIds: ids });
    }
  }
  const paraphrases = report.paraphrases.filter((p) => !excluded.has(p.sourceId));

  const matchedWords = spans.reduce((n, s) => n + s.words, 0);
  const credited = new Map<string, number>();
  for (const sp of spans) credited.set(sp.sourceIds[0] as string, (credited.get(sp.sourceIds[0] as string) ?? 0) + sp.words);
  const touched = new Set(spans.flatMap((s) => s.sourceIds));
  for (const p of paraphrases) touched.add(p.sourceId);
  const translated = (report.translated ?? []).filter((t) => !excluded.has(t.sourceId) && !t.cited);
  for (const t of translated) touched.add(t.sourceId);
  const visible = report.sources.filter((s) => !excluded.has(s.id) && touched.has(s.id));
  const withCredit = visible.map((s) => {
    const w = credited.get(s.id) ?? 0;
    return { ...s, primaryWords: w, primaryPercent: round1((w / total) * 100) };
  });
  const rewordedOnly = new Set([...paraphrases.map((p) => p.sourceId), ...translated.map((t) => t.sourceId)]);
  const primary = withCredit
    .filter((s) => s.primaryWords > 0 || (rewordedOnly.has(s.id) && !spans.some((sp) => sp.sourceIds.includes(s.id))))
    .sort((a, b) => b.primaryWords - a.primaryWords || b.matchedWords - a.matchedWords);
  // Copies of a credited work found through another service are folded into it.
  const keyed = new Map(primary.map((s) => [sameWorkKey(s.title), s.id]));
  const alsoAt = new Map<string, Set<string>>();
  const others = withCredit.filter((s) => {
    if (primary.includes(s)) return false;
    const owner = keyed.get(sameWorkKey(s.title));
    if (owner === undefined) return true;
    if (!alsoAt.has(owner)) alsoAt.set(owner, new Set());
    alsoAt.get(owner)!.add(s.provider);
    return false;
  });

  const ownIds = new Set(report.sources.filter((x) => x.kind === "own").map((x) => x.id));
  const issues: Issue[] = [
    ...spans.map((sp) => ({
        kind: (sp.sourceIds[0] === "self" ? "repeated" : ownIds.has(sp.sourceIds[0]!) ? "own_work" : sp.cited ? "copied_cited" : "copied_uncited") as IssueKind,
        start: sp.start,
        end: sp.end,
        words: sp.words,
        text: sp.text,
        sourceId: sp.sourceIds[0] as string,
        ...(sp.citation ? { citation: sp.citation } : {}),
    })),
    ...paraphrases.map((p) => ({
      kind: (p.cited ? "reworded_cited" : "reworded_uncited") as IssueKind,
      start: p.start,
      end: p.end,
      words: countWords(p.text),
      text: p.text,
      sourceId: p.sourceId,
    })),
    ...(report.quotes ?? [])
      .filter((q: QuotedPassage) => !q.cited)
      .map((q) => ({ kind: "quote_uncited" as IssueKind, start: q.start, end: q.end, words: countWords(q.text), text: q.text })),
    ...translated.map((t) => ({
      kind: "translated" as IssueKind,
      start: t.start,
      end: t.end,
      words: countWords(t.text),
      text: t.text,
      sourceId: t.sourceId,
      note: `In English: “${t.english}”`,
    })),
    ...(report.disguises ?? []).map((d) => ({
      kind: "disguised" as IssueKind,
      start: d.start,
      end: d.end,
      words: Math.max(1, countWords(d.text)),
      text: d.text.replace(/\s+/g, " "),
      note: `${TRICK_TEXT[d.kind].title}. ${TRICK_TEXT[d.kind].why}`,
    })),
    ...(report.tortured ?? []).map((t) => ({
      kind: "tortured" as IssueKind,
      start: t.start,
      end: t.end,
      words: countWords(t.text),
      text: t.text,
      note: `Most likely replaces “${t.expected}”.`,
    })),
  ].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.words - a.words);

  const breakdown = Object.fromEntries(ORDER.map((k) => [k, 0])) as Record<IssueKind, number>;
  for (const i of issues) breakdown[i.kind] += i.kind === "quote_uncited" ? 1 : i.words;

  const similarity = report.words ? round1((matchedWords / report.words) * 100) : 0;
  const paraphraseWords = paraphrases.reduce((n, p) => n + countWords(p.text), 0);
  return {
    similarity,
    verdict: verdictFor(similarity),
    matchedWords,
    spans,
    paraphrases,
    paraphrasePercent: report.words ? round1((paraphraseWords / report.words) * 100) : 0,
    primary: primary.map((s) => ({ ...s, alsoAt: [...(alsoAt.get(s.id) ?? [])].filter((p) => p !== s.provider) })),
    others,
    issues,
    breakdown,
    hidden: { smallMatches, excludedSources: excluded.size },
  };
}
