import type { AiBreakdown } from "../detector/breakdown.ts";
import { splitReferences } from "../text/sections.ts";
import { splitParagraphs } from "../text/sentences.ts";
import { tokenize } from "../text/tokens.ts";

export interface ParagraphStat {
  index: number;
  start: number;
  end: number;
  words: number;
  /** Share of the paragraph's words matched word for word, 0 to 1. */
  copied: number;
  /** Share of the paragraph's words in reworded sentences, 0 to 1. */
  reworded: number;
  /** The AI estimate for the paragraph's segment, 0 to 1, when the AI check ran. */
  ai?: number;
  /** "ai", "uncertain" or "human" when the AI check ran. */
  aiKind?: "ai" | "uncertain" | "human";
}

const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/**
 * Per-paragraph figures for the charts: how much of each paragraph matches a source, how much is reworded,
 * and how AI-like it reads. Headings (under 8 words) and the reference list are left out.
 */
type Range = { start: number; end: number };

export function paragraphStats(text: string, report: { spans: readonly Range[]; paraphrases: readonly Range[] }, ai?: AiBreakdown | null): ParagraphStat[] {
  const body = splitReferences(text).body;
  const out: ParagraphStat[] = [];
  for (const p of splitParagraphs(body)) {
    const tokens = tokenize(p.text);
    if (tokens.length < 8) continue;
    const words = tokens.length;
    const absolute = tokens.map((t) => ({ start: p.start + t.start, end: p.start + t.end }));
    const inAny = (ranges: ReadonlyArray<{ start: number; end: number }>) => absolute.filter((t) => ranges.some((r) => overlap(t, r) > 0)).length;
    const stat: ParagraphStat = {
      index: out.length + 1,
      start: p.start,
      end: p.end,
      words,
      copied: inAny(report.spans) / words,
      reworded: inAny(report.paraphrases) / words,
    };
    if (ai?.judged) {
      const covering = ai.regions.filter((r) => overlap(r, p) > 0);
      if (covering.length) {
        // The region covering most of the paragraph decides its class; the estimate is the highest within it.
        const main = covering.reduce((a, b) => (overlap(b, p) > overlap(a, p) ? b : a));
        stat.ai = main.probability;
        stat.aiKind = main.kind;
      }
    }
    out.push(stat);
  }
  return out;
}
