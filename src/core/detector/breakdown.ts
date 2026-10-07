import { tokenize } from "../text/tokens.ts";
import type { DetectorResult } from "./types.ts";

export type AiRegionKind = "ai" | "uncertain" | "human";

export interface AiBreakdown {
  /** False when the text is too short for the model to judge. */
  judged: boolean;
  /** Shares of the analysed words, 0 to 100; they add up to 100. */
  aiPercent: number;
  uncertainPercent: number;
  humanPercent: number;
  words: number;
  /** Consecutive stretches of text with the same verdict, for highlighting (offsets into the checked text). */
  regions: Array<{ start: number; end: number; kind: AiRegionKind; probability: number }>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Splits a detector result into "likely AI", "uncertain" and "likely human" shares of the text, the way
 * Turnitin reports an AI percentage. Each paragraph segment (short paragraphs joined to 150 words or more) is
 * classed with the same thresholds as the overall verdict. A short text is a single segment, so it is all one class.
 */
export function aiBreakdown(result: DetectorResult, text: string): AiBreakdown {
  const empty: AiBreakdown = { judged: false, aiPercent: 0, uncertainPercent: 0, humanPercent: 0, words: result.words, regions: [] };
  if (result.verdict === "insufficient_text") return empty;
  const { likelyAi, likelyHuman } = result.model.thresholds;
  // Paragraph segments when the detector provides them; otherwise its overlapping windows.
  const parts = result.model.segments?.length
    ? result.model.segments
    : result.model.windows.map((w) => ({ ...w, words: (text.slice(w.start, w.end).match(/\S+/g) ?? []).length }));
  const tokens = tokenize(text.slice(0, Math.max(0, ...parts.map((w) => w.end))));
  if (!tokens.length || !parts.length) return empty;

  // A single part follows the overall verdict. Parts under 150 words need the stricter short-text bar.
  const single = parts.length === 1;
  const classify = (p: number, words: number): AiRegionKind =>
    single
      ? result.verdict === "likely_ai" ? "ai" : result.verdict === "likely_human" ? "human" : "uncertain"
      : p >= (words >= 150 ? likelyAi : Math.max(likelyAi, 0.93)) ? "ai" : p <= likelyHuman ? "human" : "uncertain";

  const counts: Record<AiRegionKind, number> = { ai: 0, uncertain: 0, human: 0 };
  const regions: AiBreakdown["regions"] = [];
  for (const t of tokens) {
    const covering = parts.filter((w) => w.start <= t.start && t.end <= w.end);
    if (!covering.length) continue;
    const p = covering.reduce((n, w) => n + w.probability, 0) / covering.length;
    const kind = classify(p, Math.min(...covering.map((w) => w.words)));
    counts[kind]++;
    const last = regions[regions.length - 1];
    if (last && last.kind === kind) {
      last.end = t.end;
      last.probability = Math.max(last.probability, p);
    } else regions.push({ start: t.start, end: t.end, kind, probability: p });
  }
  const total = counts.ai + counts.uncertain + counts.human;
  if (!total) return empty;
  const ai = round1((counts.ai / total) * 100);
  const human = round1((counts.human / total) * 100);
  return {
    judged: true,
    aiPercent: ai,
    humanPercent: human,
    uncertainPercent: round1(Math.max(0, 100 - ai - human)),
    words: total,
    regions: regions.map((r) => ({ ...r, probability: Math.round(r.probability * 1000) / 1000 })),
  };
}
