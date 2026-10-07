import { verdictFor } from "./check.ts";
import type { MatchedSource, MatchedSpan, ParaphraseSpan, PlagiarismReport, PlagiarismVerdict, QuotedPassage } from "./types.ts";

/** What kind of mistake a finding points to, from most to least serious. */
export type IssueKind = "copied_uncited" | "copied_cited" | "reworded_uncited" | "quote_uncited" | "reworded_cited" | "repeated";

export interface Issue {
  kind: IssueKind;
  start: number;
  end: number;
  words: number;
  text: string;
  /** The source the passage is credited to, when there is one. */
  sourceId?: string;
  citation?: string;
}

export const ISSUE_TEXT: Record<IssueKind, { title: string; why: string; fix: string; serious: boolean }> = {
  copied_uncited: {
    title: "Copied without a citation",
    why: "These words appear in a published source and nothing here says where they came from. Editors treat this as plagiarism.",
    fix: "Rewrite the idea in your own words and cite the source, or put the exact words in quotation marks and cite the source.",
    serious: true,
  },
  copied_cited: {
    title: "Cited, but copied word for word without quotation marks",
    why: "You credit the source, but using its exact words without quotation marks still counts as plagiarism in most style guides.",
    fix: "Put the copied words in quotation marks, or rewrite them in your own words and keep the citation.",
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

const ORDER: IssueKind[] = ["copied_uncited", "copied_cited", "reworded_uncited", "quote_uncited", "reworded_cited", "repeated"];
const countWords = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;

export interface ReviewFilters {
  /** Hide word-for-word matches shorter than this. Default 0 (show all). */
  minWords?: number;
  /** Source ids to leave out, such as the author's own preprint. */
  excludeSources?: ReadonlySet<string>;
}

export interface ReviewedReport {
  similarity: number;
  verdict: PlagiarismVerdict;
  matchedWords: number;
  spans: MatchedSpan[];
  paraphrases: ParaphraseSpan[];
  paraphrasePercent: number;
  /** Sources that are credited with at least one passage, best first. */
  primary: MatchedSource[];
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
  const visible = report.sources.filter((s) => !excluded.has(s.id) && touched.has(s.id));
  const withCredit = visible.map((s) => {
    const w = credited.get(s.id) ?? 0;
    return { ...s, primaryWords: w, primaryPercent: round1((w / total) * 100) };
  });
  const rewordedOnly = new Set(paraphrases.map((p) => p.sourceId));
  const primary = withCredit
    .filter((s) => s.primaryWords > 0 || (rewordedOnly.has(s.id) && !spans.some((sp) => sp.sourceIds.includes(s.id))))
    .sort((a, b) => b.primaryWords - a.primaryWords || b.matchedWords - a.matchedWords);
  const others = withCredit.filter((s) => !primary.includes(s));

  const issues: Issue[] = [
    ...spans.map((sp) => ({
        kind: (sp.sourceIds[0] === "self" ? "repeated" : sp.cited ? "copied_cited" : "copied_uncited") as IssueKind,
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
    primary,
    others,
    issues,
    breakdown,
    hidden: { smallMatches, excludedSources: excluded.size },
  };
}
