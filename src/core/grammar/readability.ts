import { countSyllables } from "../text/tokens.ts";
import { mattr, round } from "../text/stats.ts";
import { passiveSentenceRatio, type RuleContext } from "./rules.ts";
import { countWords } from "../text/tokens.ts";
import type { ReadabilityMetrics } from "./types.ts";

export function readabilityLevel(fleschReadingEase: number): string {
  if (fleschReadingEase >= 90) return "Very easy";
  if (fleschReadingEase >= 80) return "Easy";
  if (fleschReadingEase >= 70) return "Fairly easy";
  if (fleschReadingEase >= 60) return "Plain English";
  if (fleschReadingEase >= 50) return "Fairly difficult";
  if (fleschReadingEase >= 30) return "Difficult (typical of academic writing)";
  return "Very difficult";
}

export function computeReadability(ctx: RuleContext): ReadabilityMetrics {
  const words = ctx.tokens.length;
  const sentences = Math.max(1, ctx.sentences.length);
  if (words === 0) {
    return {
      words: 0,
      sentences: 0,
      avgSentenceLength: 0,
      longestSentence: 0,
      fleschReadingEase: 0,
      fleschKincaidGrade: 0,
      passiveSentenceRatio: 0,
      lexicalDiversity: 0,
      level: "No text",
    };
  }
  let syllables = 0;
  for (const t of ctx.tokens) syllables += Math.max(1, countSyllables(t.raw));
  const wordsPerSentence = words / sentences;
  const syllablesPerWord = syllables / words;
  const fre = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
  const fk = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;
  const longest = ctx.sentences.reduce((max, s) => Math.max(max, countWords(s.text)), 0);
  return {
    words,
    sentences: ctx.sentences.length,
    avgSentenceLength: round(wordsPerSentence, 1),
    longestSentence: longest,
    fleschReadingEase: round(fre, 1),
    fleschKincaidGrade: round(fk, 1),
    passiveSentenceRatio: round(passiveSentenceRatio(ctx.sentences), 2),
    lexicalDiversity: round(
      mattr(
        ctx.tokens.map((t) => t.word),
        50,
      ),
      3,
    ),
    level: readabilityLevel(fre),
  };
}
