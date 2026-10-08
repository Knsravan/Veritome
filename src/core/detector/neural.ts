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
  /** Raw model probabilities for "likely AI" (about 1% of human paragraphs reach it) and "likely human". */
  thresholds: { likelyAi: number; likelyHuman: number };
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

/** Maps a raw neural probability onto the classifier's scale so one set of thresholds serves both. */
export function toClassifierScale(p: number, from: NeuralMeta["thresholds"], to: { likelyAi: number; likelyHuman: number }): number {
  if (p <= from.likelyHuman) return (p / Math.max(from.likelyHuman, 1e-9)) * to.likelyHuman;
  if (p < from.likelyAi) return to.likelyHuman + ((p - from.likelyHuman) / (from.likelyAi - from.likelyHuman)) * (to.likelyAi - to.likelyHuman);
  return to.likelyAi + ((p - from.likelyAi) / Math.max(1 - from.likelyAi, 1e-9)) * (1 - to.likelyAi);
}

/**
 * Combines the neural scores (one list of window scores per paragraph segment, null when the segment was not
 * read) with the detector result: each segment keeps the higher of the two estimates, and the overall score and
 * verdict follow the combined segments.
 */
export function mergeNeural(result: DetectorResult, scores: Array<number[] | null>, meta: NeuralMeta): DetectorResult {
  const segments = result.model.segments;
  if (!segments?.length || scores.length !== segments.length) return result;
  const to = result.model.thresholds;
  const merged = segments.map((s, i) => {
    const w = scores[i];
    if (!w?.length) return s;
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    const neural = toClassifierScale(mean, meta.thresholds, to);
    return { ...s, probability: Math.round(Math.max(s.probability, neural) * 1000) / 1000 };
  });
  // Sentences inside a paragraph the neural model raised lean with it, as they do with the classifier's windows.
  const NOTE = "The paragraph reads as AI-written to the neural model";
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
    verdict: modelVerdict(result.words, probability, to),
    sentences,
    model: { ...result.model, version: `${result.model.version}+${meta.version}`, probability: Math.round(probability * 1000) / 1000, segments: merged },
  };
}
