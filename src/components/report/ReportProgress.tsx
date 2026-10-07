"use client";

import { useEffect, useState } from "react";
import type { ToolId } from "@/core/report/report";
import { FileTypeIcon } from "../FileTypeIcon";
import { CheckIcon, MinusIcon } from "../icons";
import { Button, cx } from "../ui";
import { TOOL_LABEL } from "./labels";

export type StepState = "waiting" | "running" | "done" | "off";

export interface ProgressState {
  steps: Record<ToolId, StepState>;
  /** Passages searched so far for the plagiarism check. */
  plagiarism?: { done: number; total: number };
  /** A browser-side step after the server checks, such as checking pictures. */
  extra?: { label: string; state: StepState; text?: string };
}

const RUNNING_TEXT: Record<ToolId, string> = {
  plagiarism: "Searching scholarly databases and the open web for matching passages",
  detector: "Scoring the writing with the trained model",
  citations: "Looking up each reference and checking in-text citations",
  grammar: "Checking grammar, spelling and readability",
  paraphrase: "Drafting rewrites for matched passages",
  humanise: "Drafting revisions for formulaic paragraphs",
};

const SOURCES = ["OpenAlex", "Crossref", "Europe PMC", "arXiv", "Semantic Scholar", "CORE", "Wikipedia", "The web"];

const TIPS = [
  "Every match is compared with the whole source, not just the sentence that was searched.",
  "Look-alike letters, invisible characters and hidden white text are undone before checking.",
  "Your file never leaves your browser; only short passages are sent to search services.",
  "Each reference is looked up to catch wrong details, missing entries and retracted papers.",
  "Findings will be underlined on your paper in its own layout, each with a fix.",
  "Text translated from English sources and reuse of your own earlier papers are checked too.",
];

function useTick(ms: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}

const fmt = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);

const LINES = [92, 100, 86, 97, 74, 100, 95, 60, 100, 88, 96, 70, 90, 84];
const UNDERLINES: Array<{ tool: ToolId; line: number; from: number; to: number; cls: string }> = [
  { tool: "plagiarism", line: 1, from: 8, to: 70, cls: "scan-u-copied" },
  { tool: "plagiarism", line: 6, from: 20, to: 90, cls: "scan-u-copied" },
  { tool: "detector", line: 3, from: 0, to: 97, cls: "scan-u-ai" },
  { tool: "detector", line: 4, from: 0, to: 74, cls: "scan-u-ai" },
  { tool: "citations", line: 8, from: 40, to: 100, cls: "scan-u-cite" },
  { tool: "grammar", line: 10, from: 30, to: 46, cls: "scan-u-grammar" },
  { tool: "grammar", line: 12, from: 50, to: 66, cls: "scan-u-grammar" },
];

/** The paper being read: its first page (or a page sketch), a beam moving down it and a lens sweeping across. */
function PaperStage({ state, done, preview, kind }: { state: ProgressState; done: boolean; preview?: string | null; kind?: string }) {
  return (
    <div aria-hidden className="relative mx-auto w-56">
      <div className="relative aspect-[1/1.3] overflow-hidden rounded-lg border border-rule bg-page shadow-[var(--shadow-lift)]">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-full w-full object-cover object-top" />
        ) : (
          <div className="space-y-[0.62rem] px-5 py-6">
            <div className="mx-auto mb-4 h-2.5 w-3/4 rounded-full bg-ink/15" />
            {LINES.map((w, i) => (
              <div key={i} className="relative h-1.5">
                <div className="h-full rounded-full bg-desk-deep" style={{ width: `${w}%` }} />
                {UNDERLINES.filter((u) => u.line === i && state.steps[u.tool] === "done").map((u) => (
                  <div key={`${u.tool}${u.from}`} className={cx("scan-u animate-grow-x absolute -bottom-1", u.cls)} style={{ left: `${u.from}%`, width: `${Math.min(w, u.to) - u.from}%` }} />
                ))}
              </div>
            ))}
          </div>
        )}
        {!done && <div className="scan-beam" />}
        {!done && <div className="scan-lens" />}
        {done && (
          <div className="animate-fade-in absolute inset-0 flex items-center justify-center bg-page/70 backdrop-blur-[2px]">
            <span className="animate-pop inline-flex size-16 items-center justify-center rounded-full bg-ok text-page shadow-lg">
              <CheckIcon size={32} strokeWidth={3} />
            </span>
          </div>
        )}
      </div>
      {kind && (
        <span className="absolute -right-5 -bottom-5">
          <FileTypeIcon kind={kind} size={44} className="drop-shadow-[0_8px_12px_rgb(15_23_42/0.2)]" />
        </span>
      )}
    </div>
  );
}

/** A ring that fills as the checks finish, with the percentage inside. */
function Ring({ pct }: { pct: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-24 shrink-0">
      <svg viewBox="0 0 80 80" className="size-full -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--desk-deep)" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="var(--action)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display text-xl font-semibold tabular-nums">{pct}%</span>
    </div>
  );
}

