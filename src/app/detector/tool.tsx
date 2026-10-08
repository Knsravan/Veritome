"use client";

import { useEffect, useRef, useState } from "react";
import { FileDrop, type LoadedPaper } from "@/components/FileDrop";
import { fileOf, SeenBefore, useSavedCheck } from "@/components/HistoryBits";
import { aiBreakdown } from "@/core/detector/breakdown";
import { saveCheck, titleFor } from "@/lib/history";
import {
  ArrowRightIcon,
  FileIcon,
  PenIcon,
  ScanIcon,
  ShieldIcon,
  SparkIcon,
} from "@/components/icons";
import {
  ReportProgress,
  type ProgressState,
} from "@/components/report/ReportProgress";
import { Button, Checkbox, Notice, cx } from "@/components/ui";
import type { DetectorResult } from "@/core/detector/types";
import type { PaperReport, ReportEvent, ToolId } from "@/core/report/report";
import { reflowParagraphs } from "@/core/text/reflow";
import { ApiError, postNdjson } from "@/lib/api";
import type { DocModel } from "@/lib/doc/model";
import { sampleDocx } from "@/lib/sample-file";
import { useHasLlm, useSettings } from "@/lib/settings";
import { AiResult } from "./ai-result";

type Mode = "text" | "file";
const countWords = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;
const OFF: Record<ToolId, "off"> = {
  plagiarism: "off",
  detector: "off",
  citations: "off",
  grammar: "off",
  paraphrase: "off",
  humanise: "off",
};

/** Joins lines broken inside sentences (as text copied from a PDF often is), undoes line-end hyphens and tidies spaces. */
export function tidyPasted(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/(\p{Ll})-\n(\p{Ll})/gu, "$1$2")
    .replace(/([^\n.!?:;])\n(?!\n)(?=\S)/g, "$1 ")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stats(text: string) {
  const words = countWords(text);
  const sentences = (text.match(/[.!?](\s|$)/g) ?? []).length;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim()).length;
  return {
    words,
    sentences,
    paragraphs,
    minutes: Math.max(1, Math.round(words / 230)),
  };
}

/**
 * The AI detector: paste text, or upload a paper and see it in its own layout with the paragraphs that read as
 * AI-written or AI-polished underlined.
 */
