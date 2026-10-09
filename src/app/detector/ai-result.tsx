"use client";

import { useMemo, useState } from "react";
import { DetectorResultView } from "@/components/DetectorResultView";
import { DocumentProvider } from "@/components/DocumentContext";
import { AiSummary } from "@/components/PlagiarismResultView";
import { PaperPanel } from "@/components/report/PaperPanel";
import { DownloadIcon, RepeatIcon } from "@/components/icons";
import { Button, Notice } from "@/components/ui";
import { aiBreakdown } from "@/core/detector/breakdown";
import { detectorOverview } from "@/core/detector/overview";
import type { DetectorResult } from "@/core/detector/types";
import type { PaperReport } from "@/core/report/report";
import type { DocModel } from "@/lib/doc/model";

const SKIPPED = {
  status: "skipped" as const,
  reason: "Not part of the AI check.",
};

/** A report holding only the AI-writing result, so the shared paper view and PDF report can show it. */
export function aiOnlyReport(result: DetectorResult): PaperReport {
  return {
    generatedAt: new Date().toISOString(),
    words: result.words,
    hasReferenceList: false,
    overview: [{ tool: "detector", ...detectorOverview(result) }],
    grammar: SKIPPED,
    detector: { status: "done", result },
    plagiarism: SKIPPED,
    citations: SKIPPED,
    paraphrase: SKIPPED,
    humanise: SKIPPED,
    disclaimer:
      "AI detection estimates how closely writing resembles text produced or polished by language models. It cannot prove who wrote a text: treat every flag as a reason to look again, never as proof.",
  };
}

const save = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/**
 * The AI-writing result: the share of the text that reads as AI-written, the paper itself (in its own layout when
 * it came from a file) with those paragraphs underlined, the detailed signals, and the downloads.
 */
export function AiResult({
  result,
  text,
  doc,
  fileName,
  onNew,
  onRetry,
}: {
  result: DetectorResult;
  text: string;
  doc: DocModel | null;
  fileName?: string;
  onNew: () => void;
  /** Runs the check again (offered when the neural models could not run). */
  onRetry?: () => void;
}) {
  const report = useMemo(() => aiOnlyReport(result), [result]);
  const b = useMemo(() => aiBreakdown(result, text), [result, text]);
  const [busy, setBusy] = useState<null | "report" | "file">(null);
  const [failed, setFailed] = useState(false);
  const base = (fileName ?? "text").replace(/\.[^.]+$/, "");

  const downloadReport = async () => {
    setBusy("report");
    setFailed(false);
    try {
      const { buildReportPdf } = await import("@/lib/pdf/report-pdf");
      save(
        await buildReportPdf(report, text, doc, fileName ? { fileName } : {}),
        `${base}-veritome-ai-report.pdf`,
      );
    } catch (err) {
      console.error(
        "Veritome download failed:",
        err instanceof Error ? err.message : err,
      );
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const downloadMarked = async () => {
    if (!doc) return;
    setBusy("file");
    setFailed(false);
    try {
      const { markedOriginal } = await import("@/lib/pdf/marked-original");
      const out = await markedOriginal(report, text, doc);
      save(out.blob, `${base}-ai-marked.${out.ext}`);
    } catch (err) {
      console.error(
        "Veritome download failed:",
        err instanceof Error ? err.message : err,
      );
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <DocumentProvider doc={doc}>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold tracking-wide text-action uppercase">
              AI detector report
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">
              {fileName ?? "Your text"}
            </h1>
            <p className="mt-1 text-ink-soft">
              {result.words.toLocaleString("en")} words checked ·{" "}
              {new Date(report.generatedAt).toLocaleString("en", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onNew}>
              <RepeatIcon size={16} /> Check another
            </Button>
            {doc && (doc.kind === "pdf" || doc.kind === "docx") && (
              <Button
                variant="pillow"
                onClick={() => void downloadMarked()}
                busy={busy === "file"}
              >
                <DownloadIcon />{" "}
                {busy === "file"
                  ? "Marking your file"
                  : `Download marked ${doc.kind === "pdf" ? "PDF" : "Word file"}`}
              </Button>
            )}
            <Button
              variant="pillow"
              onClick={() => void downloadReport()}
              busy={busy === "report"}
            >
              <DownloadIcon />{" "}
              {busy === "report" ? "Making the report" : "Download PDF report"}
            </Button>
          </div>
        </header>
        {failed && (
          <Notice kind="error">
            The download could not be made in this browser. Try another browser.
          </Notice>
        )}

        <AiSummary ai={result} b={b} {...(onRetry ? { onRetry } : {})} />

        <section aria-labelledby="paper-h" className="space-y-3">
          <h2 id="paper-h" className="font-display text-xl font-semibold">
            {doc ? "Your paper, in its own layout" : "Your text"}
          </h2>
          <PaperPanel
            report={report}
            text={text}
            label="Your paper with the AI-written parts underlined"
            noun={doc ? "paper" : "text"}
          />
        </section>

        <details className="card group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 font-semibold">
            Detailed signals: score range, style measurements and flagged
            sentences
            <span
              aria-hidden
              className="text-ink-faint transition-transform duration-200 group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <div className="border-t border-rule p-5">
            <DetectorResultView text={text} result={result} />
          </div>
        </details>
      </div>
    </DocumentProvider>
  );
}
