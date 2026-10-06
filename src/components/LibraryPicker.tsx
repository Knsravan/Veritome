"use client";

import { useRef, useState } from "react";
import { ApiError, postForm } from "@/lib/api";
import { Button, Notice } from "./ui";

export interface LibraryItem {
  title: string;
  text: string;
}

/** Lets the user attach their own documents to compare against, for this check only. */
export function LibraryPicker({ items, onChange, serverCount }: { items: LibraryItem[]; onChange: (items: LibraryItem[]) => void; serverCount: number }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(files: FileList) {
    setBusy(true);
    setError(null);
    const added: LibraryItem[] = [];
    for (const f of Array.from(files).slice(0, 20 - items.length)) {
      try {
        const form = new FormData();
        form.append("file", f);
        const doc = await postForm<{ text: string }>("/api/extract", form);
        added.push({ title: f.name, text: doc.text });
      } catch (err) {
        setError(`${f.name}: ${err instanceof ApiError ? err.message : "could not be read."}`);
      }
    }
    onChange([...items, ...added]);
    setBusy(false);
    if (ref.current) ref.current.value = "";
  }

  return (
    <fieldset className="space-y-2">
      <legend className="font-semibold">Your own documents (optional)</legend>
      <p className="text-sm text-ink-faint">
        Compare against earlier papers, theses or drafts the search services cannot see. They are used for this check only.
        {serverCount > 0 ? ` This server also has ${serverCount} document${serverCount === 1 ? "" : "s"} in its shared library.` : ""}
      </p>
      {items.length > 0 && (
        <ul className="space-y-1 text-sm">
          {items.map((d, i) => (
            <li key={`${d.title}-${i}`} className="flex items-center justify-between gap-2 rounded border border-rule bg-page px-3 py-1.5">
              <span className="truncate">{d.title}</span>
              <button type="button" className="text-ink-faint underline-offset-4 hover:underline" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${d.title}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <input ref={ref} type="file" multiple accept=".docx,.pdf,.tex,.md,.txt" className="sr-only" tabIndex={-1} aria-label="Add documents" onChange={(e) => e.target.files && void add(e.target.files)} />
      <Button variant="secondary" busy={busy} onClick={() => ref.current?.click()} disabled={items.length >= 20}>
        Add documents
      </Button>
      {error && <Notice kind="error">{error}</Notice>}
    </fieldset>
  );
}
