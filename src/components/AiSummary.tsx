"use client";

import type { AiBreakdown } from "@/core/detector/breakdown";
import type { DetectorResult } from "@/core/detector/types";
import { StackedBar } from "./charts";
import { CountUp } from "./motion";
import { Notice } from "./ui";

/** Shown when the neural models judged the paper as a whole. */
export function WholePaperNote({
  doc,
}: {
  doc: NonNullable<DetectorResult["model"]["document"]>;
}) {
  return (
    <p className="rounded-md border-l-4 border-[var(--chart-ai)] bg-desk/60 px-3 py-2 text-sm text-ink-soft">
      <span className="font-semibold text-ink">Whole-paper check: </span>
      {doc.aboveHumanRange} of {doc.paragraphs} paragraphs (
      {Math.round(doc.share * 100)}%) score above the range of human writing.
      Only about 1 in 100 human-written papers we tested did this, so those
      paragraphs are marked as likely AI-written or AI-polished.
    </p>
  );
}

const AI_LABEL = {
  ai: "Likely AI-written",
  uncertain: "Unclear",
  human: "Likely human-written",
} as const;

/** The AI-writing score: what share of the text reads as machine-written, with how far to trust it. */
export function AiSummary({
  ai,
  b,
  onRetry,
}: {
  ai: DetectorResult;
  b: AiBreakdown;
  /** Runs the check again; offered when the neural models could not run. */
  onRetry?: () => void;
}) {
  return (
    <>
      {ai.model.neural === "unavailable" && (
        <Notice
          kind="error"
          title="The AI models could not run in this browser"
        >
          The trained models that read each paragraph did not load (a blocked or
          slow connection, or an older browser), so this AI result comes from a
          much simpler check and can miss AI writing entirely. Please do not
          rely on it.{" "}
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="font-semibold text-action hover:underline"
            >
              Try again
            </button>
          ) : (
            "Run the check again, or try another browser."
          )}
        </Notice>
      )}
      <section
        aria-label="AI writing summary"
        style={{ ["--i" as string]: 1 }}
        className="animate-fade-up card grid gap-6 p-5 sm:p-6 lg:grid-cols-[auto_1fr]"
      >
        <div className="lg:min-w-48 lg:border-r lg:border-rule lg:pr-8">
          <p className="text-sm font-semibold text-ink-soft">AI writing</p>
          {b.judged ? (
            <>
              <p className="font-display text-6xl font-semibold tracking-tight tabular-nums">
                <CountUp
                  value={b.aiPercent}
                  decimals={Number.isInteger(b.aiPercent) ? 0 : 1}
                />
                <span className="text-3xl text-ink-faint">%</span>
              </p>
              <p className="mt-1 font-semibold">
                {b.aiPercent >= 20
                  ? "Parts read as AI-written"
                  : b.aiPercent > 0
                    ? "A little reads as AI-written"
                    : "No AI-written parts found"}
              </p>
              <p className="text-sm text-ink-soft">
                of the text is in paragraphs that read as likely AI-written.
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 font-display text-4xl font-semibold text-ink-faint">
                –
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                {ai.model.neural === "unavailable"
                  ? "Not judged: the AI models did not run."
                  : "Not enough text to judge. AI detection needs about 150 words or more."}
              </p>
            </>
          )}
        </div>
        <div className="space-y-3">
          {b.judged && (
            <div>
              <p className="mb-2 text-sm font-semibold">How the text reads</p>
              <StackedBar
                label="How the text reads"
                segments={[
                  {
                    key: "ai",
                    label: AI_LABEL.ai,
                    value: b.aiPercent,
                    color: "var(--chart-ai)",
                  },
                  {
                    key: "uncertain",
                    label: AI_LABEL.uncertain,
                    value: b.uncertainPercent,
                    color: "var(--chart-neutral)",
                  },
                  {
                    key: "human",
                    label: AI_LABEL.human,
                    value: b.humanPercent,
                    color: "var(--chart-human)",
                  },
                ]}
              />
            </div>
          )}
          <div className="rounded-md bg-desk/60 px-3 py-2 text-sm text-ink-soft">
            <p>
              <span className="font-semibold text-ink">
                How far to trust this:{" "}
              </span>
              in testing on writing it had never seen, it flagged about 1 in 100
              human paragraphs and about 1 in 100 human papers. It caught about
              three in four texts heavily polished by AI and about half of
              research paragraphs AI tools wrote or polished; light polishing
              often passes. A high score is a reason to look again, never proof.
            </p>
          </div>
          {ai.model.document && <WholePaperNote doc={ai.model.document} />}
          {ai.warnings.filter((w) => !w.includes("per-section")).length > 0 && (
            <p className="text-sm text-ink-faint">
              {ai.warnings.filter((w) => !w.includes("per-section")).join(" ")}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
