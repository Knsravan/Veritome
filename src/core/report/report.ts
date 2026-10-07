import { findClaimsNeedingCitations, suggestCitations, type ClaimCandidate, type FinderDeps, type SuggestResult } from "../citations/finder.ts";
import { crossCheckCitations, type CitationCrossCheck } from "../citations/intext.ts";
import { parseReferenceList } from "../citations/parse.ts";
import type { ParsedReference } from "../citations/types.ts";
import { verifyReferences, type VerifierDeps, type VerifyListResult } from "../citations/verify.ts";
import { detectAiText } from "../detector/detect.ts";
import type { DetectorResult } from "../detector/types.ts";
import { checkGrammar, type GrammarCheckResult } from "../grammar/check.ts";
import type { LanguageToolOptions } from "../grammar/languagetool.ts";
import type { SpellChecker } from "../grammar/types.ts";
import type { LlmClient } from "../llm/client.ts";
import { checkPlagiarism } from "../plagiarism/check.ts";
import type { SourceProvider } from "../plagiarism/providers.ts";
import type { LibraryDoc, PlagiarismReport } from "../plagiarism/types.ts";
import { rewriteText } from "../rewrite/rewrite.ts";
import type { RewriteMode, RewriteResult } from "../rewrite/types.ts";
import { splitReferences } from "../text/sections.ts";
import { splitParagraphs, splitSentences } from "../text/sentences.ts";
import { countWords } from "../text/tokens.ts";

export type ToolId = "grammar" | "detector" | "plagiarism" | "citations" | "paraphrase" | "humanise";

export const TOOL_IDS: readonly ToolId[] = ["plagiarism", "detector", "citations", "grammar", "paraphrase", "humanise"];

export type Section<T> = { status: "done"; result: T } | { status: "skipped"; reason: string } | { status: "error"; message: string };

export interface ReportDeps {
  providers?: SourceProvider[];
  library?: LibraryDoc[];
  verifier?: VerifierDeps;
  finder?: FinderDeps;
  llm?: LlmClient;
  languageTool?: LanguageToolOptions;
  spellChecker?: SpellChecker;
}

export interface ReportOptions {
  /** Tools to run. All run by default. */
  tools?: Partial<Record<ToolId, boolean>>;
  /** How many uncited claims get paper suggestions. Default 3. */
  suggestFor?: number;
  /** How many passages get rewrite suggestions per rewriting tool. Default 2. */
  rewriteCount?: number;
  /** Largest reference list that is verified online. Default 150. */
  maxReferences?: number;
  signal?: AbortSignal;
  onProgress?: (tool: ToolId, state: "start" | "done") => void;
  /** Finer progress inside a tool, such as passages searched so far. */
  onStep?: (tool: ToolId, done: number, total: number) => void;
}

export interface CitationsSection {
  references: ParsedReference[];
  verification?: VerifyListResult;
  verificationSkipped?: string;
  crossCheck: CitationCrossCheck;
  claims: ClaimCandidate[];
  suggestions: Array<{ claim: ClaimCandidate } & SuggestResult>;
}

export interface RewriteSuggestion {
  reason: string;
  start: number;
  end: number;
  result: RewriteResult;
}

export type OverviewStatus = "ok" | "review" | "attention" | "skipped" | "error";

export interface OverviewItem {
  tool: ToolId;
  status: OverviewStatus;
  headline: string;
}

export interface PaperReport {
  generatedAt: string;
  words: number;
  hasReferenceList: boolean;
  overview: OverviewItem[];
  grammar: Section<GrammarCheckResult>;
  detector: Section<DetectorResult>;
  plagiarism: Section<PlagiarismReport>;
  citations: Section<CitationsSection>;
  paraphrase: Section<RewriteSuggestion[]>;
  humanise: Section<RewriteSuggestion[]>;
  disclaimer: string;
}

/** Events sent while a report is streamed to the browser. */
export type ReportEvent =
  | { type: "progress"; tool: ToolId; state: "start" | "done" }
  | { type: "step"; tool: ToolId; done: number; total: number }
  | { type: "result"; report: PaperReport }
  | { type: "error"; error: string };

export const REPORT_DISCLAIMER =
  "This report collects automated signals to help you review your manuscript. Every tool here can miss problems " +
  "and raise false alarms. Read each finding in context before acting on it, and do not treat any score as a " +
  "judgement about you or your work.";

async function run<T>(enabled: boolean, skipReason: string, fn: () => Promise<T | { skipped: string }>): Promise<Section<T>> {
  if (!enabled) return { status: "skipped", reason: skipReason };
  try {
    const result = await fn();
    if (result && typeof result === "object" && "skipped" in (result as object)) {
      return { status: "skipped", reason: (result as { skipped: string }).skipped };
    }
    return { status: "done", result: result as T };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Unexpected error." };
  }
}

