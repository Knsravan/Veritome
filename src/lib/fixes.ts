import type { Issue } from "@/core/grammar/types";

/**
 * Applies one replacement and moves the remaining issues so their offsets stay
 * valid. Issues overlapping the edited span are dropped.
 */
export function applyIssueFix(text: string, issues: readonly Issue[], issue: Issue, replacement: string): { text: string; issues: Issue[] } {
  const next = text.slice(0, issue.start) + replacement + text.slice(issue.end);
  const delta = replacement.length - (issue.end - issue.start);
  const remaining: Issue[] = [];
  for (const i of issues) {
    if (i.id === issue.id) continue;
    if (i.end <= issue.start) remaining.push(i);
    else if (i.start >= issue.end) remaining.push({ ...i, start: i.start + delta, end: i.end + delta });
  }
  return { text: next, issues: remaining };
}
