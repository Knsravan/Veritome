"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DiffView } from "@/components/DiffView";
import { FileDrop, type LoadedPaper } from "@/components/FileDrop";
import { SeenBefore, useSavedCheck } from "@/components/HistoryBits";
import { saveCheck, titleFor } from "@/lib/history";
import {
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FileIcon,
  PenIcon,
  RepeatIcon,
  ShieldIcon,
  SparkIcon,
  XIcon,
} from "@/components/icons";
import { Button, Notice, cx } from "@/components/ui";
import {
  HUMANISE_DISCLOSURE,
  HUMANISE_STRENGTHS,
  HUMANISE_TONES,
  planParagraphs,
  type HumaniseParagraphResult,
  type HumaniseStrength,
  type HumaniseTone,
} from "@/core/rewrite/humanise";
import { ApiError, postJson } from "@/lib/api";
import type { DocModel } from "@/lib/doc/model";
import { sampleDocx } from "@/lib/sample-file";
import { useSettings } from "@/lib/settings";
import { tidyPasted } from "../detector/tool";
import { FileResult } from "./file-result";
import { MakeYours } from "./make-yours";
import {
  buildFile,
  download,
  finalOf,
  finalText as joinFinal,
  type Item,
  type Job,
  type Mode,
} from "./shared";