/** Expands a character range to the sentences it touches. */
function sentenceRange(text: string, start: number, end: number): { start: number; end: number } {
  const sentences = splitSentences(text).filter((s) => s.end > start && s.start < end);
  if (sentences.length === 0) return { start, end };
  return { start: sentences[0]!.start, end: sentences[sentences.length - 1]!.end };
}

async function suggestRewrites(
  text: string,
  targets: ReadonlyArray<{ start: number; end: number; reason: string }>,
  mode: RewriteMode,
  llm: LlmClient | undefined,
  signal: AbortSignal | undefined,
): Promise<RewriteSuggestion[]> {
  const out: RewriteSuggestion[] = [];
  for (const t of targets) {
    const result = await rewriteText(text.slice(t.start, t.end), { mode, ...(llm ? { llm } : {}), ...(signal ? { signal } : {}) });
    out.push({ reason: t.reason, start: t.start, end: t.end, result });
  }
  return out;
}

export function buildOverview(r: Omit<PaperReport, "overview" | "generatedAt" | "disclaimer">): OverviewItem[] {
  const item = <T>(tool: ToolId, s: Section<T>, f: (x: T) => Omit<OverviewItem, "tool">): OverviewItem =>
    s.status === "done"
      ? { tool, ...f(s.result) }
      : s.status === "skipped"
        ? { tool, status: "skipped", headline: s.reason }
        : { tool, status: "error", headline: s.message };

  return [
    item("plagiarism", r.plagiarism, (p) => {
      const external = p.sources.filter((s) => s.kind !== "self").length;
      return {
        status: p.verdict === "high" ? "attention" : p.verdict === "moderate" || p.paraphrasePercent >= 5 ? "review" : "ok",
        headline: `${p.similarity}% of words match ${external} external source${external === 1 ? "" : "s"}${p.paraphrasePercent > 0 ? `, plus ${p.paraphrasePercent}% reworded` : ""}${p.providers.some((x) => x.kind !== "self") ? "" : " (no external search configured)"}.`,
      };
    }),
    item("detector", r.detector, (d) => ({
      status: d.verdict === "likely_ai" ? "attention" : d.verdict === "uncertain" ? "review" : d.verdict === "insufficient_text" ? "skipped" : "ok",
      headline:
        d.verdict === "insufficient_text"
          ? "Not enough text to judge."
          : `Pattern score ${d.score} (plausible range ${d.band.low} to ${d.band.high}).`,
    })),
    item("citations", r.citations, (c) => {
      const v = c.verification?.counts;
      const problems = (v ? v.mismatch + v.flagged + v.not_found : 0) + c.crossCheck.citedButMissing.length;
      const parts = [`${c.references.length} reference${c.references.length === 1 ? "" : "s"}`];
      if (v) parts.push(`${v.verified + v.likely} found online`, `${v.not_found} not found`, `${v.mismatch} mismatched`, `${v.flagged} flagged`);
      if (c.crossCheck.citedButMissing.length) parts.push(`${c.crossCheck.citedButMissing.length} in-text citations without an entry`);
      parts.push(`${c.claims.length} claim${c.claims.length === 1 ? "" : "s"} that may need a citation`);
      return { status: v && (v.mismatch > 0 || v.flagged > 0) ? "attention" : problems > 0 || c.claims.length > 0 ? "review" : "ok", headline: `${parts.join(", ")}.` };
    }),
    item("grammar", r.grammar, (g) => ({
      status: g.summary.score >= 85 ? "ok" : g.summary.score >= 65 ? "review" : "attention",
      headline: `${g.summary.total} issue${g.summary.total === 1 ? "" : "s"} (${g.summary.bySeverity.error} likely error${g.summary.bySeverity.error === 1 ? "" : "s"}), ${g.summary.issuesPer1000Words} per 1,000 words.`,
    })),
    item("paraphrase", r.paraphrase, (p) => ({
      status: p.length ? "review" : "ok",
      headline: p.length ? `${p.length} matched passage${p.length === 1 ? "" : "s"} with a suggested rewrite.` : "No matched passages to rewrite.",
    })),
    item("humanise", r.humanise, (h) => ({
      status: h.length ? "review" : "ok",
      headline: h.length ? `${h.length} formulaic passage${h.length === 1 ? "" : "s"} with a suggested revision.` : "No strongly formulaic passages found.",
    })),
  ];
}

