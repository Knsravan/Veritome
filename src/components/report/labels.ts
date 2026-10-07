import type { OverviewStatus, ToolId } from "@/core/report/report";

export const TOOL_LABEL: Record<ToolId, string> = {
  plagiarism: "Plagiarism",
  detector: "AI writing patterns",
  citations: "Citations",
  grammar: "Grammar and style",
  paraphrase: "Paraphrase suggestions",
  humanise: "Revision suggestions",
};

export const TOOL_HINT: Record<ToolId, string> = {
  plagiarism: "Copied and reworded passages in published papers, the web and your documents.",
  detector: "Writing patterns common in AI-generated text, with a confidence range.",
  citations: "Every reference looked up, in-text citations cross-checked, uncited claims found.",
  grammar: "Grammar, spelling, academic style and readability.",
  paraphrase: "Suggested rewrites for the longest matched passages.",
  humanise: "Suggested revisions for the most formulaic paragraphs.",
};

export const ORDER: readonly ToolId[] = ["plagiarism", "detector", "citations", "grammar", "paraphrase", "humanise"];

export const STATUS: Record<OverviewStatus, { text: string; tone: Tone }> = {
  ok: { text: "Looks fine", tone: "ok" },
  review: { text: "Worth reviewing", tone: "warn" },
  attention: { text: "Needs attention", tone: "danger" },
  skipped: { text: "No result", tone: "muted" },
  error: { text: "Failed", tone: "danger" },
};

export type Tone = "ok" | "warn" | "danger" | "muted";

export const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  muted: "bg-desk-deep text-ink-faint",
};

export const TONE_BAR: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  muted: "bg-rule",
};
