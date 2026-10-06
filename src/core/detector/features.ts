import { STOPWORDS } from "../text/tokens.ts";

/**
 * Feature extraction for the trained classifier. Training data is produced by
 * this same code (scripts/train/featurize.ts), so features in the browser,
 * on the server and in training are identical by construction.
 */

export const HASH_BITS = 18;
export const HASH_SIZE = 1 << HASH_BITS;

/** FNV-1a over UTF-16 code units, masked to HASH_BITS. */
export function hashFeature(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & (HASH_SIZE - 1);
}

/** Latin lookalikes from Cyrillic and Greek, used to evade detectors and plagiarism checkers. */
const HOMOGLYPHS: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "һ": "h", "ԁ": "d", "ԛ": "q", "ԝ": "w",
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "І": "I", "Ј": "J", "Ѕ": "S",
  "α": "a", "ο": "o", "ν": "v", "ρ": "p", "τ": "t", "ι": "i", "κ": "k", "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X",
};
const HOMOGLYPH_RE = new RegExp(`[${Object.keys(HOMOGLYPHS).join("")}]`, "g");
const INVISIBLE_RE = /[​-‏⁠-⁤﻿­]/g;

export interface Normalised {
  text: string;
  /** Lookalike letters from other alphabets found inside otherwise Latin words. */
  homoglyphs: number;
  /** Zero-width and other invisible characters. */
  invisible: number;
}

/** Undoes common evasion tricks so they cannot hide text from the checks. */
export function normaliseForDetection(input: string): Normalised {
  let homoglyphs = 0;
  let invisible = 0;
  // Only replace lookalikes that sit next to Latin letters, so genuine Greek or Cyrillic text is left alone.
  let text = input.normalize("NFKC").replace(INVISIBLE_RE, () => {
    invisible++;
    return "";
  });
  text = text.replace(/[\p{L}]+/gu, (word) => {
    if (!/[A-Za-z]/.test(word) || !HOMOGLYPH_RE.test(word)) return word;
    HOMOGLYPH_RE.lastIndex = 0;
    return word.replace(HOMOGLYPH_RE, (c) => {
      homoglyphs++;
      return HOMOGLYPHS[c] ?? c;
    });
  });
  HOMOGLYPH_RE.lastIndex = 0;
  return { text: text.replace(/[ \t]+/g, " "), homoglyphs, invisible };
}

const TOKEN_RE = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?|[.,;:!?()"“”'‘’\-–—]/gu;

/** Lower-cased words plus punctuation marks as separate tokens. */
export function featureTokens(text: string): string[] {
  return (text.toLowerCase().replace(/’/g, "'").match(TOKEN_RE) ?? []).map((t) => (/^\d+$/.test(t) ? "<num>" : t));
}

/** Dense style measurements, in a fixed order. Names are exported for reports and training. */
export const DENSE_NAMES = [
  "mean_sentence_len",
  "sentence_len_cv",
  "type_token_50",
  "comma_rate",
  "semicolon_rate",
  "colon_rate",
  "dash_rate",
  "paren_rate",
  "question_rate",
  "exclaim_rate",
  "quote_rate",
  "contraction_rate",
  "first_person_rate",
  "second_person_rate",
  "digit_rate",
  "stopword_rate",
  "long_word_rate",
  "mean_word_len",
  "paragraph_count_rate",
  "capital_start_rate",
] as const;

function stdevOf(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function denseFeatures(text: string, tokens: readonly string[]): number[] {
  const words = tokens.filter((t) => /[\p{L}\p{N}<]/u.test(t));
  const n = Math.max(1, words.length);
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"“(])|\n\s*\n/).map((s) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length).filter((l) => l > 0);
  const meanLen = sentences.length ? sentences.reduce((a, b) => a + b, 0) / sentences.length : n;
  const cv = sentences.length > 1 && meanLen > 0 ? stdevOf(sentences) / meanLen : 0;
  let ttr = 0;
  let windows = 0;
  for (let i = 0; i + 50 <= words.length; i += 25) {
    ttr += new Set(words.slice(i, i + 50)).size / 50;
    windows++;
  }
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  const per = (k: number) => (k / n) * 100;
  return [
    Math.min(80, meanLen) / 20,
    Math.min(2, cv),
    windows ? ttr / windows : new Set(words).size / n,
    per(count(/,/g)),
    per(count(/;/g)),
    per(count(/:/g)),
    per(count(/[—–]|\s-\s/g)),
    per(count(/\(/g)),
    per(count(/\?/g)),
    per(count(/!/g)),
    per(count(/["“”]/g)),
    per(words.filter((w) => /'(?:s|t|re|ve|ll|d|m)$/.test(w)).length),
    per(words.filter((w) => w === "i" || w === "my" || w === "me" || w === "we" || w === "our" || w === "us").length),
    per(words.filter((w) => w === "you" || w === "your").length),
    per(words.filter((w) => w === "<num>").length),
    per(words.filter((w) => STOPWORDS.has(w)).length) / 10,
    per(words.filter((w) => w.length >= 9).length),
    words.reduce((a, w) => a + w.length, 0) / n / 5,
    per(count(/\n\s*\n/g)),
    sentences.length ? (count(/(?:^|[.!?]\s+)[A-Z]/g) / sentences.length) : 0,
  ];
}

export interface FeatureVector {
  /** Sorted hashed indices with L2-normalised log counts. */
  indices: number[];
  values: number[];
  dense: number[];
}

/** Hashed word unigrams and bigrams, function-word trigrams and the dense style measurements. */
export function extractFeatures(text: string): FeatureVector {
  const tokens = featureTokens(text);
  const counts = new Map<number, number>();
  const add = (key: string) => {
    const h = hashFeature(key);
    counts.set(h, (counts.get(h) ?? 0) + 1);
  };
  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i] as string;
    add(`u:${a}`);
    const b = tokens[i + 1];
    if (b !== undefined) add(`b:${a} ${b}`);
    const c = tokens[i + 2];
    if (b !== undefined && c !== undefined) {
      // Function-word skeleton: content words become "_", which captures phrasing habits independent of topic.
      const shape = [a, b, c].map((t) => (STOPWORDS.has(t) || !/[\p{L}]/u.test(t) ? t : "_")).join(" ");
      if (shape !== "_ _ _") add(`f:${shape}`);
    }
  }
  const indices = [...counts.keys()].sort((x, y) => x - y);
  const raw = indices.map((i) => Math.log1p(counts.get(i) as number));
  const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0)) || 1;
  return { indices, values: raw.map((v) => v / norm), dense: denseFeatures(text, tokens) };
}
