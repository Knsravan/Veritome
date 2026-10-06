import { protect } from "../text/protect.ts";
import { splitSentences } from "../text/sentences.ts";
import { contentStems } from "../text/similarity.ts";
import { countWords, isStopword, tokenize } from "../text/tokens.ts";
import type { ArxivClient } from "./sources/arxiv.ts";
import { dedupeWorks } from "./sources/common.ts";
import type { CrossrefClient } from "./sources/crossref.ts";
import type { OpenAlexClient } from "./sources/openalex.ts";
import type { SemanticScholarClient } from "./sources/semanticscholar.ts";
import type { Work } from "./types.ts";

// ---------------------------------------------------------------------------
// Which sentences need a citation?
// ---------------------------------------------------------------------------

export interface ClaimCandidate {
  start: number;
  end: number;
  text: string;
  /** Higher means the sentence more clearly states something that needs support. */
  score: number;
  reasons: string[];
}

interface Cue {
  re: RegExp;
  weight: number;
  reason: string;
}

const CUES: Cue[] = [
  { re: /\b(?:studies|research|evidence|literature|trials|surveys|analyses|reviews|reports|experiments)\s+(?:\w+\s+){0,3}?(?:show|suggest|indicate|demonstrate|reveal|report|found|confirm|support)/i, weight: 3, reason: "refers to prior studies" },
  { re: /\b(?:has|have|had)\s+been\s+(?:\w+ly\s+)?(?:shown|demonstrated|reported|found|proposed|used|observed|established|documented|suggested|argued)/i, weight: 3, reason: "says something has been shown or reported" },
  { re: /\baccording to\b/i, weight: 3, reason: "attributes a statement to a source" },
  { re: /\b(?:it is|is)\s+(?:well|widely|generally|commonly)\s+(?:known|established|accepted|recognised|recognized|documented)/i, weight: 3, reason: "claims general acceptance" },
  { re: /\b\d+(?:\.\d+)?\s?(?:%|(?:percent|per cent|fold|times)\b)/i, weight: 2, reason: "states a figure" },
  { re: /\b(?:increased|elevated|reduced|decreased|higher|lower)\s+(?:risk|likelihood|odds|incidence|prevalence|mortality)\b/i, weight: 1, reason: "claims a change in risk or rate" },
  { re: /\b(?:significantly|substantially|markedly)\s+(?:higher|lower|more|less|greater|reduced|increased|improved)/i, weight: 2, reason: "makes a comparative claim" },
  { re: /\b(?:is|are|was|were)\s+(?:strongly\s+|positively\s+|negatively\s+)?(?:associated|correlated|linked)\s+with\b/i, weight: 2, reason: "claims an association" },
  { re: /\b(?:causes?|leads? to|results? in|contributes? to|increases? the risk|reduces? the risk)\b/i, weight: 1, reason: "claims a causal link" },
  { re: /\b(?:leading|major|main|primary|most common)\s+(?:cause|reason|factor|source|challenge|limitation)\b/i, weight: 2, reason: "makes a general claim about importance" },
  { re: /\b(?:typically|commonly|generally|frequently|traditionally|widely)\b/i, weight: 1, reason: "makes a generalisation" },
  { re: /\b(?:is|are)\s+(?:considered|thought|believed|regarded|assumed)\s+to\b/i, weight: 2, reason: "reports a belief that needs a source" },
  { re: /\b(?:growing|increasing|rising)\s+(?:number|evidence|interest|body)/i, weight: 2, reason: "claims a trend" },
  // Statements about the authors' own work usually do not need a citation.
  { re: /\b(?:we|our|this (?:study|paper|work|article|section|chapter)|in this (?:study|paper|work|article|section))\b/i, weight: -3, reason: "describes the authors' own work" },
  { re: /\b(?:fig(?:ure)?s?\.?|tables?)\s+\d+\s+(?:shows?|presents?|lists?|summari[sz]es?)/i, weight: -3, reason: "refers to a figure or table" },
  { re: /\b(?:as (?:shown|described|illustrated) (?:in|below|above)|see (?:section|figure|table))\b/i, weight: -3, reason: "cross-reference" },
];