const countWords = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;
/** Paragraphs revised at once; a whole file goes faster. */
const CONCURRENCY = { text: 3, file: 4 } as const;

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string; description: string }>;
  onChange: (v: T) => void;
}) {
  const current = options.find((o) => o.id === value);
  return (
    <div>
      <p className="mb-2 text-sm font-semibold" id={`${label}-label`}>
        {label}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={`${label}-label`}
        className="grid grid-cols-3 gap-1 rounded-xl border border-rule bg-page p-1"
      >
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={cx(
              "rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
              value === o.id
                ? "bg-ink text-page shadow-sm"
                : "text-ink-soft hover:bg-desk-deep hover:text-ink",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {current && (
        <p className="mt-1.5 text-xs text-ink-soft">{current.description}</p>
      )}
    </div>
  );
}

/**
 * The Humaniser: revises stiff or formulaic prose paragraph by paragraph, in the chosen tone and, optionally, the
 * author's own voice. Citations, numbers and equations stay locked, and each paragraph's meaning is checked.
 */
export function HumaniserTool() {
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [paper, setPaper] = useState<LoadedPaper | null>(null);
  const [tone, setTone] = useState<HumaniseTone>("academic");
  const [strength, setStrength] = useState<HumaniseStrength>("balanced");
  const [voice, setVoice] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const { status, llmFields } = useSettings();
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);
  // Finished results are saved to the history on this device, and kept up to date as paragraphs are reviewed.
  const savedId = useRef<string | null>(null);
  useEffect(() => {
    if (!job || running) return;
    if (job.items.some((it) => it.state === "waiting" || it.state === "working")) return;
    const t = setTimeout(() => {
      const revised = job.items.filter((it) => it.result?.status === "rewritten").length;
      const todo = job.items.filter((it) => it.piece.rewrite).length;
      void saveCheck({
        ...(savedId.current ? { id: savedId.current } : {}),
        tool: "humaniser",
        title: titleFor(job.text, job.fileName),
        words: countWords(job.text),
        figures: [{ label: "Revised", value: `${revised} of ${todo} paragraphs` }],
        text: job.text,
        ...(job.doc?.data ? { file: { name: job.doc.name, data: new Blob([job.doc.data.slice()]) } } : {}),
        payload: { tone: job.tone, items: job.items, mode: job.mode },
      }).then((id) => {
        if (id) savedId.current = id;
      });
    }, 800);
    return () => clearTimeout(t);
  }, [job, running]);
  const opening = useSavedCheck("humaniser", (entry, saved) => {
    const p = entry.payload as { tone?: HumaniseTone; items?: Item[]; mode?: Mode } | null;
    if (!p?.items) return;
    savedId.current = entry.id;
    setJob({
      mode: p.mode ?? (entry.file ? "file" : "text"),
      text: entry.text,
      tone: p.tone ?? "academic",
      doc: saved?.doc ?? null,
      ...(entry.file ? { fileName: entry.file.name } : {}),
      items: p.items,
    });
  });
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "file")
      setMode("file");
  }, []);

  const hasModel = Boolean(status?.llm);
  const words = countWords(text);

  const update = (i: number, patch: Partial<Item>) =>
    setJob((j) =>
      j
        ? {
            ...j,
            items: j.items.map((it, k) => (k === i ? { ...it, ...patch } : it)),
          }
        : j,
    );

  const humanise = async (j: Job, i: number, signal: AbortSignal) => {
    const it = j.items[i]!;
    const neighbour = (d: number) => {
      for (let k = i + d; k >= 0 && k < j.items.length; k += d)
        if (j.items[k]!.piece.rewrite) return j.items[k]!.piece.text;
      return undefined;
    };
    update(i, { state: "working", error: undefined });
    try {
      const before = neighbour(-1);
      const after = neighbour(1);
      const result = await postJson<HumaniseParagraphResult>(
        "/api/humanise",
        {
          text: it.piece.text,
          tone,
          strength,
          ...(voice.trim() ? { voice } : {}),
          ...(before ? { before } : {}),
          ...(after ? { after } : {}),
          ...llmFields(),
        },
        signal,
      );
      update(i, {
        state: "done",
        result,
        use: result.status === "rewritten" ? "revised" : "original",
      });
    } catch (err) {
      if (signal.aborted) return;
      const message =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "This paragraph could not be revised.";
      update(i, { state: "failed", error: message });
      // A missing model or a used-up daily limit stops the whole run.
      if (
        err instanceof ApiError &&
        (err.status === 503 || err.status === 429)
      ) {
        setFatal(message);
        ctrl.current?.abort();
      }
    }
  };

  const start = async (
    source: string,
    doc: DocModel | null,
    fileName?: string,
  ) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setFatal(null);
    savedId.current = null;
    const pieces = planParagraphs(source);
    const j: Job = {
      mode: doc || fileName ? "file" : "text",
      text: source,
      tone,
      doc,
      ...(fileName ? { fileName } : {}),
      items: pieces.map((piece) => ({
        piece,
        state: piece.rewrite ? "waiting" : "skip",
        use: "revised",
      })),
    };
    setJob(j);
    setRunning(true);
    window.scrollTo({ top: 0 });
    const queue = j.items
      .map((it, i) => (it.piece.rewrite ? i : -1))
      .filter((i) => i >= 0);
    const worker = async () => {
      for (
        let next = queue.shift();
        next !== undefined && !c.signal.aborted;
        next = queue.shift()
      )
        await humanise(j, next, c.signal);
    };
    await Promise.all(Array.from({ length: CONCURRENCY[j.mode] }, worker));
    if (ctrl.current === c) setRunning(false);
  };

  const retry = (i: number) => {
    if (!job) return;
    const c = new AbortController();
    void humanise(job, i, c.signal);
  };

  if (job)
    return job.mode === "file" ? (
      <FileResult
        job={job}
        running={running}
        fatal={fatal}
        onStop={() => {
          ctrl.current?.abort();
          setRunning(false);
        }}
        onNew={() => {
          ctrl.current?.abort();
          setRunning(false);
          setJob(null);
        }}
        onUpdate={update}
        onRetry={retry}
      />
    ) : (
      <Result
        job={job}
        running={running}
        fatal={fatal}
        onStop={() => {
          ctrl.current?.abort();
          setRunning(false);
        }}
        onNew={() => {
          ctrl.current?.abort();
          setRunning(false);
          setJob(null);
        }}
        onUpdate={update}
        onRetry={retry}
      />
    );

  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <p className="animate-fade-up text-sm font-semibold tracking-wide text-action uppercase">
          Humaniser
        </p>
        <h1
          className="animate-fade-up mt-2 font-display text-3xl font-bold tracking-tight sm:text-[2.6rem] sm:leading-[1.1]"
          style={{ ["--i" as string]: 1 }}
        >
          Make stiff writing read like you wrote it
        </h1>
        <p
          className="animate-fade-up mt-3 text-lg text-ink-soft"
          style={{ ["--i" as string]: 2 }}
        >
          Each paragraph is revised by an expert-level editor model: stock
          phrases go, sentences vary, and your citations, numbers and equations
          stay exactly as they are. You review every change before you keep it.
        </p>
      </header>

      {opening === "missing" && (
        <Notice kind="warn" title="That saved result is no longer here">
          It may have been deleted from your history, or saved in another browser.
        </Notice>
      )}
      <SeenBefore
        tool="humaniser"
        text={mode === "file" ? (paper?.text ?? "") : tidyPasted(text)}
      />
      {status && !hasModel && (
        <Notice kind="warn" title="The Humaniser is not switched on yet">
          It needs a language model, and none is set up on this server. Once one
          is added, this page works straight away.
        </Notice>
      )}

      <div
        role="tablist"
        aria-label="How to add your text"
        className="animate-fade-up inline-flex rounded-full border border-rule bg-page p-1 shadow-sm"
        style={{ ["--i" as string]: 3 }}
      >
        {(
          [
            ["text", "Text mode", PenIcon],
            ["file", "File mode", FileIcon],
          ] as const
        ).map(([m, label, Icon]) => (
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
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        {mode === "text" ? (
          <section
            aria-label="Your text"
            className="card animate-fade-up overflow-hidden"
          >
            <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3 sm:px-6">
              <label htmlFor="hum-text" className="font-semibold">
                Paste your text
              </label>
              <div className="flex items-center gap-4 text-sm">
                <span
                  className={cx(
                    "rounded-full px-2.5 py-0.5 font-semibold tabular-nums",
                    words >= 30
                      ? "bg-action-soft text-action"
                      : "bg-desk-deep text-ink-soft",
                  )}
                >
                  {words.toLocaleString("en")} words
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
              id="hum-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text/plain");
                if (!pasted || !/\n/.test(pasted)) return;
                e.preventDefault();
                const el = e.currentTarget;
                setText(
                  (
                    text.slice(0, el.selectionStart) +
                    tidyPasted(pasted) +
                    text.slice(el.selectionEnd)
                  ).slice(0, 200_000),
                );
              }}
              placeholder="Paste a paragraph or a whole paper. Separate paragraphs with a blank line; headings and the reference list are left as they are."
              spellCheck={false}
              className="block min-h-[24rem] w-full resize-y bg-page px-5 py-4 font-serif text-[1.05rem] leading-[1.75] text-ink placeholder:font-sans placeholder:text-base placeholder:text-ink-faint focus:outline-none sm:px-6"
            />
          </section>
        ) : (
          <section
            aria-label="Your file"
            className="card animate-fade-up p-4 sm:p-6"
          >
            <FileDrop paper={paper} onPaper={setPaper} sample={sampleDocx} />
            <p className="mt-3 text-sm text-ink-soft">
              Your whole document is humanised in one go. A PDF or Word file
              comes back as the same kind of file, with its pages, layout,
              fonts and formatting kept; other formats come back as a Word
              file.
            </p>
          </section>
        )}

        <aside className="animate-fade-up space-y-4 lg:sticky lg:top-24">
          <section aria-label="Settings" className="card space-y-5 p-5">
            <Segmented
              label="Tone"
              value={tone}
              options={HUMANISE_TONES}
              onChange={setTone}
            />
            <Segmented
              label="Strength"
              value={strength}
              options={HUMANISE_STRENGTHS}
              onChange={setStrength}
            />
            <div>
              <button
                type="button"
                aria-expanded={voiceOpen}
                onClick={() => setVoiceOpen((v) => !v)}
                className="flex w-full items-center justify-between text-sm font-semibold"
              >
                Match my own voice{" "}
                <span className="text-xs font-medium text-ink-soft">
                  {voice.trim()
                    ? `${countWords(voice)} words added`
                    : "optional"}
                </span>
              </button>
              {voiceOpen && (
                <div className="mt-2 space-y-1.5">
                  <textarea
                    aria-label="A sample of your own writing"
                    value={voice}
                    onChange={(e) => setVoice(e.target.value.slice(0, 12_000))}
                    placeholder="Paste 150 to 1,500 words you wrote yourself, before any AI tool touched it. The rewrite copies its style, not its content."
                    className="block h-36 w-full resize-y rounded-lg border border-rule bg-page px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-ink-faint">
                    Used only for this check and never stored.
                  </p>
                </div>
              )}
            </div>
            <Button
              className="h-12 w-full text-base"
              disabled={!hasModel || (mode === "file" ? !paper : words < 30)}
              onClick={() =>
                mode === "file"
                  ? paper && void start(paper.text, paper.doc, paper.name)
                  : void start(tidyPasted(text), null)
              }
            >
              <SparkIcon size={18} /> Humanise <ArrowRightIcon />
            </Button>
          </section>
          <ul className="space-y-1.5 px-1 text-sm text-ink-soft">
            <li className="flex items-start gap-2">
              <ShieldIcon size={18} className="mt-0.5 shrink-0 text-ok" />
              Citations, numbers, equations and links are locked, and a second
              pass checks that each paragraph still means the same.
            </li>
            <li className="flex items-start gap-2">
              <ShieldIcon size={18} className="mt-0.5 shrink-0 text-ok" />
              Nothing is stored on our servers. Paragraphs go to the language model only to be
              revised.
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}

