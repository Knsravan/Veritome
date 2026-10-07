import type { IssueCategory } from "@/core/grammar/types";

export const CATEGORY_LABEL: Record<IssueCategory, string> = {
  spelling: "Spelling",
  grammar: "Grammar",
  punctuation: "Punctuation",
  style: "Style",
  clarity: "Clarity",
  academic: "Academic register",
  consistency: "Consistency",
};

export const SEVERITY_LABEL = { error: "Likely error", warning: "Worth a look", info: "Suggestion" } as const;
