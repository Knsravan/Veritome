"use client";

import type { AiBreakdown } from "@/core/detector/breakdown";
import { ISSUE_TEXT, type Issue, type IssueKind } from "@/core/plagiarism/review";
import { CheckIcon } from "../icons";
import { cx } from "../ui";
import { KIND_STYLE, badgeSlot, issueId } from "./shared";

/** "What to fix": AI-written parts, then findings grouped by kind, most serious first. */
export function FindingsList({
  text,
  issues,
  aiRegions,
  aiFlagged,
  active,
  number,
  onSelect,
  onShowAi,
}: {
  text: string;
  issues: readonly Issue[];
  aiRegions: AiBreakdown["regions"];
  aiFlagged: AiBreakdown["regions"];
  active: string | null;
  number: (sourceId: string | undefined) => number | undefined;
  onSelect: (id: string) => void;
  /** Shows AI region `k` (its mark id is `ai${k}`). */
  onShowAi: (k: number) => void;
}) {
  const grouped = (Object.keys(ISSUE_TEXT) as IssueKind[])
    .map((k) => ({ kind: k, items: issues.filter((i) => i.kind === k) }))
    .filter((g) => g.items.length);
  return (
    <section aria-labelledby="mistakes-h">
      <h3 id="mistakes-h" className="font-semibold">
        What to fix ({issues.length + aiFlagged.length})
      </h3>
      {aiFlagged.length > 0 && (
        <details open className="card mt-2 overflow-hidden">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm font-semibold">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full bg-[var(--chart-ai)]"
            />
            <span className="flex-1">Reads as AI-written</span>
            <span className="rounded-full bg-ai-soft px-2 text-xs text-ai tabular-nums">
              {aiFlagged.length}
            </span>
          </summary>
          <p className="border-t border-rule px-3 py-2 text-sm text-ink-soft">
            Rewrite these parts in your own words and voice. If you used
            an AI tool, say so in the way your journal or university
            asks. This is a pattern match, not proof, so ignore it if
            you wrote the text yourself.
          </p>
          <ol className="divide-y divide-rule border-t border-rule">
            {aiFlagged.map((x, i) => (
              <li key={x.start}>
                <button
                  type="button"
                  onClick={() => onShowAi(aiRegions.indexOf(x))}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-desk/60"
                >
                  <span className="line-clamp-2 font-serif">
                    “{text.slice(x.start, x.end).replace(/\s+/g, " ")}”
                  </span>
                  <span className="text-xs text-ink-faint">
                    Part {i + 1} · about{" "}
                    {text.slice(x.start, x.end).split(/\s+/).length}{" "}
                    words
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </details>
      )}
      {issues.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
          <CheckIcon size={16} className="text-ok" strokeWidth={2.4} />{" "}
          No copied or reworded passages in the sources searched.
        </p>
      ) : (
        <div className="mt-2 space-y-3">
          {grouped.map((g) => (
            <details
              key={g.kind}
              open={ISSUE_TEXT[g.kind].serious || grouped.length <= 2}
              className="card overflow-hidden"
            >
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm font-semibold">
                <span
                  aria-hidden
                  className={cx(
                    "size-2.5 shrink-0 rounded-full",
                    KIND_STYLE[g.kind].dot,
                  )}
                />
                <span className="flex-1">
                  {ISSUE_TEXT[g.kind].title}
                </span>
                <span
                  className={cx(
                    "rounded-full px-2 text-xs tabular-nums",
                    KIND_STYLE[g.kind].chip,
                  )}
                >
                  {g.items.length}
                </span>
              </summary>
              <p className="border-t border-rule px-3 py-2 text-sm text-ink-soft">
                {ISSUE_TEXT[g.kind].fix}
              </p>
              <ol className="divide-y divide-rule border-t border-rule">
                {g.items.map((i) => {
                  const n = number(i.sourceId);
                  return (
                    <li key={issueId(i)}>
                      <button
                        type="button"
                        aria-current={
                          active === issueId(i) ? "true" : undefined
                        }
                        onClick={() => onSelect(issueId(i))}
                        className={cx(
                          "flex w-full gap-2.5 px-3 py-2 text-left text-sm hover:bg-desk/60",
                          active === issueId(i) && "bg-action-soft/60",
                        )}
                      >
                        {n !== undefined ? (
                          <span
                            className="src-badge mt-0.5 shrink-0"
                            data-src={badgeSlot(n)}
                            aria-label={`Source ${n}`}
                          >
                            {n}
                          </span>
                        ) : (
                          <span
                            className="src-badge mt-0.5 shrink-0"
                            aria-hidden
                          >
                            “
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="line-clamp-2 font-serif">
                            “{i.text}”
                          </span>
                          <span className="text-xs text-ink-faint">
                            {i.words} words
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