function Result({
  job,
  running,
  fatal,
  onStop,
  onNew,
  onUpdate,
  onRetry,
}: {
  job: Job;
  running: boolean;
  fatal: string | null;
  onStop: () => void;
  onNew: () => void;
  onUpdate: (i: number, patch: Partial<Item>) => void;
  onRetry: (i: number) => void;
}) {
  const [showChanges, setShowChanges] = useState(true);
  const [yours, setYours] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const todo = job.items.filter((it) => it.piece.rewrite);
  const finished = todo.filter(
    (it) => it.state === "done" || it.state === "failed",
  ).length;
  const revised = todo.filter((it) => it.result?.status === "rewritten").length;
  const finalText = useMemo(() => joinFinal(job), [job]);
  const copy = async (s: string, what: string) => {
    try {
      await navigator.clipboard.writeText(s);
      setNote(`${what} copied.`);
    } catch {
      setNote("Copying is blocked in this browser.");
    }
  };

  const downloadWord = async () => {
    const out = await buildFile(job);
    download(out.blob, out.name);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-wide text-action uppercase">
            Humaniser
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">
            {job.fileName ?? "Your text"}
          </h1>
          <p className="mt-1 text-ink-soft">
            {running
              ? `Revising paragraph ${Math.min(finished + 1, todo.length)} of ${todo.length}…`
              : `${revised} of ${todo.length} paragraphs revised · review each one, then copy or download`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {running ? (
            <Button variant="secondary" onClick={onStop}>
              <XIcon size={16} /> Stop
            </Button>
          ) : (
            <Button variant="secondary" onClick={onNew}>
              <RepeatIcon size={16} /> Start over
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={running}
            onClick={() => void copy(finalText, "The revised text")}
          >
            <CopyIcon size={16} /> Copy text
          </Button>
          <Button disabled={running} onClick={() => void downloadWord()}>
            <DownloadIcon /> Download Word file
          </Button>
        </div>
      </header>

      <div
        className="h-2 overflow-hidden rounded-full bg-desk-deep"
        aria-hidden
      >
        <div
          className="h-full rounded-full bg-action transition-[width] duration-500"
          style={{
            width: `${todo.length ? (finished / todo.length) * 100 : 100}%`,
          }}
        />
      </div>

      {fatal && (
        <Notice kind="error" title="The Humaniser stopped">
          {fatal}
        </Notice>
      )}
      {note && (
        <p role="status" className="text-sm text-ink-soft">
          {note}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={showChanges}
            onChange={(e) => setShowChanges(e.target.checked)}
            className="size-4 accent-[var(--action)]"
          />
          Show what changed
        </label>
        <p className="text-sm text-ink-soft">
          <span className="diff-add px-1">added</span>{" "}
          <span className="diff-del px-1">removed</span>
        </p>
      </div>

      <ol className="space-y-4" aria-label="Paragraphs">
        {job.items.map((it, i) => {
          if (it.state === "skip")
            return (
              <li
                key={i}
                className="rounded-lg border border-dashed border-rule px-4 py-2 text-sm text-ink-faint"
              >
                <span className="line-clamp-1">{it.piece.text}</span>
                <span className="sr-only">
                  {" "}
                  (heading or short line, left as it is)
                </span>
              </li>
            );
          const r = it.result;
          const revisedText = r?.status === "rewritten" ? r.text : null;
          return (
            <li key={i} className="card overflow-hidden">
              <div className="grid lg:grid-cols-2">
                <div className="border-b border-rule p-4 sm:p-5 lg:border-r lg:border-b-0">
                  <p className="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">
                    Original
                  </p>
                  <p
                    className={cx(
                      "font-serif leading-[1.7]",
                      it.use !== "original" && revisedText
                        ? "text-ink-soft"
                        : "text-ink",
                    )}
                  >
                    {it.piece.text}
                  </p>
                </div>
                <div className="p-4 sm:p-5">
                  <p className="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">
                    {it.use === "edited" ? "Your edit" : "Revised"}
                  </p>
                  {it.state === "waiting" || it.state === "working" ? (
                    <div
                      className="space-y-2"
                      aria-label={
                        it.state === "working" ? "Revising" : "Waiting"
                      }
                    >
                      {[92, 100, 85, 60].map((w, k) => (
                        <div
                          key={k}
                          className={cx(
                            "h-3.5 rounded bg-desk-deep",
                            it.state === "working" && "animate-pulse",
                          )}
                          style={{ width: `${w}%` }}
                        />
                      ))}
                    </div>
                  ) : editing === i ? (
                    <div className="space-y-2">
                      <textarea
                        aria-label="Edit this paragraph"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        className="block h-40 w-full resize-y rounded-lg border border-rule bg-page p-3 font-serif leading-[1.7]"
                      />
                      <div className="flex gap-2">
                        <Button
                          onClick={() => {
                            onUpdate(i, { use: "edited", edited: draft });
                            setEditing(null);
                          }}
                        >
                          Save edit
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : it.use === "edited" && it.edited !== undefined ? (
                    <p className="font-serif leading-[1.7]">{it.edited}</p>
                  ) : revisedText ? (
                    <div
                      className={cx(
                        "font-serif leading-[1.7]",
                        it.use === "original" &&
                          "rounded-md border border-dashed border-rule p-2",
                      )}
                    >
                      {it.use === "original" && (
                        <p className="mb-1 font-sans text-xs font-semibold text-ink-soft">
                          Not used: the original is kept
                        </p>
                      )}
                      {showChanges ? (
                        <DiffView before={it.piece.text} after={revisedText} />
                      ) : (
                        <p>{revisedText}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-ink-soft">
                      {it.error ??
                        "Every attempt changed the meaning or a number, so the original is kept. Try again, or edit it yourself."}
                    </p>
                  )}
                </div>
              </div>
              {(it.state === "done" || it.state === "failed") &&
                editing !== i && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule bg-desk/40 px-4 py-2.5 sm:px-5">
                    <p className="text-xs text-ink-soft">
                      {r?.status === "rewritten" ? (
                        <span className="inline-flex items-center gap-1">
                          <CheckIcon size={14} className="text-ok" />
                          {r.meaningChecked
                            ? "Meaning checked"
                            : "Numbers and citations checked"}{" "}
                          · {Math.round(r.changed * 100)}% of words changed
                        </span>
                      ) : (
                        "Original kept"
                      )}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {revisedText && (
                        <div
                          role="radiogroup"
                          aria-label="Which version to keep"
                          className="inline-flex rounded-lg border border-rule p-0.5 text-sm"
                        >
                          {(
                            [
                              ["revised", "Use revised"],
                              ["original", "Keep original"],
                            ] as const
                          ).map(([v, label]) => (
                            <button
                              key={v}
                              type="button"
                              role="radio"
                              aria-checked={it.use === v}
                              onClick={() => onUpdate(i, { use: v })}
                              className={cx(
                                "rounded-md px-2.5 py-1 font-semibold",
                                it.use === v
                                  ? "bg-ink text-page"
                                  : "text-ink-soft hover:text-ink",
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => void copy(finalOf(it), "The paragraph")}
                        className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-semibold text-ink-soft hover:bg-desk-deep hover:text-ink"
                      >
                        <CopyIcon size={14} /> Copy
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(finalOf(it));
                          setEditing(i);
                        }}
                        className="rounded-md px-2.5 py-1 text-sm font-semibold text-ink-soft hover:bg-desk-deep hover:text-ink"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setYours(i)}
                        className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-semibold text-action hover:bg-action-soft"
                      >
                        <PenIcon size={14} /> Make it yours
                      </button>
                      <button
                        type="button"
                        disabled={running}
                        onClick={() => onRetry(i)}
                        className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-semibold text-action hover:bg-action-soft disabled:opacity-40"
                      >
                        <RepeatIcon size={14} /> Try another version
                      </button>
                    </div>
                  </div>
                )}
              {yours === i && (
                <MakeYours
                  paragraph={finalOf(it)}
                  tone={job.tone}
                  onClose={() => setYours(null)}
                  onDone={(text) => {
                    onUpdate(i, { use: "edited", edited: text });
                    setYours(null);
                  }}
                />
              )}
            </li>
          );
        })}
      </ol>

      <section
        aria-labelledby="disclose-h"
        className="card space-y-3 p-5 sm:p-6"
      >
        <h2 id="disclose-h" className="font-display text-xl font-semibold">
          Disclose the help you used
        </h2>
        <p className="text-ink-soft">
          Most journals and universities ask authors to say when an AI tool
          helped with their writing. Revising text does not change who wrote it.
          A statement like this one, in your acknowledgements or methods, covers
          it:
        </p>
        <blockquote className="rounded-lg border-l-4 border-action bg-action-soft px-4 py-3 font-serif">
          {HUMANISE_DISCLOSURE}
        </blockquote>
        <Button
          variant="secondary"
          onClick={() => void copy(HUMANISE_DISCLOSURE, "The statement")}
        >
          <CopyIcon size={16} /> Copy statement
        </Button>
      </section>
    </div>
  );
}
