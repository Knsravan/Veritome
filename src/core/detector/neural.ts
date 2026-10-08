import { levelFor, modelVerdict } from "./detect.ts";
import type { DetectorResult } from "./types.ts";

/**
 * The second, neural opinion on AI writing: a small transformer trained on academic text written and polished by
 * current language models (it runs in the browser; see src/lib/ai-model). Its per-paragraph scores are mapped onto
 * the trained classifier's scale and the higher of the two is kept, so both kinds of evidence count.
 */
export interface NeuralMeta {
  version: string;
  /** Tokens per window the model reads. */
  maxTokens: number;
  /** Words per window; a long paragraph is read in several windows and the scores averaged. */
  windowWords: number;
  /**
   * The models, each with the raw probabilities that human paragraphs reach at the percentiles in
   * HUMAN_PERCENTILES (measured on held-out human writing). The last one is the "likely AI" level: with the higher
   * of the models counting, about 1% of human paragraphs reach it.
   */
  models: Array<{ file: string; humanQuantiles: number[] }>;
  /**
   * The whole-document test. In a paper with at least `minParagraphs` prose paragraphs, if `share` or more of them
   * score above the `percentile` of human paragraphs (about 1 in 100 human papers did), those paragraphs count as
   * likely AI.
   */
  document?: { minParagraphs: number; percentile: number; share: number };
}

/** Splits a paragraph into overlapping windows of words for the model. */
export function neuralWindows(text: string, windowWords: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= windowWords) return [words.join(" ")];
  const out: string[] = [];
  const step = Math.max(1, Math.floor(windowWords * 0.8));
  for (let i = 0; i < words.length; i += step) {
    out.push(words.slice(i, i + windowWords).join(" "));
    if (i + windowWords >= words.length) break;
  }
  return out;
}

/** Prose rather than a table, an equation block or a list of numbers: most tokens are ordinary words. */
export function isProse(text: string): boolean {
  const toks = text.split(/\s+/).filter(Boolean);
  if (toks.length < 40) return false;
  const words = toks.filter((t) => /^[("“]?[A-Za-z][a-z'’-]+[,.;:)"”]*$/.test(t)).length;
  return words / toks.length >= 0.6;
}

/** The percentiles of human paragraphs at which each model's raw probability is recorded. */
export const HUMAN_PERCENTILES = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 0.994];

/** Where a raw probability falls among human paragraphs (0 to 1), from the recorded percentiles. */
export function humanPercentile(p: number, humanQuantiles: number[]): number {
  const q = humanQuantiles;
  const last = q[q.length - 1]!;
  const top = HUMAN_PERCENTILES[HUMAN_PERCENTILES.length - 1]!;
  if (p >= last) return top + ((p - last) / Math.max(1 - last, 1e-9)) * (1 - top);
  if (p <= q[0]!) return (p / Math.max(q[0]!, 1e-9)) * HUMAN_PERCENTILES[0]!;
  let j = 0;
  while (j < q.length - 2 && p >= q[j + 1]!) j++;
  const lo = HUMAN_PERCENTILES[j]!;
  const hi = HUMAN_PERCENTILES[j + 1]!;
  return lo + ((p - q[j]!) / Math.max(q[j + 1]! - q[j]!, 1e-9)) * (hi - lo);
}

/**
 * Maps a raw neural probability onto the classifier's scale through how human paragraphs score: up to the 80th
 * percentile of human paragraphs it stays at or below "likely human", the top 0.6% reach "likely AI", and in
 * between it rises gently (squared), so a merely unusual human paragraph is not pushed towards "uncertain".
 */
export function toClassifierScale(p: number, humanQuantiles: number[], to: { likelyAi: number; likelyHuman: number }): number {
  const last = humanQuantiles[humanQuantiles.length - 1]!;
  const top = HUMAN_PERCENTILES[HUMAN_PERCENTILES.length - 1]!;
  if (p >= last) return to.likelyAi + ((p - last) / Math.max(1 - last, 1e-9)) * (1 - to.likelyAi);
  const pct = humanPercentile(p, humanQuantiles);
  if (pct <= HUMAN_ANCHOR) return (pct / HUMAN_ANCHOR) * to.likelyHuman;
  const t = (pct - HUMAN_ANCHOR) / (top - HUMAN_ANCHOR);
  return to.likelyHuman + t * t * (to.likelyAi - to.likelyHuman);
}

