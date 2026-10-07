import type { Span } from "./sentences.ts";

export interface Token extends Span {
  /** Original surface form. */
  raw: string;
  /** Normalised (lower-cased, apostrophes unified) form used for matching. */
  word: string;
}

import { unconfuseWord } from "../integrity/confusables.ts";

// Invisible characters (zero-width spaces, soft hyphens) are kept inside a word, so a word split by one still
// matches; normalizeWord removes them.
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}\u00AD\u200B-\u200D\u2060\uFEFF]*(?:['’\-][\p{L}\p{N}][\p{L}\p{N}\u00AD\u200B-\u200D\u2060\uFEFF]*)*/gu;
const INVISIBLE_G = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;

/** Lower-cased, apostrophes unified, invisible characters dropped and look-alike letters from other alphabets mapped to Latin. */
export function normalizeWord(raw: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(raw)) return raw.toLowerCase();
  return unconfuseWord(raw.replace(INVISIBLE_G, "").normalize("NFKC")).toLowerCase().replace(/’/g, "'");
}

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(text)) !== null) {
    out.push({ raw: m[0], word: normalizeWord(m[0]), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export function countWords(text: string): number {
  return tokenize(text).length;
}

export const STOPWORDS: ReadonlySet<string> = new Set(
  (
    "a about above after again against all also am an and any are aren't as at be because been before being below between " +
    "both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from " +
    "further had hadn't has hasn't have haven't having he her here hers herself him himself his how i if in into is " +
    "isn't it it's its itself just let's me more most mustn't my myself no nor not of off on once only or other ought " +
    "our ours ourselves out over own same shan't she should shouldn't so some such than that the their theirs them " +
    "themselves then there these they this those through to too under until up very was wasn't we were weren't what " +
    "when where which while who whom why will with won't would wouldn't you your yours yourself yourselves may might " +
    "must shall within without upon among via per thus hence however therefore whereas whether"
  ).split(" "),
);

export function isStopword(word: string): boolean {
  return STOPWORDS.has(word);
}

/** Rough English syllable counter, good enough for readability scores. */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = stripped.match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Contiguous word n-grams as joined strings, with the index of their first token. */
export function ngrams(words: readonly string[], n: number): Array<{ gram: string; index: number }> {
  const out: Array<{ gram: string; index: number }> = [];
  for (let i = 0; i + n <= words.length; i++) {
    out.push({ gram: words.slice(i, i + n).join(" "), index: i });
  }
  return out;
}
