"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { latexToText } from "@/core/text/latex";
import { ApiError, postForm } from "@/lib/api";
import { MAX_LOCAL_BYTES, readDocument } from "@/lib/doc";
import type { DocModel } from "@/lib/doc/model";
import { CheckIcon, UploadIcon, XIcon } from "./icons";
import { FileTypeIcon, fileKind } from "./FileTypeIcon";
import { Button, Notice, cx } from "./ui";

export interface LoadedPaper {
  name: string;
  size: number;
  kind: string;
  text: string;
  words: number;
  doc: DocModel | null;
  /** Pages (PDF) and pictures found, for the file card. */
  pages?: number;
  images: number;
  /** First page picture, for PDFs. */
  thumb?: string | null;
  notes: string[];
}

export const ACCEPT = ".docx,.pdf,.odt,.rtf,.tex,.md,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";
const FORMATS = ["DOCX", "PDF", "ODT", "RTF", "LaTeX", "Markdown", "TXT"];
const countWords = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;

const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Reads any supported paper in the browser; Word and PDF keep their layout. Falls back to the server for text only. */
export async function loadPaper(file: File, onNote?: (s: string) => void): Promise<LoadedPaper> {
  const kind = fileKind(file.name);
  const base = { name: file.name, size: file.size, kind, notes: [] as string[] };
  if (file.size > MAX_LOCAL_BYTES) throw new Error(`${file.name} is larger than ${Math.round(MAX_LOCAL_BYTES / 1024 / 1024)} MB.`);
  if (/\.doc$/i.test(file.name)) throw new Error("Old .doc files cannot be read. Open the file in Word and save it as .docx, then upload it again.");
  if (kind === "docx" || kind === "pdf") {
    try {
      const doc = await readDocument(file, onNote);
      if (doc && doc.text.replace(/\s/g, "").length >= 50) {
        let thumb: string | null = null;
        if (doc.kind === "pdf") thumb = await (await import("@/lib/doc/thumb")).pdfThumbnail(doc.data);
        return {
          ...base,
          text: doc.text,
          words: countWords(doc.text),
          doc,
          ...(doc.kind === "pdf" ? { pages: doc.pages.length } : {}),
          images: doc.images.length,
          thumb,
          notes: doc.warnings,
        };
      }
    } catch {
      // Fall back to the server below.
    }
    const form = new FormData();
    form.append("file", file);
    const r = await postForm<{ text: string; warnings: string[] }>("/api/extract", form);
    return { ...base, text: r.text, words: countWords(r.text), doc: null, images: 0, notes: r.warnings };
  }
  if (kind === "odt") {
    const { readOdt } = await import("@/lib/doc/odt");
    const doc = await readOdt(file.name, new Uint8Array(await file.arrayBuffer()));
    if (countWords(doc.text) < 10) throw new Error(`${file.name} has almost no text.`);
    return { ...base, text: doc.text, words: countWords(doc.text), doc, images: doc.images.length, notes: doc.warnings };
  }
  if (kind === "rtf") {
    const { rtfToText } = await import("@/core/text/rtf");
    const text = rtfToText(await file.text());
    if (countWords(text) < 10) throw new Error(`${file.name} has almost no text.`);
    return { ...base, text, words: countWords(text), doc: null, images: 0, notes: [] };
  }
  if (kind === "txt" || kind === "md" || kind === "tex") {
    const raw = (await file.text()).replace(/\r\n?/g, "\n");
    const text = kind === "tex" ? latexToText(raw) : raw;
    if (countWords(text) < 10) throw new Error(`${file.name} has almost no text.`);
    return { ...base, text, words: countWords(text), doc: null, images: 0, notes: kind === "tex" ? ["LaTeX was converted to text; macros defined in the preamble are not expanded."] : [] };
  }
  throw new Error(`“${file.name}” is not a supported file. Use ${FORMATS.join(", ")}.`);
}

/**
 * The paper upload for the plagiarism check: files only, no pasted text. Once a file is read it shows as a card
 * with its type, name, size and what was found in it, never its raw text.
 */
