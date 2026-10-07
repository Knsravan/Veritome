import { extractJson, type LlmClient } from "../llm/client.ts";
import { maskProtected } from "../text/protect.ts";
import { clamp, mean, round, sigmoid, stdev } from "../text/stats.ts";
import { normaliseForDetection } from "./features.ts";
import { MODEL_INFO, modelProbability, scoreWindows, topContributors } from "./model.ts";
import { splitParagraphs } from "../text/sentences.ts";
import { analyse, computeSignals, type AnalysedSentence } from "./signals.ts";
import type { DetectorResult, DetectorSignal, DetectorVerdict, LlmOpinion, SentenceLevel, SentenceScore } from "./types.ts";

export const DETECTOR_DISCLAIMER =
  "No AI detector is reliable enough to prove who wrote a text, and this one is no exception. " +
  "The score measures writing patterns that are common in language-model output, and careful human writers, " +
  "non-native English writers and heavily edited text can all show them. Never use it as the sole basis for an accusation.";

/** Below this many words the result is reported as insufficient. */
export const MIN_WORDS = 80;

export interface DetectOptions {
  llm?: LlmClient;
  signal?: AbortSignal;
}

/** Weighted average of the signal leans turned into a 0-100 score. */
export function combineSignals(signals: readonly DetectorSignal[]): number {
  const totalWeight = signals.reduce((n, s) => n + s.weight, 0);
  if (totalWeight === 0) return 50;
  const lean = signals.reduce((n, s) => n + s.lean * s.weight, 0) / totalWeight;
  return sigmoid(lean * 3) * 100;
}

/**
 * Half-width of the uncertainty band, in score points. Shorter texts and
 * disagreeing signals widen it.
 */
export function bandHalfWidth(words: number, signals: readonly DetectorSignal[]): number {
  const lengthPart = clamp(16 * Math.sqrt(300 / Math.max(words, 1)), 6, 40);
  const disagreement = signals.length > 1 ? stdev(signals.map((s) => s.lean)) * 10 : 0;
  return clamp(lengthPart + disagreement, 8, 45);
}

export function verdictFor(words: number, band: { low: number; high: number }): DetectorVerdict {
  if (words < MIN_WORDS) return "insufficient_text";
  if (band.low >= 60) return "likely_ai";
  if (band.high <= 40) return "likely_human";
  return "uncertain";
}

function levelFor(score: number): SentenceLevel {
  return score >= 0.7 ? "high" : score >= 0.45 ? "medium" : "low";
}

/**
 * Per-sentence scores: the trained model's estimate for the window around the
 * sentence, adjusted by local cues (stock phrases, formulaic openers).
 */
