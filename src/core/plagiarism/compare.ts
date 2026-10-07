import { splitReferences } from "../text/sections.ts";
import { tokenize, type Token } from "../text/tokens.ts";
import { buildBodyIndex, findRuns, type BodyIndex } from "./match.ts";

/** One paper in a set being compared with each other, such as a class's submissions. */
export interface ComparedPaper {
  id: string;
  name: string;
  text: string;
}

/** A passage two papers share, as character offsets in each. */
export interface SharedPassage {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
  words: number;
}

export interface PairResult {
  a: string;
  b: string;
  /** Share of each paper's words that also appear in the other, 0 to 100. */
  aPercent: number;
  bPercent: number;
  sharedWords: number;
  passages: SharedPassage[];
}

export interface CompareResult {
  papers: Array<{ id: string; name: string; words: number }>;
  pairs: PairResult[];
}

interface Prepared {
  paper: ComparedPaper;
  tokens: Token[];
  /** Tokens that are left out: template text (such as the assignment's questions). */
  ignored: Uint8Array;
  index: BodyIndex;
  words: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Compares every paper with every other one, word for word (runs of `minRun` words or more, small edits
 * bridged). Reference lists are left out, and so is any text given as `ignore`, such as an assignment's
 * questions that every student repeats. Pure and synchronous per pair; `onProgress` lets a page stay responsive.
 */
export async function comparePapers(
  papers: readonly ComparedPaper[],
  options: { ignore?: string; minRun?: number; onProgress?: (done: number, total: number) => void; yieldEvery?: number } = {},
): Promise<CompareResult> {
  const minRun = options.minRun ?? 8;
  const ignoreWords = options.ignore?.trim() ? tokenize(options.ignore).map((t) => t.word) : [];
  const prepared: Prepared[] = papers.map((paper) => {
    const body = splitReferences(paper.text).body;
    const tokens = tokenize(body);
    const index = buildBodyIndex(tokens);
    const ignored = new Uint8Array(tokens.length);
    if (ignoreWords.length) for (const r of findRuns(index, ignoreWords, { minRun: 6 })) for (let t = r.start; t < r.end; t++) ignored[t] = 1;
    return { paper, tokens, ignored, index, words: tokens.map((t) => t.word) };
  });
  const pairs: PairResult[] = [];
  const total = (prepared.length * (prepared.length - 1)) / 2;
  let done = 0;
  for (let i = 0; i < prepared.length; i++)
    for (let j = i + 1; j < prepared.length; j++) {
      const A = prepared[i]!;
      const B = prepared[j]!;
      const coveredA = new Uint8Array(A.tokens.length);
      const coveredB = new Uint8Array(B.tokens.length);
      const passages: SharedPassage[] = [];
      for (const r of findRuns(A.index, B.words, { minRun })) {
        // Skip runs that are mostly template text.
        let kept = 0;
        for (let t = r.start; t < r.end; t++) if (!A.ignored[t]) kept++;
        if (kept < minRun) continue;
        const len = r.end - r.start;
        const bEndTok = Math.min(B.tokens.length - 1, r.sourceStart + len - 1);
        for (let t = r.start; t < r.end; t++) if (!A.ignored[t]) coveredA[t] = 1;
        for (let t = r.sourceStart; t <= bEndTok; t++) coveredB[t] = 1;
        passages.push({ aStart: A.tokens[r.start]!.start, aEnd: A.tokens[r.end - 1]!.end, bStart: B.tokens[r.sourceStart]!.start, bEnd: B.tokens[bEndTok]!.end, words: kept });
      }
      const sumA = coveredA.reduce((n, v) => n + v, 0);
      const sumB = coveredB.reduce((n, v) => n + v, 0);
      pairs.push({
        a: A.paper.id,
        b: B.paper.id,
        aPercent: A.tokens.length ? round1((sumA / A.tokens.length) * 100) : 0,
        bPercent: B.tokens.length ? round1((sumB / B.tokens.length) * 100) : 0,
        sharedWords: sumA,
        passages: passages.sort((x, y) => x.aStart - y.aStart),
      });
      done++;
      options.onProgress?.(done, total);
      if (options.yieldEvery && done % options.yieldEvery === 0) await new Promise((r) => setTimeout(r, 0));
    }
  return {
    papers: prepared.map((p) => ({ id: p.paper.id, name: p.paper.name, words: p.tokens.length })),
    pairs: pairs.sort((x, y) => Math.max(y.aPercent, y.bPercent) - Math.max(x.aPercent, x.bPercent)),
  };
}