/** Sentences that probably state something needing a citation but have none yet. */
export function findClaimsNeedingCitations(text: string, options: { minScore?: number } = {}): ClaimCandidate[] {
  const minScore = options.minScore ?? 3;
  const { masked, spans } = protect(text);
  const hasCite = (start: number, end: number) => spans.some((s) => s.kind === "cite" && s.start >= start && s.end <= end);

  // Sentence offsets are computed on the original text so they can be used by the caller directly.
  const out: ClaimCandidate[] = [];
  for (const s of splitSentences(text)) {
    if (countWords(s.text) < 8 || /\?$/.test(s.text) || hasCite(s.start, s.end)) continue;
    const reasons: string[] = [];
    let score = 0;
    for (const cue of CUES) {
      if (cue.re.test(s.text)) {
        score += cue.weight;
        if (cue.weight > 0) reasons.push(cue.reason);
      }
    }
    if (score >= minScore) out.push({ start: s.start, end: s.end, text: s.text, score, reasons });
  }
  void masked;
  return out;
}

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

const GENERIC = new Set(
  "study studies research result results show shown shows found finding findings suggest suggests indicate indicates significantly however therefore thus also many much more most several various different similar recent recently previous previously increasingly widely commonly typically generally often well known based using used use paper work approach method methods analysis case cases new high higher low lower large larger small smaller number data effect effects possible make makes made allow allows allowed enable enables solely very able".split(
    " ",
  ),
);

/** The handful of words that best identify what a sentence is about, in their original order. */
export function extractKeyphrases(sentence: string, max = 7): string[] {
  const tokens = tokenize(sentence);
  const scored = new Map<string, { score: number; first: number }>();
  tokens.forEach((t, i) => {
    const word = t.word;
    const isAcronym = /^[A-Z]{2,6}$/.test(t.raw);
    if (!isAcronym && (word.length < 4 || isStopword(word) || GENERIC.has(word) || /^\d+$/.test(word))) return;
    const midSentenceCapital = i > 0 && /^[A-Z]/.test(t.raw) && !isAcronym;
    const score = word.length + (isAcronym ? 4 : 0) + (midSentenceCapital ? 3 : 0) + (word.includes("-") ? 2 : 0);
    const existing = scored.get(word);
    if (existing) existing.score += 1;
    else scored.set(word, { score, first: i });
  });
  return [...scored.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, max)
    .sort((a, b) => a[1].first - b[1].first)
    .map(([word]) => word);
}

export function buildQuery(sentence: string): string {
  return extractKeyphrases(sentence).join(" ");
}

export interface CitationSuggestion {
  work: Work;
  /** 0 to 1. A guide to topical overlap only; read the paper before citing it. */
  relevance: number;
  matchedTerms: string[];
  reason: string;
}

function stemSequence(text: string): string[] {
  return contentStems(text);
}

