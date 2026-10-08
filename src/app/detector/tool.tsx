"use client";

import { useEffect, useRef, useState } from "react";
import { FileDrop, type LoadedPaper } from "@/components/FileDrop";
import {
  FileIcon,
  PenIcon,
  ShieldIcon,
  ArrowRightIcon,
} from "@/components/icons";
import {
  ReportProgress,
  type ProgressState,
} from "@/components/report/ReportProgress";
import { TextSource } from "@/components/TextSource";
import { Button, Checkbox, Notice, cx } from "@/components/ui";
import type { DetectorResult } from "@/core/detector/types";
import type { PaperReport, ReportEvent, ToolId } from "@/core/report/report";
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

  if (result) return <AiResult {...result} onNew={() => setResult(null)} />;

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

      {error && (
        <Notice kind="error" title="The check did not finish">
          {error}
        </Notice>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section
          aria-label={mode === "file" ? "Your file" : "Your text"}
          className="card animate-fade-up p-4 sm:p-6"
        >
          {mode === "file" ? (
            <FileDrop paper={paper} onPaper={setPaper} sample={sampleDocx} />
          ) : (
            <div className="space-y-3">
              <TextSource
                value={text}
                onChange={setText}
                label="Your text"
                hint="Paste at least 80 words; 300 or more gives the steadiest result."
                sample={null}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <ul
                  className="flex flex-wrap gap-2"
                  aria-label="About your text"
                >
                  {[
                    `${s.words.toLocaleString("en")} words`,
                    `${s.sentences} sentences`,
                    `${s.paragraphs} paragraphs`,
                    `about ${s.minutes} min to read`,
                  ].map((x) => (
                    <li
                      key={x}
                      className="rounded-full border border-rule bg-page px-2.5 py-0.5 font-medium text-ink-soft"
                    >
                      {x}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => setText((t) => tidyPasted(t))}
                  disabled={!text.trim()}
                  className="font-semibold text-action hover:underline disabled:opacity-50"
                  title="Joins lines broken in the middle of sentences, as text copied from a PDF often is"
                >
                  Tidy pasted text
                </button>
              </div>
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
              <p className="text-xs text-ink-faint">
                {s.words < 80
                  ? `${80 - s.words} more words needed.`
                  : s.words < 300
                    ? "Enough to check; 300 words or more gives a steadier result."
                    : "Plenty of text for a steady result."}
              </p>
            </div>
          )}
        </section>

        <aside className="animate-fade-up space-y-4 lg:sticky lg:top-24">
          <section aria-label="Options" className="card space-y-4 p-4 sm:p-6">
            <Checkbox
              checked={useLlm && hasLlm}
              onChange={setUseLlm}
              disabled={!hasLlm}
              label="Also ask the language model"
              hint={
                hasLlm
                  ? "Sends the text to the configured model for a third opinion, shown separately."
                  : "No language model is configured on this server."
              }
            />
            <Button
              className="h-12 w-full text-base"
              disabled={mode === "file" ? !paper : countWords(text) < 80}
              onClick={() =>
                mode === "file"
                  ? paper && void check(paper.text, paper)
                  : void check(text, null)
              }
            >
              Check for AI writing <ArrowRightIcon />
            </Button>
          </section>
          <ul className="space-y-1.5 px-1 text-sm text-ink-soft">
            <li className="flex items-start gap-2">
              <ShieldIcon size={18} className="mt-0.5 shrink-0 text-ok" />
              Nothing is stored. The neural models run in your browser.
            </li>
            <li className="flex items-start gap-2">
              <ShieldIcon size={18} className="mt-0.5 shrink-0 text-ok" />
              About 1 in 100 human paragraphs is flagged: a flag is a reason to
              look again, never proof.
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
