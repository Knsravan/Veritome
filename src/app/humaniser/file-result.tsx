"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DiffView } from "@/components/DiffView";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FileIcon,
  PenIcon,
  RepeatIcon,
  XIcon,
} from "@/components/icons";
import { Button, Notice, cx } from "@/components/ui";
import { HUMANISE_DISCLOSURE } from "@/core/rewrite/humanise";
import { MakeYours } from "./make-yours";
import {
  buildFile,
  download,
  finalOf,
  outputKind,
  type BuiltFile,
  type Item,
  type Job,
} from "./shared";

const KIND_LABEL = {
  pdf: "PDF",
  docx: "Word file",
  "new-docx": "Word file",
} as const;

/**
 * File mode: the whole document is humanised in one go and shown as one page, filling in as paragraphs finish.
 * The result is downloaded as the same kind of file that was uploaded, with its layout, fonts and formatting kept.
 * Any paragraph can still be opened to keep the original, edit it, make it yours or try again.
 */
export function FileResult({
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
  const [tab, setTab] = useState<"document" | "preview">("document");
  const [showChanges, setShowChanges] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [yours, setYours] = useState<number | null>(null);
  const [busy, setBusy] = useState<"file" | "tracked" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notInFile, setNotInFile] = useState<BuiltFile["skippedRanges"]>([]);

  const kind = outputKind(job);
  const todo = job.items.filter((it) => it.piece.rewrite);
  const finished = todo.filter(
    (it) => it.state === "done" || it.state === "failed",
  ).length;
  const revised = todo.filter((it) => it.result?.status === "rewritten").length;
  const pct = todo.length ? Math.round((finished / todo.length) * 100) : 100;

  const report = (out: BuiltFile) => {
    setNotInFile(out.skippedRanges);
    const where = kind === "pdf" ? "your PDF" : "your Word file";
    setNote(
      kind === "new-docx"
        ? "Your humanised text is in a new Word file."
        : out.skipped
          ? `${out.applied} humanised paragraphs are in ${where}, in its own layout and fonts. ${out.skipped} could not be changed safely there (they hold equations, pictures or tightly packed layout), so they are left as they were and marked below.`
          : `All ${out.applied} humanised paragraphs are in ${where}, in its own layout and fonts.`,
    );
  };

  const get = async (tracked: boolean) => {
    setBusy(tracked ? "tracked" : "file");
    setError(null);
    try {
      const out = await buildFile(job, tracked);
      download(out.blob, out.name);
      report(out);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The file could not be made.",
      );
    } finally {
      setBusy(null);
    }
  };

  const copyAll = async () => {
    const { finalText } = await import("./shared");
    try {
      await navigator.clipboard.writeText(finalText(job));
      setNote("The humanised text is copied.");
    } catch {
      setNote("Copying is blocked in this browser.");
    }
  };

  const isNotInFile = (it: Item) =>
    finalOf(it) !== it.piece.text &&
    notInFile.some((r) => it.piece.start >= r.start && it.piece.start < r.end);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-wide text-action uppercase">
            Humaniser · File mode
          </p>
          <h1 className="mt-1 flex items-center gap-2 font-display text-3xl font-bold tracking-tight">
            <FileIcon size={26} className="shrink-0 text-ink-soft" />
            <span className="truncate">{job.fileName ?? "Your document"}</span>
          </h1>
          <p className="mt-1 text-ink-soft" aria-live="polite">
            {running
              ? `Humanising your document… ${finished} of ${todo.length} paragraphs done`
              : `${revised} of ${todo.length} paragraphs humanised. Download it as the same ${KIND_LABEL[kind]}, in its own layout.`}
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
          {kind === "docx" && (
            <Button
              variant="secondary"
              disabled={running || busy !== null}
              busy={busy === "tracked"}
              onClick={() => void get(true)}
            >
              <DownloadIcon /> With tracked changes
            </Button>
          )}
          <Button
            disabled={running || busy !== null}
            busy={busy === "file"}
            onClick={() => void get(false)}
          >
            <DownloadIcon /> Download humanised {KIND_LABEL[kind]}
          </Button>
        </div>
      </header>

      <div className="flex items-center gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-desk-deep"
          role="progressbar"
          aria-label="Humanising"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-action transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-12 text-right text-sm font-semibold tabular-nums">
          {pct}%
        </span>
      </div>

      {fatal && (
        <Notice kind="error" title="The Humaniser stopped">
          {fatal}
        </Notice>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {note && (
        <p role="status" className="text-sm text-ink-soft">
          {note}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="View"
          className="inline-flex rounded-full border border-rule bg-page p-1 shadow-sm"
        >
          {(
            [
              ["document", "Humanised text"],
              ["preview", `Preview the ${KIND_LABEL[kind]}`],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              disabled={t === "preview" && running}
              onClick={() => setTab(t)}
              className={cx(
                "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-40",
                tab === t
                  ? "bg-ink text-page"
                  : "text-ink-soft hover:bg-desk-deep hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "document" && (
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={showChanges}
                onChange={(e) => setShowChanges(e.target.checked)}
                className="size-4 accent-[var(--action)]"
              />
              Highlight what changed
            </label>
            <button
              type="button"
              disabled={running}
              onClick={() => void copyAll()}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink disabled:opacity-40"
            >
              <CopyIcon size={15} /> Copy all text
            </button>
          </div>
        )}
      </div>

      {tab === "preview" ? (
        <FilePreview job={job} onBuilt={report} />
      ) : (
        <article
          aria-label="Your humanised document"
          className="card mx-auto max-w-[52rem] px-5 py-8 sm:px-12 sm:py-12"
        >
          <p className="mb-6 font-sans text-xs text-ink-faint">
            Click any paragraph to see the original, keep it, edit it or try
            another version.
          </p>
          <div className="space-y-4 font-serif text-[1.05rem] leading-[1.8]">
            {job.items.map((it, i) => {
              if (it.state === "skip") {
                const heading =
                  it.piece.text.length < 120 && !/[.!?]$/.test(it.piece.text);
                return (
                  <p
                    key={i}
                    className={cx(
                      "whitespace-pre-line",
                      heading
                        ? "font-sans font-semibold text-ink"
                        : "text-ink-soft",
                    )}
                  >
                    {it.piece.text}
                  </p>
                );
              }
              const r = it.result;
              const revisedText = r?.status === "rewritten" ? r.text : null;
              const shown = finalOf(it);
              const pending = it.state === "waiting" || it.state === "working";
              const expanded = open === i;
              return (
                <div
                  key={i}
                  className={cx(
                    "-mx-3 rounded-lg border-l-[3px] px-3 py-1 transition-colors",
                    pending
                      ? "border-rule"
                      : shown !== it.piece.text
                        ? "border-action/60"
                        : "border-transparent",
                    expanded && "bg-desk/60",
                  )}
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    disabled={pending}
                    onClick={() => setOpen(expanded ? null : i)}
                    className="block w-full cursor-pointer text-left disabled:cursor-default"
                  >
                    {pending ? (
                      <span
                        className={cx(
                          "block text-ink-faint",
                          it.state === "working" && "animate-pulse",
                        )}
                      >
                        <span className="sr-only">
                          {it.state === "working" ? "Humanising: " : "Waiting: "}
                        </span>
                        {it.piece.text}
                      </span>
                    ) : showChanges && shown !== it.piece.text ? (
                      <DiffView before={it.piece.text} after={shown} />
                    ) : (
                      <span className="block">{shown}</span>
                    )}
                  </button>
                  {isNotInFile(it) && (
                    <p className="mt-1 font-sans text-xs font-semibold text-warn">
                      Left as it was in the downloaded file: its layout could
                      not be changed safely.
                    </p>
                  )}
                  {expanded && !pending && editing !== i && (
                    <div className="mt-3 space-y-3 border-t border-rule pt-3 font-sans">
                      {shown !== it.piece.text && (
                        <div>
                          <p className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
                            Original
                          </p>
                          <p className="mt-1 font-serif text-[0.98rem] leading-[1.7] text-ink-soft">
                            {it.piece.text}
                          </p>
                        </div>
                      )}
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
                          (it.error ??
                          "Every attempt changed the meaning or a number, so the original is kept.")
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
                                ["revised", "Use humanised"],
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
                          onClick={() => {
                            setDraft(shown);
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
                  {editing === i && (
                    <div className="mt-3 space-y-2 font-sans">
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
                  )}
                  {yours === i && (
                    <div className="mt-3 overflow-hidden rounded-lg font-sans">
                      <MakeYours
                        paragraph={shown}
                        tone={job.tone}
                        onClose={() => setYours(null)}
                        onDone={(text) => {
                          onUpdate(i, { use: "edited", edited: text });
                          setYours(null);
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </article>
      )}

      <section
        aria-labelledby="disclose-file-h"
        className="card space-y-3 p-5 sm:p-6"
      >
        <h2 id="disclose-file-h" className="font-display text-xl font-semibold">
          Disclose the help you used
        </h2>
        <p className="text-ink-soft">
          Most journals and universities ask authors to say when an AI tool
          helped with their writing. A statement like this one, in your
          acknowledgements or methods, covers it:
        </p>
        <blockquote className="rounded-lg border-l-4 border-action bg-action-soft px-4 py-3 font-serif">
          {HUMANISE_DISCLOSURE}
        </blockquote>
      </section>
    </div>
  );
}

/** The humanised file itself, drawn page by page, exactly as it will download. */
function FilePreview({
  job,
  onBuilt,
}: {
  job: Job;
  onBuilt: (out: BuiltFile) => void;
}) {
  const [state, setState] = useState<"building" | "ready" | "error">(
    "building",
  );
  const [message, setMessage] = useState("");
  const pages = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const built = useRef(onBuilt);
  built.current = onBuilt;
  // Rebuild only when the chosen text changes.
  const key = useMemo(() => job.items.map(finalOf).join("\u0001"), [job]);

  useEffect(() => {
    let off = false;
    setState("building");
    const t = setTimeout(async () => {
      try {
        const out = await buildFile(job);
        if (off) return;
        built.current(out);
        const bytes = new Uint8Array(await out.blob.arrayBuffer());
        const root = pages.current;
        if (!root || off) return;
        root.innerHTML = "";
        if (outputKind(job) === "pdf") {
          const { getDocumentProxy } = await import("unpdf");
          const pdf = await getDocumentProxy(bytes);
          const width = (box.current?.clientWidth ?? 800) - 8;
          setState("ready");
          for (let n = 1; n <= pdf.numPages && !off; n++) {
            const page = await pdf.getPage(n);
            const base = page.getViewport({ scale: 1 });
            const scale =
              (Math.min(width, 900) / base.width) *
              Math.min(2, window.devicePixelRatio || 1);
            const vp = page.getViewport({ scale });
            const c = document.createElement("canvas");
            c.width = Math.floor(vp.width);
            c.height = Math.floor(vp.height);
            c.style.width = `${Math.min(width, 900)}px`;
            c.className = "mx-auto mb-4 block rounded-sm bg-white shadow-md";
            c.setAttribute("aria-label", `Page ${n}`);
            root.appendChild(c);
            await page.render({
              canvasContext: c.getContext("2d")!,
              viewport: vp,
              canvas: c,
            } as Parameters<typeof page.render>[0]).promise;
          }
        } else {
          const { renderDocx } = await import("@/lib/doc/docx-exact");
          await renderDocx(root, bytes);
          const page = root.querySelector<HTMLElement>("section.docx");
          if (page && box.current)
            setZoom(
              Math.min(1, (box.current.clientWidth - 8) / page.offsetWidth),
            );
          if (!off) setState("ready");
        }
      } catch (err) {
        if (off) return;
        setMessage(
          err instanceof Error ? err.message : "The preview could not be made.",
        );
        setState("error");
      }
    }, 300);
    return () => {
      off = true;
      clearTimeout(t);
    };
    // `key` stands for the job's chosen text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div
      ref={box}
      className="docx-exact relative min-h-60 overflow-hidden rounded-2xl bg-desk-deep/60 p-2 sm:p-4"
    >
      {state === "building" && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-soft">
          <span className="inline-block size-5 animate-spin rounded-full border-2 border-current border-r-transparent" />{" "}
          Making your file…
        </div>
      )}
      {state === "error" && <Notice kind="error">{message}</Notice>}
      <div
        ref={pages}
        aria-label="Preview of the humanised file"
        style={{ zoom }}
        className={cx(state !== "ready" && "invisible absolute inset-x-0 top-0")}
      />
    </div>
  );
}
