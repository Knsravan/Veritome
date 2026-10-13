"use client";

import type { AiBreakdown } from "@/core/detector/breakdown";
import type { DetectorResult } from "@/core/detector/types";
import type { Issue } from "@/core/plagiarism/review";
import type { ParagraphStat } from "@/core/report/paragraphs";
import { ColumnStrip } from "../charts";
import { cx } from "../ui";

/** One column per paragraph for source matches, and for AI writing when it was judged. */
export function WhereInDocument({
  paras,
  issues,
  ai,
  aiB,
  aiRegions,
  onShowIssue,
  onShowAi,
}: {
  paras: readonly ParagraphStat[];
  issues: readonly Issue[];
  ai: DetectorResult | null | undefined;
  aiB: AiBreakdown | null;
  aiRegions: AiBreakdown["regions"];
  onShowIssue: (issue: Issue) => void;
  /** Shows AI region `k` (its mark id is `ai${k}`). */
  onShowAi: (k: number) => void;
}) {
  if (paras.length < 2) return null;
  return (
    <section
      aria-labelledby="where-h"
      style={{ ["--i" as string]: 2 }}
      className="animate-fade-up card p-5 sm:p-6"
    >
      <h3 id="where-h" className="font-semibold">
        Where in your document
      </h3>
      <p className="mt-1 text-sm text-ink-soft">
        One column per paragraph, in order. Select a column to jump to that
        paragraph's findings.
      </p>
      <div
        className={cx("mt-4 grid gap-8", aiB?.judged && "lg:grid-cols-2")}
      >
        <ColumnStrip
          title="Text matching a source"
          color="var(--chart-seq)"
          data={paras.map((p) => ({
            label: `Paragraph ${p.index}`,
            value: Math.min(1, p.copied + p.reworded),
            note: `${p.words} words${p.reworded > 0 ? `, ${Math.round(p.reworded * 100)}% reworded` : ""}`,
          }))}
          onSelect={(i) => {
            const p = paras[i];
            const hit =
              p &&
              issues.find(
                (x) =>
                  x.kind !== "quote_uncited" &&
                  x.start < p.end &&
                  x.end > p.start,
              );
            if (hit) onShowIssue(hit);
          }}
        />
        {aiB?.judged && ai && (
          <ColumnStrip
            title="How AI-like each paragraph reads"
            color="var(--chart-ai)"
            threshold={ai.model.thresholds.likelyAi}
            thresholdLabel="likely AI above this line"
            data={paras.map((p) => ({
              label: `Paragraph ${p.index}`,
              value: p.ai ?? 0,
              note:
                p.aiKind === "ai"
                  ? "likely AI-written"
                  : p.aiKind === "human"
                    ? "likely human-written"
                    : "unclear",
            }))}
            format={(v) => `${Math.round(v * 100)} / 100`}
            onSelect={(i) => {
              const p = paras[i];
              const k = p
                ? aiRegions.findIndex(
                    (x) => x.start < p.end && x.end > p.start,
                  )
                : -1;
              if (k >= 0) onShowAi(k);
            }}
          />
        )}
      </div>
    </section>
  );
}
