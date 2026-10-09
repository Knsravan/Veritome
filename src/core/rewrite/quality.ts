/**
 * A writing-quality score worked out on the user's own device: how plain, varied, direct and specific a piece of
 * prose is. It describes the writing, not where it came from; it says nothing about whether a person or a tool
 * wrote it. Used to show what a revision changed, and to point at the paragraphs that most need the author's own
 * details.
 */
import { splitSentences } from "../text/sentences.ts";
import { countSyllables, countWords } from "../text/tokens.ts";
import { PLAIN_WORDS, WORDY } from "./humanise.ts";

/** Stock phrases that pad academic prose without saying anything. */
const STOCK: readonly RegExp[] = [
  /\bplays? an? (?:crucial|pivotal|vital|key|important|significant|essential) role\b/gi,
  /\bin (?:today's|the modern|the current) (?:world|era|age|landscape)\b/gi,
  /\bin recent years\b/gi,
  /\ba wide (?:range|variety|array) of\b/gi,
  /\bit (?:is|should be) (?:noted|emphasi[sz]ed|highlighted) that\b/gi,
  /\b(?:offers?|provides?) (?:valuable|meaningful|important) insights?\b/gi,
  /\bcontributes? (?:significantly )?to (?:the|a) (?:broader|better|deeper) understanding\b/gi,
  /\b(?:holds|hold) (?:great|significant|immense|tremendous) (?:promise|potential)\b/gi,
  /\bin conclusion\b/gi,
  /\bfuture research (?:should|could|may) (?:explore|investigate|focus)\b/gi,
];
const OPENERS = /^(?:Moreover|Furthermore|Additionally|In addition|Notably|Importantly|Overall|Ultimately|Consequently|Thus|Hence),/;
const PASSIVE = /\b(?:is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?\w+(?:ed|en|wn|lt|ght)\b/gi;
/** Concrete details: numbers, units, percentages, names, citations, symbols. */
const SPECIFIC = /\b\d[\d.,]*\s*(?:%|[a-zµ°]{1,4}\b)?|\(\w[^()]{0,40}\d{4}[a-z]?\)|\[\d+(?:[,–-]\s*\d+)*\]|(?<=[a-z,;] )(?:[A-Z][a-z]+(?:-[A-Z][a-z]+)?|[A-Z]{2,}[a-z]?s?)\b/g;

export interface QualityPart {
  id: "plain" | "length" | "variety" | "active" | "specific";
  label: string;
  /** 0 to 100, higher is better. */
  score: number;
  /** The measurement in plain words. */
  detail: string;
}

export interface WritingQuality {
  /** 0 to 100, higher is better. */
  score: number;
  words: number;
  parts: QualityPart[];
  /** Inflated words and stock phrases found, most frequent first. */
  phrases: Array<{ text: string; count: number }>;
}

const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));

const sentenceLengths = (text: string) =>
  splitSentences(text)
    .map((s) => countWords(s.text))
    .filter((n) => n >= 3);

/** Concrete details per 100 words. */
export function specificity(text: string): number {
  const words = countWords(text);
  if (!words) return 0;
  return ((text.match(SPECIFIC) ?? []).length / words) * 100;
}

export function writingQuality(text: string): WritingQuality {
  const words = countWords(text);
  const lengths = sentenceLengths(text);
  const n = Math.max(1, lengths.length);
  const mean = lengths.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const cv = mean ? sd / mean : 0;

  // Plain words: inflated words, wordy phrases, stock phrases and stock sentence openers per 100 words.
  const found = new Map<string, number>();
  const note = (m: string) => {
    const k = m.toLowerCase();
    found.set(k, (found.get(k) ?? 0) + 1);
  };
  for (const [re] of PLAIN_WORDS) for (const m of text.match(re) ?? []) note(m);
  for (const [re] of WORDY) for (const m of text.match(re) ?? []) note(m);
  for (const re of STOCK) for (const m of text.match(re) ?? []) note(m);
  for (const s of splitSentences(text)) {
    const m = OPENERS.exec(s.text.trim());
    if (m) note(m[0].replace(/,$/, ""));
  }
  const padding = [...found.values()].reduce((a, b) => a + b, 0);
  const paddingRate = words ? (padding / words) * 100 : 0;

  const long = lengths.filter((l) => l > 35).length / n;
  const syllables = text.match(/\p{L}+/gu)?.reduce((t, w) => t + countSyllables(w), 0) ?? 0;
  const longWords = words ? (text.match(/\p{L}+/gu) ?? []).filter((w) => countSyllables(w) >= 4).length / words : 0;
  const passive = (text.match(PASSIVE) ?? []).length / n;
  const spec = specificity(text);

  const parts: QualityPart[] = [
    {
      id: "plain",
      label: "Plain words",
      score: clamp(100 - paddingRate * 28),
      detail: padding ? `${padding} stiff or padded phrase${padding === 1 ? "" : "s"}` : "No stiff or padded phrases",
    },
    {
      id: "length",
      label: "Easy to follow",
      score: clamp(100 - Math.max(0, mean - 22) * 4 - long * 120 - Math.max(0, longWords - 0.12) * 300 - Math.max(0, syllables / Math.max(1, words) - 1.75) * 80),
      detail: `${Math.round(mean)} words per sentence on average${long ? `, ${Math.round(long * 100)}% very long` : ""}`,
    },
    {
      id: "variety",
      label: "Varied rhythm",
      score: lengths.length < 3 ? 100 : clamp((cv / 0.45) * 100),
      detail: lengths.length < 3 ? "Too short to judge" : cv >= 0.4 ? "Sentence lengths vary naturally" : "Sentences are much the same length",
    },
    {
      id: "active",
      label: "Direct voice",
      score: clamp(100 - Math.max(0, passive - 0.25) * 140),
      detail: `${Math.round(Math.min(1, passive) * 100)}% of sentences in the passive voice`,
    },
    {
      id: "specific",
      label: "Specific details",
      score: clamp((spec / 4) * 100),
      detail: `${spec.toFixed(1)} numbers, names or citations per 100 words`,
    },
  ];
  const weights = { plain: 0.3, length: 0.2, variety: 0.15, active: 0.15, specific: 0.2 };
  const score = clamp(parts.reduce((t, p) => t + p.score * weights[p.id], 0));
  return {
    score,
    words,
    parts,
    phrases: [...found].map(([t, c]) => ({ text: t, count: c })).sort((a, b) => b.count - a.count),
  };
}

/**
 * The paragraphs that most need the author's own details: long enough to matter, with the fewest numbers, names
 * and citations. Returns their indexes, most generic first.
 */
export function mostGeneric(paragraphs: readonly string[], limit = 3): number[] {
  return paragraphs
    .map((p, i) => ({ i, words: countWords(p), spec: specificity(p) }))
    .filter((p) => p.words >= 40 && p.spec < 2)
    .sort((a, b) => a.spec - b.spec || b.words - a.words)
    .slice(0, limit)
    .map((p) => p.i);
}