export function ReportProgress({
  order,
  state,
  words,
  onCancel,
  preview,
  kind,
  fileName,
}: {
  order: readonly ToolId[];
  state: ProgressState;
  words: number;
  onCancel: () => void;
  /** A picture of the paper's first page. */
  preview?: string | null;
  kind?: string;
  fileName?: string;
}) {
  const elapsed = useTick(1000);
  const tip = Math.floor(elapsed / 5) % TIPS.length;
  const active = order.filter((id) => state.steps[id] !== "off");
  const plag = state.plagiarism;
  const fraction = active.reduce((n, id) => {
    const st = state.steps[id];
    if (st === "done") return n + 1;
    if (st === "running" && id === "plagiarism" && plag && plag.total > 0) return n + 0.9 * (plag.done / plag.total);
    if (st === "running") return n + 0.15;
    return n;
  }, 0);
  const ex = state.extra;
  const exFraction = ex ? (ex.state === "done" ? 1 : ex.state === "running" ? 0.4 : 0) : 0;
  const parts = active.length + (ex ? 1 : 0);
  const pct = parts ? Math.round(((fraction + exFraction) / parts) * 100) : 0;
  const searching = state.steps.plagiarism === "running";
  const lit = elapsed % SOURCES.length;

  const steps: Array<{ key: string; label: string; st: StepState; text?: string }> = [
    ...order.map((id) => ({
      key: id,
      label: TOOL_LABEL[id],
      st: state.steps[id],
      text: id === "plagiarism" && plag && plag.total > 0 ? `${RUNNING_TEXT[id]} (${plag.done} of ${plag.total} searches)` : RUNNING_TEXT[id],
    })),
    ...(ex ? [{ key: "extra", label: ex.label, st: ex.state, ...(ex.text ? { text: ex.text } : {}) }] : []),
  ];

  return (
    <section aria-labelledby="progress-h" className="card animate-fade-up relative mx-auto max-w-4xl overflow-hidden p-6 sm:p-8">
      <div aria-hidden className="pointer-events-none absolute -top-32 -left-32 size-80 rounded-full bg-action/10 blur-3xl" />
      <div className="relative grid gap-10 md:grid-cols-[16rem_1fr]">
        <div className="space-y-8">
          <PaperStage state={state} done={pct >= 100} {...(preview !== undefined ? { preview } : {})} {...(kind ? { kind } : {})} />
          <div>
            <p className="mb-2 text-center text-xs font-semibold tracking-wide text-ink-faint uppercase">{searching ? "Searching" : "Sources"}</p>
            <ul aria-hidden className="flex flex-wrap justify-center gap-1.5">
              {SOURCES.map((s, i) => (
                <li
                  key={s}
                  className={cx(
                    "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-all duration-500",
                    searching && i === lit ? "scale-105 border-action bg-action text-action-ink shadow-[0_4px_14px_-4px_var(--action)]" : "border-rule bg-page text-ink-soft",
                  )}
                >
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-5">
            <div role="progressbar" aria-label="Overall progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <Ring pct={pct} />
            </div>
            <div className="min-w-0">
              <h2 id="progress-h" className="font-display text-2xl font-semibold">
                {pct >= 100 ? "Your report is ready" : "Checking your paper"}
              </h2>
              <p className="mt-1 truncate text-sm text-ink-soft">
                {fileName ? `${fileName} · ` : ""}
                {words.toLocaleString("en")} words · <span className="tabular-nums">{fmt(elapsed)}</span>
              </p>
            </div>
          </div>

          <ol className="mt-6 space-y-1" aria-live="polite">
            {steps.map((s, i) => (
              <li
                key={s.key}
                className={cx("animate-fade-up flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors duration-300", s.st === "running" && "bg-action-soft/70")}
                style={{ ["--i" as string]: i }}
              >
                <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center" aria-hidden>
                  {s.st === "done" ? (
                    <span className="animate-pop inline-flex size-6 items-center justify-center rounded-full bg-ok text-page">
                      <CheckIcon size={15} strokeWidth={2.6} />
                    </span>
                  ) : s.st === "running" ? (
                    <span className="relative inline-flex size-5">
                      <span className="absolute inset-0 animate-ping rounded-full bg-action/30" />
                      <span className="relative inline-block size-5 animate-spin rounded-full border-2 border-action border-r-transparent" />
                    </span>
                  ) : s.st === "off" ? (
                    <span className="inline-flex size-6 items-center justify-center rounded-full bg-desk-deep text-ink-faint">
                      <MinusIcon size={14} />
                    </span>
                  ) : (
                    <span className="inline-block size-5 rounded-full border-2 border-rule" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cx("font-semibold", s.st === "off" && "text-ink-faint", s.st === "waiting" && "text-ink-soft")}>
                    {s.label}
                    <span className="sr-only">: {s.st === "done" ? "done" : s.st === "running" ? "in progress" : s.st === "off" ? "not selected" : "waiting"}</span>
                  </p>
                  {s.st === "running" && s.text && <p className="animate-fade-in text-sm text-ink-soft">{s.text}</p>}
                  {s.st === "off" && <p className="text-sm text-ink-faint">Not selected</p>}
                </div>
              </li>
            ))}
          </ol>

          <p key={tip} className="animate-fade-in mt-5 rounded-xl border border-dashed border-rule px-4 py-3 text-sm text-ink-soft">
            <span className="font-semibold text-ink">Did you know? </span>
            {TIPS[tip]}
          </p>

          <div className="mt-5 flex items-center justify-between gap-4 border-t border-rule pt-4">
            <p className="text-sm text-ink-faint">Most papers take one to three minutes. Keep this tab open.</p>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
