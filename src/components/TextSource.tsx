"use client";

import { useId, useRef, useState } from "react";
import { ApiError, postForm } from "@/lib/api";
import { SAMPLE_PAPER } from "@/lib/sample";
import { useSettings } from "@/lib/settings";
import { Button, Notice } from "./ui";

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
}: {
  value: string;
  onChange: (text: string) => void;
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
  const { status } = useSettings();

  async function upload(file: File) {
    setError(null);
    setNotes([]);
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
          <Button variant="secondary" busy={busy} onClick={() => fileRef.current?.click()} aria-controls={id}>
            {busy ? "Reading file" : "Upload a file"}
          </Button>
        </div>
      </div>
      <p id={`${id}-hint`} className="text-sm text-ink-faint">
        {hint}
      </p>
      <textarea
        id={id}
        value={value}
        rows={rows}
        maxLength={maxChars}
        aria-describedby={`${id}-hint ${id}-count`}
        onChange={(e) => onChange(e.target.value)}
        spellCheck
        className="sheet-text block w-full max-w-none resize-y rounded-sm border border-rule bg-page px-4 py-3 text-ink placeholder:text-ink-faint"
        placeholder="Paste your abstract, a section or the whole manuscript here."
      />
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
