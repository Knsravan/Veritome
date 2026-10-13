import type { Issue, IssueKind } from "@/core/plagiarism/review";
import type { MatchedSource } from "@/core/plagiarism/types";

export const VERDICT = {
  low: "Low similarity",
  moderate: "Some similarity to review",
  high: "High similarity",
} as const;

export const KIND_STYLE: Record<
  IssueKind,
  { bar: string; chip: string; dot: string }
> = {
  copied_uncited: {
    bar: "bg-danger",
    chip: "bg-danger-soft text-danger",
    dot: "bg-[var(--status-critical)]",
  },
  disguised: {
    bar: "bg-danger",
    chip: "bg-danger-soft text-danger",
    dot: "bg-[var(--status-critical)]",
  },
  tortured: {
    bar: "bg-danger",
    chip: "bg-danger-soft text-danger",
    dot: "bg-[var(--status-critical)]",
  },
  copied_cited: {
    bar: "bg-warn",
    chip: "bg-warn-soft text-warn",
    dot: "bg-[var(--status-serious)]",
  },
  translated: {
    bar: "bg-danger",
    chip: "bg-danger-soft text-danger",
    dot: "bg-[var(--status-serious)]",
  },
  own_work: {
    bar: "bg-warn",
    chip: "bg-warn-soft text-warn",
    dot: "bg-[var(--status-warning)]",
  },
  reworded_uncited: {
    bar: "bg-ai",
    chip: "bg-warn-soft text-warn",
    dot: "bg-[var(--status-warning)]",
  },
  quote_uncited: {
    bar: "bg-cite",
    chip: "bg-cite-soft text-cite",
    dot: "bg-cite",
  },
  reworded_cited: {
    bar: "bg-ink-faint",
    chip: "bg-desk-deep text-ink-soft",
    dot: "bg-ink-faint",
  },
  repeated: {
    bar: "bg-ink-soft",
    chip: "bg-desk-deep text-ink-soft",
    dot: "bg-ink-soft",
  },
};

/** Severity colours (status palette); every segment is also named in the legend. */
export const KIND_COLOR: Record<IssueKind, string> = {
  copied_uncited: "var(--status-critical)",
  disguised: "var(--status-critical)",
  tortured: "var(--status-critical)",
  copied_cited: "var(--status-serious)",
  translated: "var(--status-serious)",
  own_work: "var(--status-warning)",
  reworded_uncited: "var(--status-warning)",
  quote_uncited: "var(--chart-neutral)",
  reworded_cited: "var(--chart-neutral)",
  repeated: "var(--chart-neutral)",
};

export const BREAKDOWN_ORDER: IssueKind[] = [
  "copied_uncited",
  "copied_cited",
  "own_work",
  "reworded_uncited",
  "repeated",
];
export const SHORT_LABEL: Record<IssueKind, string> = {
  copied_uncited: "Copied, not cited",
  disguised: "Disguised text",
  tortured: "Paraphrasing-tool phrase",
  copied_cited: "Cited, missing quotation marks",
  translated: "Translated, not cited",
  own_work: "Reused from your earlier paper",
  reworded_uncited: "Reworded, not cited",
  quote_uncited: "Quotation without citation",
  reworded_cited: "Reworded, cited",
  repeated: "Repeated in your text",
};

/** Numbers credited sources 1 to 6 so each gets its own highlight colour; later ones share colours. */
export function sourceColours(
  sources: readonly MatchedSource[],
): Map<string, number> {
  return new Map(sources.map((s, i) => [s.id, (i % 6) + 1]));
}

/** One id per finding, shared by its mark in the text and its row in the list. */
export const issueId = (i: Issue) => `${i.kind}-${i.start}`;

/** Badge colour slot (1 to 6) for a source numbered `n`. */
export const badgeSlot = (n: number) => ((n - 1) % 6) + 1;
