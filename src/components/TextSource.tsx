"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { ApiError, postForm } from "@/lib/api";
import { MAX_LOCAL_BYTES, readDocument, type DocModel } from "@/lib/doc";
import { SAMPLE_PAPER } from "@/lib/sample";
import { useSettings } from "@/lib/settings";
import { FileIcon, UploadIcon } from "./icons";
import { Button, Notice, cx } from "./ui";

interface Extracted {
  name: string;
  text: string;
  words: number;
  warnings: string[];
}

const ACCEPT = ".docx,.pdf,.tex,.md,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";
const countWords = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;

/** Paste box with file upload. Files are converted to text on the server and not stored. */
export function TextSource({
  value,
  onChange,
  label = "Your text",
  hint = "Paste text, or upload a .docx, .pdf, .tex, .md or .txt file. Nothing is stored.",
  rows = 14,
  maxChars = 400_000,
  sample = SAMPLE_PAPER,
  onDocument,
}: {
  value: string;
  onChange: (text: string) => void;
  /** Receives the uploaded document with its layout (Word and PDF files), or null when the text came from elsewhere. */
  onDocument?: (doc: DocModel | null) => void;
  label?: string;
  hint?: string;
  rows?: number;
  maxChars?: number;
  sample?: string | null;
}) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progressNote, setProgressNote] = useState<string | null>(null);
  const { status } = useSettings();

  async function upload(file: File) {
    setError(null);
    setNotes([]);
    // Word and PDF files are read here in the browser, which keeps their layout for the report; only the text
    // is sent for checking. Anything else, or a file this cannot read, goes to the server.
    if (file.size <= MAX_LOCAL_BYTES) {
      setBusy(true);
      try {
        const doc = await readDocument(file, setProgressNote);
        if (doc && doc.text.replace(/\s/g, "").length >= 50) {
          onChange(doc.text.slice(0, maxChars));
          onDocument?.(doc.text.length <= maxChars ? doc : null);
          setFileName(file.name);
          setNotes(doc.warnings);
          return;
        }
      } catch {
        // Fall back to the server below.
      } finally {
        setBusy(false);
        setProgressNote(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    }
    onDocument?.(null);
    const limit = status?.maxUploadBytes;
    if (limit && file.size > limit) {
      setError(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB; files up to ${Math.floor((limit / 1024 / 1024) * 10) / 10} MB are supported here. Try saving it without images, or paste the text instead.`);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const doc = await postForm<Extracted>("/api/extract", form);
      onChange(doc.text.slice(0, maxChars));
      setFileName(doc.name);
      setNotes(doc.warnings);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The file could not be read.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const words = countWords(value);
  const dropProps = {
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
      if (!f) return;
      e.preventDefault();
      setDragging(false);
      void upload(f);
    },
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label htmlFor={id} className="font-semibold">
          {label}
        </label>
        <div className="flex flex-wrap gap-2">
          {sample && !value && (
            <Button variant="quiet" onClick={() => onChange(sample)}>
              Try a sample
            </Button>
          )}
          {value && (
            <Button
              variant="quiet"
              onClick={() => {
                onChange("");
                onDocument?.(null);
                setFileName(null);
                setNotes([]);
              }}
            >
              Clear
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-label="Upload a file"
            id={`${id}-file`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          {value && (
            <Button variant="secondary" busy={busy} onClick={() => fileRef.current?.click()} aria-controls={id}>
              {busy ? "Reading file" : "Upload a different file"}
            </Button>
          )}
        </div>
      </div>
      <p id={`${id}-hint`} className="text-sm text-ink-faint">
        {hint}
      </p>
      <div className="relative" {...dropProps}>
        <textarea
          id={id}
          value={value}
          rows={rows}
          maxLength={maxChars}
          aria-describedby={`${id}-hint ${id}-count`}
          onChange={(e) => onChange(e.target.value)}
          spellCheck
          className={cx(
            "sheet-text block w-full max-w-none resize-y rounded-lg border bg-page px-4 py-3 text-ink shadow-[inset_0_1px_2px_rgb(0_0_0/0.04)] transition-colors placeholder:text-ink-faint",
            dragging ? "border-action ring-2 ring-action/30" : "border-rule hover:border-ink-faint/60",
          )}
        />
        {!value && !busy && !dragging && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="inline-flex size-12 items-center justify-center rounded-full bg-action-soft text-action">
              <UploadIcon size={22} />
            </span>
            <p className="font-semibold">Drop your paper here, or paste the text</p>
            <p className="text-sm text-ink-faint">Word (.docx), PDF, LaTeX (.tex), Markdown or plain text</p>
            <Button variant="secondary" className="pointer-events-auto mt-1" onClick={() => fileRef.current?.click()}>
              <FileIcon /> Choose a file
            </Button>
          </div>
        )}
        {(dragging || busy) && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-action bg-action-soft/90 text-action"
          >
            {busy ? (
              <span className="inline-block size-6 animate-spin rounded-full border-2 border-current border-r-transparent" />
            ) : (
              <UploadIcon size={26} />
            )}
            <p className="font-semibold">{busy ? (progressNote ?? "Reading your file…") : "Drop to upload"}</p>
          </div>
        )}
      </div>
      <p id={`${id}-count`} className="text-sm text-ink-faint" aria-live="polite">
        {words.toLocaleString("en")} word{words === 1 ? "" : "s"}
        {fileName ? ` from ${fileName}` : ""}
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      {notes.length > 0 && (
        <Notice kind="info">
          <ul className="list-disc pl-5">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Notice>
      )}
    </div>
  );
}
