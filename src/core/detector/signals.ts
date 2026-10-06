import { maskProtected } from "../text/protect.ts";
import { splitReferences } from "../text/sections.ts";
import { splitSentences, type Sentence } from "../text/sentences.ts";
import { clamp, cv, mattr, mean, round } from "../text/stats.ts";
import { tokenize } from "../text/tokens.ts";
import { findCliches, openingTransition, type LexiconHit } from "./lexicon.ts";
import type { DetectorSignal } from "./types.ts";

/** Linear map from [x0, x1] to [y0, y1], clamped at both ends. */
export function ramp(x: number, x0: number, y0: number, x1: number, y1: number): number {
  if (x1 === x0) return y0;
  const t = clamp((x - x0) / (x1 - x0), 0, 1);
  return y0 + t * (y1 - y0);
}

export interface AnalysedSentence extends Sentence {
  words: number;
  wordList: string[];
  transition: string | null;
  cliches: LexiconHit[];
}

export interface Analysis {
  /** The text that was analysed (reference list removed). Offsets refer to it. */
  text: string;
  sentences: AnalysedSentence[];
  words: string[];
  cliches: LexiconHit[];
  referencesRemoved: boolean;
}

/** Splits the text and gathers per-sentence facts. Citations, maths and URLs are masked first. */
export function analyse(input: string): Analysis {
  const split = splitReferences(input);
  const text = split.body;
  const { masked } = maskProtected(text);
  const cliches = findCliches(masked);
  const sentences: AnalysedSentence[] = [];
  const words: string[] = [];
  for (const s of splitSentences(text)) {
    const slice = masked.slice(s.start, s.end);
    const wordList = tokenize(slice)
      .map((t) => t.word)
      .filter((w) => !/^\d+$/.test(w));
    if (wordList.length === 0) continue;
    words.push(...wordList);
    sentences.push({
      ...s,
      words: wordList.length,
      wordList,
      transition: openingTransition(slice),
      cliches: cliches.filter((c) => c.start >= s.start && c.end <= s.end),
    });
  }
  return { text, sentences, words, cliches, referencesRemoved: split.referencesStart >= 0 };
}

/** Sentences of at least this many words count towards sentence-length statistics. */
const MIN_SENTENCE_WORDS = 4;

export function computeSignals(a: Analysis): DetectorSignal[] {
  const lengths = a.sentences.filter((s) => s.words >= MIN_SENTENCE_WORDS).map((s) => s.words);
  const lengthCv = lengths.length >= 3 ? cv(lengths) : 0.45;
  const div = mattr(a.words, 50);
  const per1000 = a.words.length === 0 ? 0 : (a.cliches.reduce((n, c) => n + c.weight, 0) / a.words.length) * 1000;
  const opened = a.sentences.filter((s) => s.transition !== null).length;
  const transitionShare = a.sentences.length === 0 ? 0 : opened / a.sentences.length;

  // Ranges come from published descriptions of model output versus human prose and were
  // checked against the evaluation script; see docs/ACCURACY.md. They are deliberately soft.
  return [
    {
      id: "burstiness",
      label: "Sentence-length variation",
      value: round(lengthCv, 2),
      unit: "coefficient of variation",
      lean: round(ramp(lengthCv, 0.22, 1, 0.62, -1), 2),
      weight: 1.4,
      explanation:
        lengths.length < 3
          ? "Too few sentences to measure variation."
          : `Sentence lengths vary by ${Math.round(lengthCv * 100)}% around an average of ${Math.round(mean(lengths))} words. ` +
            "People tend to mix short and long sentences; model output is often more even.",
    },
    {
      id: "lexical_diversity",
      label: "Vocabulary variety (MATTR)",
      value: round(div, 3),
      unit: "moving-average type-token ratio, 50-word window",
      lean: round(div < 0.7 ? ramp(div, 0.6, 0.6, 0.7, 0) : ramp(div, 0.7, 0, 0.82, -0.6), 2),
      weight: 0.6,
      explanation: `${Math.round(div * 100)}% of words in a typical 50-word window are distinct. Low variety can point to formulaic text, but technical writing also repeats its key terms.`,
    },
    {
      id: "cliches",
      label: "Stock phrases",
      value: round(per1000, 1),
      unit: "weighted hits per 1,000 words",
      lean: round(per1000 <= 2 ? ramp(per1000, 0, -0.4, 2, 0) : ramp(per1000, 2, 0, 9, 1), 2),
      weight: 1.2,
      explanation:
        a.cliches.length === 0
          ? "No phrases from the list that models over-use."
          : `${a.cliches.length} phrase${a.cliches.length === 1 ? "" : "s"} that models over-use, such as “${[...new Set(a.cliches.map((c) => c.phrase.replace(/,$/, "")))].slice(0, 3).join("”, “")}”.`,
    },
    {
      id: "transitions",
      label: "Sentence-opening connectives",
      value: round(transitionShare * 100, 1),
      unit: "% of sentences",
      lean: round(transitionShare <= 0.12 ? ramp(transitionShare, 0.03, -0.5, 0.12, 0) : ramp(transitionShare, 0.12, 0, 0.32, 1), 2),
      weight: 1.0,
      explanation: `${opened} of ${a.sentences.length} sentences open with a connective such as “Moreover” or “Furthermore”.`,
    },
  ];
}
