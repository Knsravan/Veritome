import { isStopword, type Token } from "../text/tokens.ts";

/** A stretch of the checked text (token indices, end exclusive) that also appears in a source. */
export interface Run {
  /** First matched token in the checked text. */
  start: number;
  /** One past the last matched token in the checked text. */
  end: number;
  /** First matched token in the source. */
  sourceStart: number;
  /** Words actually shared. Less than end - start when small edits were bridged. */
  matchedWords: number;
}

export interface MatchOptions {
  /** Shortest exact run, in words, that counts as a match. Default 6. */
  minRun?: number;
  /** Words of insertion or substitution tolerated between two runs. Default 2. */
  maxGap?: number;
  /** Runs made mostly of stop words ("in the case of the") are ignored below this content-word share. Default 0.4. */
  minContentRatio?: number;
  /** A run must contain at least this many distinct words. Default 4. */
  minDistinctWords?: number;
}

const DEFAULT_SEED = 3;

export interface BodyIndex {
  words: readonly string[];
  grams: Map<string, number[]>;
  /** Length of the word sequences used to find candidate matches. */
  seed: number;
}

/** Indexes every short word sequence of the checked text so many sources can be compared cheaply. */
export function buildBodyIndex(tokens: readonly Token[], seed = DEFAULT_SEED): BodyIndex {
  const words = tokens.map((t) => t.word);
  const grams = new Map<string, number[]>();
  for (let i = 0; i + seed <= words.length; i++) {
    const key = words.slice(i, i + seed).join(" ");
    const list = grams.get(key);
    if (list) list.push(i);
    else grams.set(key, [i]);
  }
  return { words, grams, seed };
}

function contentRatio(words: readonly string[], start: number, end: number): number {
  let content = 0;
  for (let i = start; i < end; i++) if (!isStopword(words[i] as string)) content++;
  return content / Math.max(1, end - start);
}

/**
 * Finds runs of identical words shared between the indexed text and a source.
 * Runs separated by at most `maxGap` edited words are merged so light rewording
 * does not hide a copied passage.
 */
export function findRuns(index: BodyIndex, sourceWords: readonly string[], options: MatchOptions = {}): Run[] {
  const seed = index.seed;
  const minRun = Math.max(seed, options.minRun ?? 6);
  const maxGap = options.maxGap ?? 2;
  const minContent = options.minContentRatio ?? 0.4;
  const minDistinct = options.minDistinctWords ?? 4;
  const body = index.words;

  // 1. Maximal exact runs, one per diagonal position.
  const exact: Run[] = [];
  const nextFree = new Map<number, number>();
  for (let j = 0; j + seed <= sourceWords.length; j++) {
    const positions = index.grams.get(sourceWords.slice(j, j + seed).join(" "));
    if (!positions) continue;
    for (const i of positions) {
      const diagonal = i - j;
      if ((nextFree.get(diagonal) ?? -1) > j) continue;
      let a = i;
      let b = j;
      while (a > 0 && b > 0 && body[a - 1] === sourceWords[b - 1]) {
        a--;
        b--;
      }
      let length = 0;
      while (a + length < body.length && b + length < sourceWords.length && body[a + length] === sourceWords[b + length]) length++;
      nextFree.set(diagonal, b + length);
      exact.push({ start: a, end: a + length, sourceStart: b, matchedWords: length });
    }
  }
  if (exact.length === 0) return [];

  // 2. Merge nearby runs that continue each other in both texts.
  exact.sort((x, y) => x.start - y.start || y.end - x.end);
  const merged: Run[] = [];
  for (const run of exact) {
    const last = merged[merged.length - 1];
    if (last) {
      const gapBody = run.start - last.end;
      const lastSourceEnd = last.sourceStart + (last.end - last.start);
      const gapSource = run.sourceStart - lastSourceEnd;
      if (gapBody >= 0 && gapBody <= maxGap && gapSource >= 0 && gapSource <= maxGap) {
        last.end = run.end;
        last.matchedWords += run.matchedWords;
        continue;
      }
      if (run.start < last.end && run.end <= last.end) continue; // contained in the previous run
    }
    merged.push({ ...run });
  }

  // 3. Keep only runs long enough, with enough real content.
  const accepted: Run[] = [];
  for (const run of merged) {
    if (run.matchedWords < minRun) continue;
    if (contentRatio(body, run.start, run.end) < minContent) continue;
    if (new Set(body.slice(run.start, run.end)).size < minDistinct) continue;
    accepted.push(run);
  }

  // 4. Drop runs that overlap a longer accepted run from the same source.
  accepted.sort((x, y) => y.matchedWords - x.matchedWords);
  const covered = new Uint8Array(body.length);
  const final: Run[] = [];
  for (const run of accepted) {
    let already = 0;
    for (let i = run.start; i < run.end; i++) already += covered[i] as number;
    if (already > (run.end - run.start) / 2) continue;
    for (let i = run.start; i < run.end; i++) covered[i] = 1;
    final.push(run);
  }
  return final.sort((x, y) => x.start - y.start);
}

/** Share of the checked text covered by any of the runs, 0 to 1. */
export function coverage(totalWords: number, runs: readonly Run[]): number {
  if (totalWords === 0) return 0;
  const covered = new Uint8Array(totalWords);
  for (const run of runs) for (let i = run.start; i < Math.min(run.end, totalWords); i++) covered[i] = 1;
  let n = 0;
  for (const c of covered) n += c;
  return n / totalWords;
}

/**
 * Runs where one stretch of the text repeats another stretch of the same text.
 * Used to catch self-plagiarism within a manuscript and accidental duplication.
 */
export function findSelfRepeats(tokens: readonly Token[], minRun = 12): Array<{ first: Run; second: Run }> {
  const words = tokens.map((t) => t.word);
  const index = buildBodyIndex(tokens);
  const out: Array<{ first: Run; second: Run }> = [];
  const used = new Uint8Array(words.length);
  for (let i = 0; i + index.seed <= words.length; i++) {
    if (used[i]) continue;
    const positions = index.grams.get(words.slice(i, i + index.seed).join(" "));
    if (!positions) continue;
    for (const j of positions) {
      if (j <= i) continue;
      let length = 0;
      while (j + length < words.length && words[i + length] === words[j + length] && i + length < j) length++;
      if (length >= minRun && contentRatio(words, i, i + length) >= 0.4) {
        out.push({
          first: { start: i, end: i + length, sourceStart: j, matchedWords: length },
          second: { start: j, end: j + length, sourceStart: i, matchedWords: length },
        });
        for (let k = i; k < i + length; k++) used[k] = 1;
        for (let k = j; k < j + length; k++) used[k] = 1;
        break;
      }
    }
  }
  return out;
}