export function FileDrop({
  paper,
  onPaper,
  initialFile,
  sample,
  fill,
}: {
  paper: LoadedPaper | null;
  onPaper: (p: LoadedPaper | null) => void;
  initialFile?: () => Promise<File>;
  /** Offers a sample paper to try the tool with. */
  sample?: () => Promise<File>;
  /** Stretch the empty drop zone to the height of its container. */
  fill?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const take = async (file: File) => {
    setError(null);
    setBusy(`Reading ${file.name}…`);
    try {
      onPaper(await loadPaper(file, (n) => setBusy(n)));
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "The file could not be read.");
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!initialFile || paper) return;
    void initialFile().then(take);
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drop = {
    onDragEnter: (e: DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) {
        e.preventDefault();
        setDragging(true);
      }
    },
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) e.preventDefault();
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      const f = e.dataTransfer.files?.[0];
      setDragging(false);
      if (!f) return;
      e.preventDefault();
      void take(f);
    },
  };

  const picker = (
    <input
      ref={input}
      id={`${id}-file`}
      type="file"
      accept={ACCEPT}
      className="sr-only"
      tabIndex={-1}
      aria-label="Upload your paper"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void take(f);
      }}
    />
  );

  if (busy)
    return (
      <div role="status" className="drop-glow flex min-h-[22rem] flex-col items-center justify-center gap-5 rounded-2xl p-8 text-center">
        <div className="relative">
          <span className="absolute inset-0 animate-ping rounded-full bg-action/20" />
          <span className="relative inline-flex size-16 items-center justify-center rounded-full bg-action-soft text-action">
            <span className="inline-block size-7 animate-spin rounded-full border-[3px] border-current border-r-transparent" />
          </span>
        </div>
        <p className="font-semibold">{busy}</p>
        <p className="text-sm text-ink-faint">Your file is read here in your browser.</p>
      </div>
    );

  if (paper)
    return (
      <div className="animate-fade-up space-y-3">
        <div className="relative overflow-hidden rounded-2xl border border-rule bg-gradient-to-br from-action-soft/70 via-page to-page p-5 sm:p-6">
          <div aria-hidden className="pointer-events-none absolute -top-20 -right-20 size-56 rounded-full bg-action/10 blur-3xl" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
            {paper.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={paper.thumb} alt="" className="animate-pop h-40 w-auto self-start rounded-md border border-rule bg-white shadow-[var(--shadow-lift)]" />
            ) : (
              <FileTypeIcon kind={paper.kind} size={84} className="animate-pop shrink-0 drop-shadow-[0_12px_18px_rgb(15_23_42/0.18)]" />
            )}
            <div className="min-w-0 flex-1 space-y-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-ok">
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-ok text-page">
                  <CheckIcon size={13} strokeWidth={3} />
                </span>
                Ready to check
              </p>
              <p className="truncate font-display text-xl font-semibold" title={paper.name}>
                {paper.name}
              </p>
              <ul className="flex flex-wrap gap-2 text-sm">
                {[
                  paper.kind.toUpperCase(),
                  size(paper.size),
                  `${paper.words.toLocaleString("en")} words`,
                  paper.pages ? `${paper.pages} page${paper.pages === 1 ? "" : "s"}` : "",
                  paper.images ? `${paper.images} picture${paper.images === 1 ? "" : "s"}` : "",
                  paper.doc ? "Original layout kept" : "",
                ]
                  .filter(Boolean)
                  .map((t, i) => (
                    <li key={t} className="animate-fade-in rounded-full border border-rule bg-page/80 px-2.5 py-0.5 font-medium text-ink-soft" style={{ ["--i" as string]: i }}>
                      {t}
                    </li>
                  ))}
              </ul>
            </div>
            <div className="flex gap-2 sm:flex-col">
              <Button variant="secondary" onClick={() => input.current?.click()}>
                <UploadIcon size={16} /> Replace
              </Button>
              <Button variant="quiet" onClick={() => onPaper(null)}>
                <XIcon size={16} /> Remove
              </Button>
            </div>
          </div>
          {picker}
        </div>
        {paper.notes.length > 0 && (
          <Notice kind="info">
            <ul className="list-disc pl-5">
              {paper.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Notice>
        )}
      </div>
    );

  return (
    <div className={cx("space-y-3", fill && "flex flex-1 flex-col")}>
      <div
        {...drop}
        className={cx(
          fill && "flex-1",
          "drop-glow group relative flex min-h-[22rem] flex-col items-center justify-center gap-5 overflow-hidden rounded-2xl p-8 text-center transition-transform duration-300",
          dragging && "scale-[1.01]",
        )}
      >
        <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
        <div aria-hidden className="relative flex h-24 items-end">
          {["pdf", "docx", "tex"].map((k, i) => (
            <span
              key={k}
              className={cx("animate-fade-up transition-transform duration-300", i === 0 && "-mr-4 rotate-[-10deg] group-hover:-translate-x-2 group-hover:rotate-[-14deg]", i === 1 && "z-10 -translate-y-2 group-hover:-translate-y-4", i === 2 && "-ml-4 rotate-[10deg] group-hover:translate-x-2 group-hover:rotate-[14deg]")}
              style={{ ["--i" as string]: i }}
            >
              <FileTypeIcon kind={k} size={i === 1 ? 64 : 52} className="drop-shadow-[0_10px_14px_rgb(15_23_42/0.18)]" />
            </span>
          ))}
        </div>
        <div className="relative space-y-1">
          <p className="font-display text-xl font-semibold">{dragging ? "Drop it here" : "Drop your paper here"}</p>
          <p className="text-sm text-ink-soft">Any layout: IEEE, Springer, Elsevier, ACM, APA, your university&rsquo;s template.</p>
        </div>
        <Button className="relative h-11 px-6" onClick={() => input.current?.click()}>
          <UploadIcon size={18} /> Choose a file
        </Button>
        <ul className="relative flex flex-wrap justify-center gap-1.5 text-xs font-semibold text-ink-faint">
          {FORMATS.map((f) => (
            <li key={f} className="rounded-full border border-rule bg-page px-2 py-0.5">
              {f}
            </li>
          ))}
        </ul>
        {picker}
      </div>
      {sample && (
        <p className="text-center text-sm text-ink-soft">
          No paper at hand?{" "}
          <button type="button" className="font-semibold text-action hover:underline" onClick={() => void sample().then(take)}>
            Try a sample paper
          </button>
        </p>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}
