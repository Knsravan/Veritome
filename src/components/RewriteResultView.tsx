"use client";

import { useState } from "react";
import type { RewriteResult } from "@/core/rewrite/types";
import { BandBar } from "./BandBar";
import { DiffView } from "./DiffView";
import { VERDICT_TEXT } from "./DetectorResultView";
import { Button, Notice, Sheet, Warnings, cx } from "./ui";

export function RewriteResultView({ result, compact = false }: { result: RewriteResult; compact?: boolean }) {
  const [view, setView] = useState<"changes" | "clean">("changes");
  const [copied, setCopied] = useState(false);
  const { before, after } = result.detector;
  const failed = result.chunks.filter((c) => c.status === "kept_original");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="How to show the rewrite" className="neu-in inline-flex rounded-full p-1">
          {(["changes", "clean"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cx("rounded-full px-3.5 py-1.5 text-sm font-semibold transition-[box-shadow,color] duration-200", view === v ? "neu-on" : "text-ink-soft hover:text-ink")}
            >
              {v === "changes" ? "Show changes" : "Clean text"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-faint">
            {Math.round(result.changed * 100)}% of words changed, {result.method === "llm" ? `rewritten by ${result.model}` : "rule-based edits only"}
          </span>
          <Button variant="secondary" onClick={copy}>
            {copied ? "Copied" : "Copy text"}
          </Button>
        </div>
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? "Rewritten text copied to the clipboard." : ""}
      </span>
      <Sheet label="Rewritten text">{view === "changes" ? <DiffView before={result.original} after={result.text} /> : <div className="sheet-text">{result.text}</div>}</Sheet>
      <Warnings items={result.warnings} />
      {failed.length > 0 && !compact && (
        <details className="neu-raised rounded-xl px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold">Why {failed.length === 1 ? "one passage was" : `${failed.length} passages were`} left unchanged</summary>
          <ul className="mt-2 space-y-2">
            {failed.map((c, i) => (
              <li key={i}>
                <p className="line-clamp-2 font-serif">{c.original}</p>
                <ul className="mt-1 list-disc pl-5 text-ink-soft">
                  {c.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}
      <section aria-label="Writing-pattern score before and after" className="grid gap-4 sm:grid-cols-2">
        {[
          ["Before", before],
          ["After", after],
        ].map(([label, s]) => {
          const snap = s as typeof before;
          return (
            <div key={label as string} className="neu-raised rounded-xl px-4 py-3">
              <p className="text-sm font-semibold">
                {label as string}: {VERDICT_TEXT[snap.verdict]}
              </p>
              <div className="mt-2">
                <BandBar size="sm" score={snap.score} low={snap.band.low} high={snap.band.high} leftLabel="Few patterns" rightLabel="Many patterns" />
              </div>
              <p className="mt-1 text-xs text-ink-faint">
                Score {snap.score}, range {snap.band.low} to {snap.band.high}
              </p>
            </div>
          );
        })}
      </section>
      {result.disclosure && (
        <Notice kind="info" title="About disclosure">
          {result.disclosure}
        </Notice>
      )}
    </div>
  );
}
