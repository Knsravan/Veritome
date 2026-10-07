import { extractKeyphrases } from "../citations/finder.ts";
import { splitSentences } from "../text/sentences.ts";
import { isStopword, tokenize } from "../text/tokens.ts";
import { MASK_CHAR } from "../text/protect.ts";

export interface Passage {
  start: number;
  end: number;
  text: string;
  /** How distinctive the wording is. Higher passages are better search probes. */
  score: number;
  /** A run of consecutive words suitable for an exact-phrase web search. */
  phrase: string;
  /** Up to two non-overlapping exact phrases, best first, so one edited word does not hide a copied passage. */
  phrases?: string[];
  /** Keywords for databases that search topics rather than phrases. */
  keywords: string;
}

function wordWeight(word: string): number {
  if (isStopword(word)) return 0;
  if (/^\d+$/.test(word)) return 0.2;
  return 1 + Math.min(word.length, 14) / 7;
}

/**
 * One exact-phrase probe per sentence (its most distinctive run of `size` words),
 * best first, up to `max`. Probing each sentence separately means a copied
 * sentence next to an original one is still searched for.
 */
export function pickPhrases(text: string, size = 8, max = 3): string[] {
  const out: Array<{ phrase: string; score: number }> = [];
  for (const s of splitSentences(text)) {
    const tokens = tokenize(s.text);
    if (tokens.length < 6) continue;
    const n = Math.min(size, tokens.length);
    let best = 0;
    let bestScore = -1;
    let score = 0;
    for (let i = 0; i < tokens.length; i++) {
      score += wordWeight((tokens[i] as { word: string }).word);
      if (i >= n) score -= wordWeight((tokens[i - n] as { word: string }).word);
      if (i >= n - 1 && score > bestScore) {
        bestScore = score;
        best = i - n + 1;
      }
    }
    const first = tokens[best] as { start: number };
    const last = tokens[best + n - 1] as { end: number };
    out.push({ phrase: s.text.slice(first.start, last.end).replace(/\s+/g, " ").trim(), score: bestScore });
  }
  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.phrase);
}

/** The most distinctive stretch of `size` consecutive words, for quoting in a search. */
export function pickPhrase(text: string, size = 10): string {
  const tokens = tokenize(text);
  if (tokens.length <= size) return text.replace(/\s+/g, " ").trim();
  let best = 0;
  let bestScore = -1;
  let score = 0;
  for (let i = 0; i < tokens.length; i++) {
    score += wordWeight((tokens[i] as { word: string }).word);
    if (i >= size) score -= wordWeight((tokens[i - size] as { word: string }).word);
    if (i >= size - 1 && score > bestScore) {
      bestScore = score;
      best = i - size + 1;
    }
  }
  const first = tokens[best] as { start: number };
  const last = tokens[best + size - 1] as { end: number };
  return text.slice(first.start, last.end).replace(/\s+/g, " ").trim();
}

function distinctiveness(text: string): number {
  const tokens = tokenize(text);
  const content = new Set<string>();
  let long = 0;
  let proper = 0;
  tokens.forEach((t, i) => {
    if (isStopword(t.word) || /^\d+$/.test(t.word)) return;
    content.add(t.word);
    if (t.word.length >= 9) long++;
    if (i > 0 && /^[A-Z]/.test(t.raw) && !/^[A-Z]+$/.test(t.raw)) proper++;
  });
  const masked = [...text].filter((c) => c === MASK_CHAR).length / Math.max(1, text.length);
  return (content.size + long * 0.5 + proper * 2) * (1 - Math.min(0.9, masked * 2));
}

export interface SelectOptions {
  minWords?: number;
  maxWords?: number;
}

/**
 * Picks passages to use as search probes. The text is cut into consecutive chunks of whole sentences (short
 * sentences are joined with the next one), so no sentence is skipped. When there are more chunks than probes, the
 * document is divided into as many bins as there are probes and the most distinctive chunk of each bin wins, so
 * the whole manuscript is sampled rather than only its opening.
 */
export function selectPassages(checkText: string, maxPassages: number, options: SelectOptions = {}): Passage[] {
  const minWords = options.minWords ?? 12;
  const maxWords = options.maxWords ?? 60;
  const sentences = splitSentences(checkText);
  const candidates: Passage[] = [];

  const consider = (start: number, end: number) => {
    const text = checkText.slice(start, end);
    if (tokenize(text).length < minWords) return;
    if (/^(?:table|figure|fig\.|equation)\b/i.test(text.trim())) return;
    const score = distinctiveness(text);
    const clean = text.replace(/\u0001+/g, " ");
    candidates.push({
      start,
      end,
      text: text.replace(/[\u0001\s]+/g, " ").trim(),
      score,
      phrase: pickPhrase(clean),
      phrases: pickPhrases(clean),
      keywords: extractKeyphrases(clean, 8).join(" "),
    });
  };

  // Consecutive chunks: a sentence on its own when it is long enough, otherwise joined with the following ones
  // (up to maxWords) so short sentences are searched too.
  for (let i = 0; i < sentences.length; ) {
    const first = sentences[i] as { start: number; end: number };
    let j = i;
    let words = tokenize(checkText.slice(first.start, first.end)).length;
    while (words < minWords && j + 1 < sentences.length) {
      const next = sentences[j + 1] as { start: number; end: number };
      const more = tokenize(checkText.slice(next.start, next.end)).length;
      if (words + more > maxWords) break;
      j++;
      words += more;
    }
    consider(first.start, (sentences[j] as { end: number }).end);
    i = j + 1;
  }
  if (candidates.length === 0 || maxPassages <= 0) return [];
  // With enough searches for everything, search everything: copied sentences can be plain ones.
  if (candidates.length <= maxPassages) return candidates.filter((c) => c.phrase);
  // Otherwise skip the blandest chunks and sample the rest evenly.
  const pool = candidates.filter((c) => c.score >= 5);

  const total = checkText.length || 1;
  const bins = Math.min(maxPassages, pool.length);
  const chosen: Passage[] = [];
  for (let b = 0; b < bins; b++) {
    const lo = (b / bins) * total;
    const hi = ((b + 1) / bins) * total;
    const inBin = pool
      .filter((c) => c.start >= lo && c.start < hi && !chosen.some((x) => c.start < x.end && x.start < c.end))
      .sort((x, y) => y.score - x.score);
    const pick = inBin[0];
    if (pick) chosen.push(pick);
  }
  return chosen.sort((x, y) => x.start - y.start);
}
