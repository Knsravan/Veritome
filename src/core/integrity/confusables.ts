/**
 * Letters from other alphabets that look the same as Latin letters, as used to hide copied text from checkers
 * (a Cyrillic "а" looks like "a" but is a different character, so the word no longer matches).
 * Every entry maps one character to one character, so offsets never shift.
 */
export const CONFUSABLES: Readonly<Record<string, string>> = {
  // Cyrillic
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
  "ѕ": "s", "і": "i", "ј": "j", "ԁ": "d", "ԛ": "q", "ԝ": "w", "ӏ": "l", "һ": "h", "ɡ": "g",
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "Ѕ": "S",
  "І": "I", "Ј": "J", "Ү": "Y", "Ԁ": "D", "Ԛ": "Q", "Ԝ": "W",
  // Greek
  "α": "a", "ο": "o", "ν": "v", "ρ": "p", "ι": "i", "υ": "u", "χ": "x",
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X",
  // Armenian and others seen in the wild
  "օ": "o", "ս": "u", "ց": "g", "ɑ": "a", "ı": "i",
};

const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "u");
const LATIN_RE = /[A-Za-z]/;

/** Characters that take no space on the page but split words for a computer. */
export const INVISIBLE_RE = /[​-‍⁠﻿᠎­]/;

export function hasConfusable(s: string): boolean {
  return CONFUSABLE_RE.test(s);
}

/**
 * Maps look-alike letters to Latin in a word that mixes them with Latin letters, or is made only of look-alikes
 * (a whole disguised word). Genuine Russian or Greek words, which contain letters with no Latin twin, are kept.
 */
export function unconfuseWord(word: string): string {
  if (!CONFUSABLE_RE.test(word)) return word;
  const chars = [...word];
  const allConfusable = chars.every((c) => CONFUSABLES[c] !== undefined || !/\p{L}/u.test(c));
  if (!allConfusable && !LATIN_RE.test(word)) return word;
  return chars.map((c) => CONFUSABLES[c] ?? c).join("");
}

/**
 * Whether a word that mixes Latin letters with look-alikes reads as a disguised English word rather than
 * notation. Symbols in maths and physics (Qν, Eν, pν) are two letters, one Latin and one Greek, so a disguised
 * word needs three letters or more ("thе" or "sее" with Cyrillic е still count).
 */
export function mixedWordLooksDisguised(word: string): boolean {
  const letters = [...word].filter((c) => /\p{L}/u.test(c));
  const latin = letters.filter((c) => /[A-Za-z]/.test(c)).length;
  return latin >= 1 && letters.length >= 3;
}