/** Ranks candidate papers by overlap with the claim, with a small boost for well-cited work. */
export function rankWorks(claim: string, works: readonly Work[]): CitationSuggestion[] {
  const claimWords = extractKeyphrases(claim, 12);
  const queryStems = [...new Set(claimWords.flatMap((w) => stemSequence(w)))];
  if (queryStems.length === 0) return [];
  const stemToWord = new Map<string, string>();
  for (const w of claimWords) for (const s of stemSequence(w)) stemToWord.set(s, w);

  const ranked: CitationSuggestion[] = [];
  for (const work of works) {
    const titleSeq = stemSequence(work.title);
    const abstractSeq = work.abstract ? stemSequence(work.abstract) : [];
    const titleSet = new Set(titleSeq);
    const abstractSet = new Set(abstractSeq);
    const inTitle = queryStems.filter((s) => titleSet.has(s));
    const inAbstract = queryStems.filter((s) => abstractSet.has(s));
    const titleHit = inTitle.length / queryStems.length;
    const abstractHit = abstractSeq.length > 0 ? inAbstract.length / queryStems.length : titleHit * 0.5;

    let adjacentPairs = 0;
    const seq = abstractSeq.length > 0 ? [...titleSeq, "|", ...abstractSeq] : titleSeq;
    for (let i = 0; i + 1 < seq.length; i++) {
      const a = seq[i] as string;
      const b = seq[i + 1] as string;
      if (queryStems.includes(a) && queryStems.includes(b) && a !== b) adjacentPairs++;
    }
    const bigram = Math.min(1, adjacentPairs / 3);

    const topical = 0.55 * titleHit + 0.3 * abstractHit + 0.15 * bigram;
    // Well-cited work is usually what reviewers expect to see cited, so citations count
    // for a quarter of the score once the topic clearly matches.
    const prior = Math.min(1, Math.log10(1 + (work.citationCount ?? 0)) / 5);
    let relevance = topical >= 0.3 ? topical * 0.75 + prior * 0.25 : topical * 0.75;
    let reason = `Matches ${new Set([...inTitle, ...inAbstract]).size} of ${queryStems.length} key terms${inTitle.length ? ` (${inTitle.length} in the title)` : ""}.`;
    if (work.retraction) {
      relevance *= 0.2;
      reason = `Marked ${work.retraction.status.replace(/_/g, " ")}; do not cite without checking the notice.`;
    }
    if (relevance < 0.18) continue;
    const matchedTerms = [...new Set([...inTitle, ...inAbstract].map((s) => stemToWord.get(s) ?? s))];
    ranked.push({ work, relevance: Math.round(relevance * 1000) / 1000, matchedTerms, reason });
  }
  return ranked.sort((a, b) => b.relevance - a.relevance);
}

export interface FinderDeps {
  openalex?: Pick<OpenAlexClient, "search">;
  semanticscholar?: Pick<SemanticScholarClient, "search">;
  crossref?: Pick<CrossrefClient, "search" | "searchMostCited">;
  arxiv?: Pick<ArxivClient, "search">;
}

export interface SuggestOptions {
  limit?: number;
  /** Ignore papers older than this year. */
  yearFrom?: number;
}

export interface SuggestResult {
  query: string;
  suggestions: CitationSuggestion[];
  warnings: string[];
}

/** Searches several scholarly databases for papers that could support a claim. */
export async function suggestCitations(claim: string, deps: FinderDeps, options: SuggestOptions = {}): Promise<SuggestResult> {
  const query = buildQuery(claim);
  const warnings: string[] = [];
  if (!query) return { query, suggestions: [], warnings: ["The sentence has too few distinctive words to search for."] };

  const jobs: Array<[string, Promise<Work[]>]> = [];
  if (deps.openalex) jobs.push(["OpenAlex", deps.openalex.search(query, 15)]);
  if (deps.semanticscholar) jobs.push(["Semantic Scholar", deps.semanticscholar.search(query, 15)]);
  if (deps.crossref) jobs.push(["Crossref", deps.crossref.search(query, 10)]);
  if (deps.crossref?.searchMostCited) jobs.push(["Crossref (most cited)", deps.crossref.searchMostCited(query, 20)]);
  if (deps.arxiv) jobs.push(["arXiv", deps.arxiv.search(query, 8)]);

  const settled = await Promise.allSettled(jobs.map(([, p]) => p));
  const works: Work[] = [];
  settled.forEach((r, i) => {
    const name = jobs[i]?.[0] ?? "source";
    if (r.status === "fulfilled") works.push(...r.value);
    else warnings.push(`${name} could not be searched (${r.reason instanceof Error ? r.reason.message : "error"}).`);
  });

  let merged = dedupeWorks(works);
  if (options.yearFrom !== undefined) merged = merged.filter((w) => (w.year ?? Infinity) >= (options.yearFrom as number));
  const suggestions = rankWorks(claim, merged).slice(0, options.limit ?? 5);
  if (suggestions.length === 0 && warnings.length < jobs.length) warnings.push("No close matches found. Try rewording the claim or check the topic's key terms.");
  return { query, suggestions, warnings };
}