/** Human paragraphs up to this percentile map to "likely human" or below. */
const HUMAN_ANCHOR = 0.8;

/**
 * Combines the neural scores with the detector result. `scores[segment][model]` lists the window scores of each
 * model for a paragraph segment (null when the segment was not read). A segment that any model rates as likely
 * AI takes that estimate if it is higher than the classifier's; the overall score and verdict follow the segments.
 */
export function mergeNeural(result: DetectorResult, scores: Array<number[][] | null>, meta: NeuralMeta): DetectorResult {
  const segments = result.model.segments;
  if (!segments?.length || scores.length !== segments.length) return result;
  const to = result.model.thresholds;
  const mean = (w: number[]) => w.reduce((a, b) => a + b, 0) / w.length;
  // Each read segment's highest position among human paragraphs, across the models.
  const pcts = scores.map((perModel) =>
    perModel?.length ? Math.max(...perModel.map((w, m) => (w.length && meta.models[m] ? humanPercentile(mean(w), meta.models[m].humanQuantiles) : 0))) : null,
  );
  const read = pcts.filter((p): p is number => p !== null);
  const doc = meta.document;
  const above = doc ? read.filter((p) => p >= doc.percentile).length : 0;
  const documentLevel = Boolean(doc && read.length >= doc.minParagraphs && above / read.length >= doc.share);
  // Just past "likely AI" on the classifier's scale, also for short segments (they need 0.93).
  const AI_LEVEL = Math.max(to.likelyAi, 0.93) + 0.01;
  const merged = segments.map((s, i) => {
    const perModel = scores[i];
    if (!perModel?.length) return s;
    if (documentLevel && doc && pcts[i]! >= doc.percentile) return { ...s, probability: Math.max(s.probability, AI_LEVEL) };
    const neural = Math.max(...perModel.map((w, m) => (w.length && meta.models[m] ? toClassifierScale(mean(w), meta.models[m].humanQuantiles, to) : 0)));
    // Only a confident neural opinion (past the 1-in-100 human level) changes a segment; below it the classifier
    // keeps its say, so borderline paragraphs are not all pushed into "uncertain".
    if (neural < to.likelyAi) return s;
    return { ...s, probability: Math.round(Math.max(s.probability, neural) * 1000) / 1000 };
  });
  // Sentences inside a paragraph the neural model raised lean with it, as they do with the classifier's windows.
  const NOTE = "The paragraph reads as AI-written or AI-polished to the neural models";
  const sentences = result.sentences.map((sen) => {
    const i = segments.findIndex((s) => s.start <= sen.start && sen.end <= s.end);
    if (i < 0 || merged[i]!.probability <= segments[i]!.probability) return sen;
    const score = Math.round(Math.max(sen.score, 0.6 * merged[i]!.probability + 0.4 * sen.score) * 100) / 100;
    const level = levelFor(score);
    return level === sen.level ? { ...sen, score } : { ...sen, score, level, reasons: [...sen.reasons, NOTE] };
  });
  const words = merged.reduce((n, s) => n + s.words, 0) || 1;
  const probability = merged.reduce((n, s) => n + s.probability * s.words, 0) / words;
  const shift = Math.round(probability * 100) - result.score;
  const clamp = (n: number) => Math.min(100, Math.max(0, n));
  return {
    ...result,
    score: Math.round(probability * 100),
    band: { low: clamp(result.band.low + shift), high: clamp(result.band.high + shift) },
    verdict: documentLevel && result.verdict !== "insufficient_text" ? "likely_ai" : modelVerdict(result.words, probability, to),
    sentences,
    model: {
      ...result.model,
      version: `${result.model.version}+${meta.version}`,
      probability: Math.round(probability * 1000) / 1000,
      segments: merged,
      ...(documentLevel ? { document: { paragraphs: read.length, aboveHumanRange: above, share: Math.round((above / read.length) * 100) / 100 } } : {}),
    },
  };
}