/** Runs every tool over a manuscript. A failing tool is reported, not fatal. */
export async function buildPaperReport(text: string, deps: ReportDeps = {}, options: ReportOptions = {}): Promise<PaperReport> {
  const on = (t: ToolId) => options.tools?.[t] !== false;
  const progress = <T>(tool: ToolId, p: Promise<T>) => {
    options.onProgress?.(tool, "start");
    return p.finally(() => options.onProgress?.(tool, "done"));
  };
  const signal = options.signal;
  const split = splitReferences(text);
  const body = split.body;

  const grammarP = progress("grammar", run<GrammarCheckResult>(on("grammar"), "Not selected.", () =>
    checkGrammar(body, {
      ...(deps.languageTool ? { languageTool: { ...deps.languageTool, ...(signal ? { signal } : {}) } } : {}),
      ...(deps.spellChecker ? { spellChecker: deps.spellChecker } : {}),
    }),
  ));
  const detectorP = progress("detector", run<DetectorResult>(on("detector"), "Not selected.", () =>
    detectAiText(text, { ...(deps.llm ? { llm: deps.llm } : {}), ...(signal ? { signal } : {}) }),
  ));
  const plagiarismP = progress("plagiarism", run<PlagiarismReport>(on("plagiarism"), "Not selected.", () =>
    checkPlagiarism(text, {
      providers: deps.providers ?? [],
      library: deps.library ?? [],
      ...(signal ? { signal } : {}),
      ...(options.onStep ? { onProgress: (done: number, total: number) => options.onStep?.("plagiarism", done, total) } : {}),
    }),
  ));
  const citationsP = progress("citations", run<CitationsSection>(on("citations"), "Not selected.", async () => {
    const references = split.references ? parseReferenceList(split.references) : [];
    const crossCheck = crossCheckCitations(body, references);
    const claims = findClaimsNeedingCitations(body).sort((a, b) => b.score - a.score).slice(0, 15);
    const section: CitationsSection = { references, crossCheck, claims, suggestions: [] };
    const maxRefs = options.maxReferences ?? 150;
    if (!references.length) section.verificationSkipped = "No reference list was found.";
    else if (!deps.verifier) section.verificationSkipped = "Online reference checking is not available.";
    else if (references.length > maxRefs) section.verificationSkipped = `The reference list has more than ${maxRefs} entries; check it in the Citations tool in batches.`;
    else section.verification = await verifyReferences(references, deps.verifier);
    if (deps.finder) {
      for (const claim of claims.slice(0, options.suggestFor ?? 3)) {
        if (signal?.aborted) break;
        section.suggestions.push({ claim, ...(await suggestCitations(claim.text, deps.finder, { limit: 3 })) });
      }
    }
    return section;
  }));

  const [grammar, detector, plagiarism, citations] = await Promise.all([grammarP, detectorP, plagiarismP, citationsP]);
  const count = options.rewriteCount ?? 2;

  const paraphrase = await progress("paraphrase", run<RewriteSuggestion[]>(on("paraphrase"), "Not selected.", async () => {
    if (plagiarism.status !== "done") return { skipped: "Needs the plagiarism check." };
    // Plagiarism offsets refer to the body, which starts at offset 0 of the text.
    const targets = plagiarism.result.spans
      .filter((s) => s.sourceIds.some((id) => id !== "self"))
      .sort((a, b) => b.words - a.words)
      .slice(0, count)
      .map((s) => ({ ...sentenceRange(text, s.start, s.end), reason: `Matches a source over ${s.words} words. Rewrite it in your own words, or quote and cite it.` }));
    // A reworded sentence still needs a citation; a further rewrite does not fix that, so only exact copies get rewrites.
    return suggestRewrites(text, targets, "academic", deps.llm, signal);
  }));

  const humanise = await progress("humanise", run<RewriteSuggestion[]>(on("humanise"), "Not selected.", async () => {
    if (detector.status !== "done") return { skipped: "Needs the AI-pattern check." };
    const sentences = detector.result.sentences;
    const targets = splitParagraphs(body)
      .map((p) => {
        const inside = sentences.filter((s) => s.start >= p.start && s.end <= p.end);
        const mean = inside.length ? inside.reduce((n, s) => n + s.score, 0) / inside.length : 0;
        return { start: p.start, end: p.end, mean, high: inside.filter((s) => s.level === "high").length };
      })
      .filter((p) => p.high >= 2 && p.mean >= 0.55 && countWords(body.slice(p.start, p.end)) >= 25)
      .sort((a, b) => b.mean - a.mean)
      .slice(0, count)
      .map((p) => ({ start: p.start, end: p.end, reason: `Several sentences use stock phrases or formulaic openers (average sentence score ${Math.round(p.mean * 100)}).` }));
    return suggestRewrites(text, targets, "humanise", deps.llm, signal);
  }));

  const partial = { words: countWords(body), hasReferenceList: split.referencesStart >= 0, grammar, detector, plagiarism, citations, paraphrase, humanise };
  return { generatedAt: new Date().toISOString(), ...partial, overview: buildOverview(partial), disclaimer: REPORT_DISCLAIMER };
}