export function DetectorTool() {
  const [mode, setMode] = useState<Mode>("text");
  const [result, setResult] = useState<{
    result: DetectorResult;
    text: string;
    doc: DocModel | null;
    fileName?: string;
    from: LoadedPaper | null;
  } | null>(null);
  const [running, setRunning] = useState<{
    words: number;
    paper?: LoadedPaper;
    progress: ProgressState;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [paper, setPaper] = useState<LoadedPaper | null>(null);
  const [useLlm, setUseLlm] = useState(false);
  const hasLlm = useHasLlm();
  const { llmFields } = useSettings();
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);
  const opening = useSavedCheck("detector", (entry, saved) => {
    const r = (entry.payload as { result?: DetectorResult } | null)?.result;
    if (!r) return;
    setResult({
      result: r,
      text: entry.text,
      doc: saved?.doc ?? null,
      ...(saved ? { fileName: saved.name } : entry.file ? { fileName: entry.file.name } : {}),
      from: saved,
    });
  });
  // Start fetching the neural models as soon as there is something to check, so the check itself is quicker.
  const wantsModels = countWords(text) >= 20 || paper !== null;
  useEffect(() => {
    if (wantsModels)
      void import("@/lib/ai-model/neural").then((m) => m.preloadNeural());
  }, [wantsModels]);
  // The mode is read from the address after the first render, so server and browser render the same page first.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "file")
      setMode("file");
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (mode === "file") url.searchParams.set("mode", "file");
    else url.searchParams.delete("mode");
    window.history.replaceState(null, "", url);
  }, [mode]);

  const check = async (input: string, from: LoadedPaper | null) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setError(null);
    const base: ProgressState = {
      steps: { ...OFF, detector: "running" },
      extra: { label: "AI writing, second opinion", state: "waiting" },
    };
    setRunning({
      words: countWords(input),
      ...(from ? { paper: from } : {}),
      progress: base,
    });
    window.scrollTo({ top: 0 });
    try {
      let report: PaperReport | null = null;
      await postNdjson<ReportEvent>(
        "/api/report",
        {
          text: input,
          tools: {
            ...Object.fromEntries(Object.keys(OFF).map((k) => [k, false])),
            detector: true,
          },
          external: false,
          useLlm: useLlm && hasLlm,
          stream: true,
          ...llmFields(),
        },
        (ev) => {
          if (ev.type === "result") report = ev.report;
          else if (ev.type === "error") throw new ApiError(ev.error, 500);
        },
        c.signal,
      );
      const done = report as PaperReport | null;
      if (c.signal.aborted) return;
      if (!done || done.detector.status !== "done")
        throw new ApiError(
          done?.detector.status === "error"
            ? done.detector.message
            : "The check stopped before it finished. Try again.",
          0,
        );
      setRunning((r) =>
        r
          ? {
              ...r,
              progress: {
                steps: { ...OFF, detector: "done" },
                extra: {
                  label: "AI writing, second opinion",
                  state: "running",
                  text: "Reading each paragraph with the neural models in your browser",
                },
              },
            }
          : r,
      );
      const { withNeuralOpinion } = await import("@/lib/ai-model/neural");
      const merged = await withNeuralOpinion(
        done.detector.result,
        input,
        c.signal,
      );
      if (c.signal.aborted) return;
      setResult({
        result: merged,
        text: input,
        doc: from?.doc && from.doc.text === input ? from.doc : null,
        ...(from ? { fileName: from.name } : {}),
        from,
      });
      const b = aiBreakdown(merged, input);
      void saveCheck({
        tool: "detector",
        title: titleFor(input, from?.name),
        words: countWords(input),
        figures: b.judged ? [{ label: "AI writing", value: `${Math.round(b.aiPercent)}%` }] : [],
        text: input,
        ...(fileOf(from) ? { file: fileOf(from)! } : {}),
        payload: { result: merged },
      });
    } catch (err) {
      if (c.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      if (!c.signal.aborted) setRunning(null);
    }
  };

  if (running) {
    return (
      <ReportProgress
        order={["detector"]}
        state={running.progress}
        words={running.words}
        sources={false}
        onCancel={() => {
          ctrl.current?.abort();
          setRunning(null);
        }}
        {...(running.paper
          ? {
              fileName: running.paper.name,
              kind: running.paper.kind,
              preview: running.paper.thumb ?? null,
            }
          : {})}
      />
    );
  }

  if (result) {
    const { from, ...shown } = result;
    return (
      <AiResult
        {...shown}
        onNew={() => setResult(null)}
        onRetry={() => void check(result.text, from)}
      />
    );
  }

  const s = stats(text);
  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <p className="animate-fade-up text-sm font-semibold tracking-wide text-action uppercase">
          AI detector
        </p>
        <h1
          className="animate-fade-up mt-2 font-display text-3xl font-bold tracking-tight sm:text-[2.6rem] sm:leading-[1.1]"
          style={{ ["--i" as string]: 1 }}
        >
          Find the parts that read as AI-written
        </h1>
        <p
          className="animate-fade-up mt-3 text-lg text-ink-soft"
          style={{ ["--i" as string]: 2 }}
        >
          Trained models read every paragraph, including text written by a
          person and then polished with an AI tool. Upload your paper to see it
          in its own layout with those parts underlined, or paste some text.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="How to check"
        className="animate-fade-up inline-flex rounded-full border border-rule bg-page p-1 shadow-sm"
        style={{ ["--i" as string]: 3 }}
      >
        {(
          [
            ["text", "Text", "Paste text", PenIcon],
            ["file", "File", "Upload a paper", FileIcon],
          ] as const
        ).map(([m, label, hint, Icon]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cx(
              "inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition-[background-color,color] duration-200",
              mode === m
                ? "bg-ink text-page shadow-sm"
                : "text-ink-soft hover:bg-desk-deep hover:text-ink",
            )}
            title={hint}
          >
            <Icon size={16} /> {label} mode
          </button>
        ))}
      </div>

      {opening === "missing" && (
        <Notice kind="warn" title="That saved check is no longer here">
          It may have been deleted from your history, or saved in another browser.
        </Notice>
      )}
      <SeenBefore
        tool="detector"
        text={mode === "file" ? (paper?.text ?? "") : reflowParagraphs(tidyPasted(text))}
      />
      {error && (
        <Notice kind="error" title="The check did not finish">
          {error}
        </Notice>
      )}

      {mode === "text" ? (
        <section
          aria-label="Your text"
          className="card animate-fade-up overflow-hidden"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3 sm:px-6">
            <label htmlFor="ai-text" className="font-semibold">
              Paste your text
            </label>
            <div className="flex items-center gap-4 text-sm">
              <span
                className={cx(
                  "rounded-full px-2.5 py-0.5 font-semibold tabular-nums",
                  s.words >= 80
                    ? "bg-action-soft text-action"
                    : "bg-desk-deep text-ink-soft",
                )}
                aria-live="polite"
              >
                {s.words.toLocaleString("en")} words
              </span>
              <button
                type="button"
                onClick={() => setText("")}
                disabled={!text}
                className="font-semibold text-ink-soft hover:text-ink disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </div>
          <textarea
            id="ai-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              // Text copied from a PDF breaks lines mid-sentence; join them so paragraphs are read whole.
              const pasted = e.clipboardData.getData("text/plain");
              if (!pasted || !/\n/.test(pasted)) return;
              e.preventDefault();
              const el = e.currentTarget;
              const next =
                text.slice(0, el.selectionStart) +
                tidyPasted(pasted) +
                text.slice(el.selectionEnd);
              setText(next.slice(0, 400_000));
            }}
            placeholder="Paste a paragraph, an essay or a whole paper here. At least 80 words; 300 or more gives the steadiest result."
            spellCheck={false}
            className="block min-h-[22rem] w-full resize-y bg-page px-5 py-4 font-serif text-[1.05rem] leading-[1.75] text-ink placeholder:font-sans placeholder:text-base placeholder:text-ink-faint focus:outline-none sm:px-6"
          />
          <div className="space-y-3 border-t border-rule bg-desk/40 px-5 py-4 sm:px-6">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-desk-deep"
              aria-hidden
            >
              <div
                className={cx(
                  "h-full rounded-full transition-[width] duration-500",
                  s.words >= 300
                    ? "bg-ok"
                    : s.words >= 80
                      ? "bg-warn"
                      : "bg-ink-faint",
                )}
                style={{ width: `${Math.min(100, (s.words / 300) * 100)}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="text-sm text-ink-soft">
                <p className="font-medium text-ink">
                  {s.words < 80
                    ? `${80 - s.words} more words needed`
                    : s.words < 300
                      ? "Enough to check · 300+ words is steadier"
                      : "Plenty of text for a steady result"}
                </p>
                <p>
                  {s.sentences} sentences · {s.paragraphs} paragraph
                  {s.paragraphs === 1 ? "" : "s"} · about {s.minutes} min to
                  read
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                {hasLlm && (
                  <Checkbox
                    checked={useLlm}
                    onChange={setUseLlm}
                    label="Also ask the language model"
                  />
                )}
                <Button
                  className="h-12 px-6 text-base"
                  disabled={s.words < 80}
                  onClick={() => void check(reflowParagraphs(tidyPasted(text)), null)}
                >
                  Check for AI writing <ArrowRightIcon />
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section
          aria-label="Your file"
          className="card animate-fade-up space-y-5 p-4 sm:p-6"
        >
          <FileDrop paper={paper} onPaper={setPaper} sample={sampleDocx} />
          <div className="flex flex-wrap items-center justify-end gap-4">
            {hasLlm && (
              <Checkbox
                checked={useLlm}
                onChange={setUseLlm}
                label="Also ask the language model"
              />
            )}
            <Button
              className="h-12 px-6 text-base"
              disabled={!paper}
              onClick={() => paper && void check(paper.text, paper)}
            >
              Check for AI writing <ArrowRightIcon />
            </Button>
          </div>
        </section>
      )}

      <ul className="grid gap-3 sm:grid-cols-3" aria-label="About this check">
        {(
          [
            [
              ScanIcon,
              "Every paragraph is read",
              "Two trained models judge each paragraph, including text a person wrote and then polished with AI.",
            ],
            [
              ShieldIcon,
              "Nothing leaves your device",
              "The models run in your browser and nothing is stored on our servers.",
            ],
            [
              SparkIcon,
              "A signal, not proof",
              "About 1 in 100 human paragraphs is flagged. Read each flag in context.",
            ],
          ] as const
        ).map(([Icon, title, body]) => (
          <li key={title} className="card flex gap-3 p-4">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-action-soft text-action">
              <Icon size={18} />
            </span>
            <span>
              <span className="block font-semibold">{title}</span>
              <span className="text-sm text-ink-soft">{body}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
