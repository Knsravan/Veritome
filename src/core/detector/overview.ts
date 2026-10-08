import type { DetectorResult } from "./types.ts";

/** The AI-writing line of the report summary. */
export function detectorOverview(d: DetectorResult): { status: "attention" | "review" | "skipped" | "ok"; headline: string } {
  return {
    status: d.verdict === "likely_ai" ? "attention" : d.verdict === "uncertain" ? "review" : d.verdict === "insufficient_text" ? "skipped" : "ok",
    headline: d.verdict === "insufficient_text" ? "Not enough text to judge." : `Pattern score ${d.score} (plausible range ${d.band.low} to ${d.band.high}).`,
  };
}
