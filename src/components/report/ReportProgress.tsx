"use client";

import { useEffect, useState } from "react";
import type { ToolId } from "@/core/report/report";
import { CheckIcon, MinusIcon } from "../icons";
import { Button, cx } from "../ui";
import { TOOL_LABEL } from "./labels";

export type StepState = "waiting" | "running" | "done" | "off";

export interface ProgressState {
  steps: Record<ToolId, StepState>;
  /** Passages searched so far for the plagiarism check. */
  plagiarism?: { done: number; total: number };
}

const RUNNING_TEXT: Record<ToolId, string> = {
  plagiarism: "Searching scholarly databases and the open web for matching passages",
  detector: "Scoring the writing with the trained model",
  citations: "Looking up each reference and checking in-text citations",
  grammar: "Checking grammar, spelling and readability",
  paraphrase: "Drafting rewrites for matched passages",
  humanise: "Drafting revisions for formulaic paragraphs",
};

function useElapsed() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return s;
}

const fmt = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);

export function ReportProgress({ order, state, words, onCancel }: { order: readonly ToolId[]; state: ProgressState; words: number; onCancel: () => void }) {
  const elapsed = useElapsed();
  const active = order.filter((id) => state.steps[id] !== "off");
  const plag = state.plagiarism;
  const fraction = active.reduce((n, id) => {
    const st = state.steps[id];
    if (st === "done") return n + 1;
    if (st === "running" && id === "plagiarism" && plag && plag.total > 0) return n + 0.9 * (plag.done / plag.total);
    if (st === "running") return n + 0.15;
    return n;
  }, 0);
  const pct = active.length ? Math.round((fraction / active.length) * 100) : 0;

  return (
    <section aria-labelledby="progress-h" className="card mx-auto max-w-2xl p-6 sm:p-8">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="progress-h" className="font-display text-2xl font-semibold">
          Checking your paper
        </h2>
        <span className="text-sm text-ink-faint tabular-nums" aria-label={`Elapsed ${fmt(elapsed)}`}>
          {fmt(elapsed)}
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        {words.toLocaleString("en")} words. Most papers take one to three minutes; long reference lists take longer.
      </p>

      <div
        role="progressbar"
        aria-label="Overall progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mt-5 h-2 overflow-hidden rounded-full bg-desk-deep"
      >
        <div className="h-full rounded-full bg-action transition-[width] duration-500" style={{ width: `${Math.max(3, pct)}%` }} />
      </div>

      <ol className="mt-6 space-y-1" aria-live="polite">
        {order.map((id) => {
          const st = state.steps[id];
          return (
            <li key={id} className={cx("flex items-start gap-3 rounded-lg px-3 py-2.5", st === "running" && "bg-action-soft/60")}>
              <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center" aria-hidden>
                {st === "done" ? (
                  <span className="inline-flex size-6 items-center justify-center rounded-full bg-ok text-page">
                    <CheckIcon size={15} strokeWidth={2.6} />
                  </span>
                ) : st === "running" ? (
                  <span className="inline-block size-5 animate-spin rounded-full border-2 border-action border-r-transparent" />
                ) : st === "off" ? (
                  <span className="inline-flex size-6 items-center justify-center rounded-full bg-desk-deep text-ink-faint">
                    <MinusIcon size={14} />
                  </span>
                ) : (
                  <span className="inline-block size-5 rounded-full border-2 border-rule" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cx("font-semibold", st === "off" && "text-ink-faint", st === "waiting" && "text-ink-soft")}>
                  {TOOL_LABEL[id]}
                  <span className="sr-only">: {st === "done" ? "done" : st === "running" ? "in progress" : st === "off" ? "not selected" : "waiting"}</span>
                </p>
                {st === "running" && (
                  <p className="text-sm text-ink-soft">
                    {RUNNING_TEXT[id]}
                    {id === "plagiarism" && plag && plag.total > 0 && (
                      <span className="tabular-nums">
                        {" "}
                        ({plag.done} of {plag.total} searches)
                      </span>
                    )}
                  </p>
                )}
                {st === "off" && <p className="text-sm text-ink-faint">Not selected</p>}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 flex items-center justify-between gap-4 border-t border-rule pt-4">
        <p className="text-sm text-ink-faint">Keep this tab open. Your text is not stored.</p>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