export function scoreSentences(sentences: readonly AnalysedSentence[], windows: ReadonlyArray<{ start: number; end: number; probability: number }> = []): SentenceScore[] {
  const long = sentences.filter((s) => s.words >= 4).map((s) => s.words);
  const avg = mean(long) || 1;
  const raw = sentences.map((s, i) => {
    let lean = 0;
    const reasons: string[] = [];
    const clicheWeight = s.cliches.reduce((n, c) => n + c.weight, 0);
    // An opening connective is reported once, as an opener, not again as a stock phrase.
    const phrases = s.cliches.map((c) => c.phrase.replace(/,$/, "")).filter((p) => p !== s.transition);
    if (clicheWeight > 0) lean += Math.min(1.2, clicheWeight * 0.35);
    if (phrases.length) reasons.push(`Uses ${phrases.map((p) => `“${p}”`).join(", ")}`);
    if (s.transition) {
      lean += 0.35;
      reasons.push(`Opens with “${s.transition}”`);
    }
    // A run of sentences of near-identical length is a weak cue.
    const window = sentences.slice(Math.max(0, i - 2), i + 3).filter((x) => x.words >= 4).map((x) => x.words);
    if (window.length >= 4) {
      const spread = stdev(window) / (mean(window) || 1);
      if (spread < 0.15) {
        lean += 0.3;
        reasons.push("Similar in length to the sentences around it");
      } else if (spread > 0.5) lean -= 0.2;
    }
    if (s.words <= 6 && s.words < avg * 0.4) lean -= 0.25;
    if (/[?!]$/.test(s.text) || /\b(?:I|my|we've|I'm|I've)\b/.test(s.text)) lean -= 0.15;
    return { lean, reasons };
  });
  return sentences.map((s, i) => {
    const prev = raw[i - 1]?.lean ?? raw[i]!.lean;
    const next = raw[i + 1]?.lean ?? raw[i]!.lean;
    const smoothed = 0.7 * raw[i]!.lean + 0.15 * prev + 0.15 * next;
    const local = sigmoid(smoothed * 2.2 - 0.9);
    // The tightest region containing the sentence.
    const containing = windows.filter((w) => w.start <= s.start && s.end <= w.end).sort((a, b) => a.end - a.start - (b.end - b.start));
    const around = containing.slice(0, 1).map((w) => w.probability);
    const score = round(around.length ? 0.6 * mean(around) + 0.4 * local : local, 2);
    return {
      start: s.start,
      end: s.end,
      text: s.text,
      score,
      level: levelFor(score),
      reasons: raw[i]!.reasons,
      highlights: s.cliches.map((c) => ({ start: c.start, end: c.end, phrase: c.phrase })),
    };
  });
}

const JUDGE_SYSTEM = `You help researchers check whether a passage reads like language-model output.
You cannot know who wrote it, and you are often wrong, so be calibrated: use values near 0.5 when unsure.
Judge only the writing (phrasing, structure, specificity), not the topic or its correctness.
Reply with a JSON object only: {"ai_probability": number between 0 and 1, "reasons": [up to 4 short strings]}.`;

const JUDGE_MAX_CHARS = 6000;

export async function askLlmJudge(text: string, llm: LlmClient, signal?: AbortSignal): Promise<LlmOpinion> {
  const sample = text.length > JUDGE_MAX_CHARS ? text.slice(0, JUDGE_MAX_CHARS) : text;
  const reply = await llm.chat({
    system: JUDGE_SYSTEM,
    user: `Passage:\n"""\n${sample}\n"""`,
    temperature: 0,
    maxTokens: 2000,
    json: true,
    ...(signal ? { signal } : {}),
  });
  const parsed = extractJson<{ ai_probability?: unknown; reasons?: unknown }>(reply);
  const p = Number(parsed?.ai_probability);
  if (!parsed || !Number.isFinite(p)) throw new Error("The language model did not return a usable judgement.");
  const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.filter((r): r is string => typeof r === "string").slice(0, 4) : [];
  return { model: llm.model, probability: round(clamp(p, 0, 1), 2), reasons };
}

/**
 * Verdicts from the trained model's probability. Thresholds were chosen on
 * held-out human text for a false-positive rate of about 1% (docs/ACCURACY.md);
 * shorter texts need a stronger signal.
 */
export function modelVerdict(words: number, probability: number, thresholds = MODEL_INFO.thresholds): DetectorVerdict {
  if (words < MIN_WORDS) return "insufficient_text";
  const aiCut = words >= 150 ? thresholds.likelyAi : Math.max(thresholds.likelyAi, 0.93);
  if (probability >= aiCut) return "likely_ai";
  if (probability <= thresholds.likelyHuman) return "likely_human";
  return "uncertain";
}

/**
 * Regions for sentence-level scores: each paragraph of 40+ words gets its own model
 * estimate, so a formulaic paragraph stands out inside an otherwise human text.
 */
function localRegions(plain: string, windows: ReadonlyArray<{ start: number; end: number; probability: number }>) {
  const paras = splitParagraphs(plain).filter((p) => p.text.split(/\s+/).length >= 40);
  const regions = paras.map((p) => ({ start: p.start, end: p.end, probability: modelProbability(p.text) }));
  // Short paragraphs fall back to the surrounding window.
  return [...regions, ...windows.filter((w) => !regions.some((r) => r.start < w.end && w.start < r.end) || regions.length === 0)];
}

/** Estimates how much a text shows patterns typical of language-model output. */
export async function detectAiText(input: string, options: DetectOptions = {}): Promise<DetectorResult> {
  const analysis = analyse(input);
  const words = analysis.words.length;
  const signals = computeSignals(analysis);
  const warnings: string[] = [];
  if (analysis.referencesRemoved) warnings.push("The reference list was left out of the analysis.");
  if (words < MIN_WORDS) warnings.push(`At least ${MIN_WORDS} words are needed; ${words} were found. The score below is not meaningful.`);
  else if (words < 150) warnings.push("Short texts give unstable results. 150 words or more is better, and 300 or more is best.");

  const evasionCheck = normaliseForDetection(analysis.text);
  const evasion = { homoglyphs: evasionCheck.homoglyphs, invisible: evasionCheck.invisible };
  if (evasion.homoglyphs > 0) {
    warnings.push(`The text contains ${evasion.homoglyphs} lookalike letter${evasion.homoglyphs === 1 ? "" : "s"} from other alphabets inside English words, a known trick for fooling AI and plagiarism checkers. They were converted back before checking.`);
  }
  if (evasion.invisible > 0) {
    warnings.push(`The text contains ${evasion.invisible} invisible character${evasion.invisible === 1 ? "" : "s"} (such as zero-width spaces), sometimes inserted to fool checkers. They were removed before checking.`);
  }

  // Citations, maths and URLs are blanked so they do not sway the model; offsets are unchanged.
  const { masked } = maskProtected(analysis.text);
  const plain = masked.replace(/\u0001+/g, (m) => " ".repeat(m.length));
  const windows = scoreWindows(plain);
  const totalLen = windows.reduce((n, w) => n + (w.end - w.start), 0) || 1;
  const probability = windows.length ? windows.reduce((n, w) => n + w.probability * (w.end - w.start), 0) / totalLen : 0.5;
  const spread = windows.length > 1 ? stdev(windows.map((w) => w.probability)) : 0;

  const statistical = combineSignals(signals);
  const score = probability * 100;
  // Width from text length and from disagreement between parts of the text.
  let half = clamp(10 * Math.sqrt(300 / Math.max(words, 1)), 4, 40) + spread * 25;
  let llm: LlmOpinion | undefined;
  if (options.llm && words >= MIN_WORDS) {
    try {
      llm = await askLlmJudge(analysis.text, options.llm, options.signal);
      // The model's opinion is shown and widens the range when it disagrees, but never moves the verdict:
      // language models are poorly calibrated judges of authorship.
      half += Math.abs(score - llm.probability * 100) * 0.15;
    } catch (err) {
      warnings.push(`The language-model opinion is unavailable (${err instanceof Error ? err.message : "error"}).`);
    }
  }
  half = clamp(half, 4, 45);
  const band = { low: Math.round(clamp(score - half, 0, 100)), high: Math.round(clamp(score + half, 0, 100)) };
  if (spread > 0.25) warnings.push("Parts of the text score very differently, which can mean mixed authorship or heavy editing. See the per-section scores.");

  return {
    words,
    score: Math.round(score),
    band,
    verdict: modelVerdict(words, probability),
    signals,
    sentences: scoreSentences(analysis.sentences, localRegions(plain, windows)),
    statisticalScore: Math.round(statistical),
    model: {
      version: MODEL_INFO.version,
      probability: round(probability, 3),
      windows: windows.map((w) => ({ ...w, probability: round(w.probability, 3) })),
      topPhrases: topContributors(plain),
      thresholds: MODEL_INFO.thresholds,
    },
    evasion,
    ...(llm ? { llm } : {}),
    warnings,
    disclaimer: DETECTOR_DISCLAIMER,
  };
}

export const VERDICT_LABELS: Record<DetectorVerdict, string> = {
  insufficient_text: "Not enough text to judge",
  likely_human: "Few signs of model-generated text",
  uncertain: "Inconclusive",
  likely_ai: "Many patterns typical of model output",
};
