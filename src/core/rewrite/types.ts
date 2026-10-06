import type { DetectorVerdict } from "../detector/types.ts";

export type ParaphraseMode = "academic" | "simple" | "concise" | "expand";
export type RewriteMode = ParaphraseMode | "humanise";

export type ChunkStatus =
  /** Rewritten by the language model and every check passed. */
  | "rewritten"
  /** Light rule-based edits only (no language model available). */
  | "rules"
  /** Every attempt failed a check, so the original was kept. */
  | "kept_original";

export interface RewriteChunk {
  original: string;
  rewritten: string;
  status: ChunkStatus;
  attempts: number;
  /** Why attempts were rejected, in plain language. */
  problems: string[];
}

export interface DetectorSnapshot {
  score: number;
  band: { low: number; high: number };
  verdict: DetectorVerdict;
}

export interface RewriteResult {
  mode: RewriteMode;
  method: "llm" | "rules";
  model?: string;
  original: string;
  text: string;
  chunks: RewriteChunk[];
  /** Citations, maths, URLs and cross-references that were locked. */
  protectedCount: number;
  /** Share of the original's words that changed, 0 to 1. */
  changed: number;
  detector: { before: DetectorSnapshot; after: DetectorSnapshot };
  warnings: string[];
  /** Shown with humaniser output. */
  disclosure?: string;
}
