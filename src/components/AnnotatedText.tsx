"use client";

import { Fragment, type KeyboardEvent } from "react";
import { cx } from "./ui";

export interface TextMark {
  id: string;
  start: number;
  end: number;
  className: string;
  /** Short accessible description, e.g. "Grammar: repeated word". */
  label: string;
  /** Colour group, e.g. the number of the matched source (1 to 6). */
  group?: number;
  /** The finding's number in the report, shown as a badge where it starts. */
  n?: number;
}

/** Drops marks that overlap an earlier one so the text renders as flat segments. */
export function flattenMarks(
  marks: readonly TextMark[],
  length: number,
): TextMark[] {
  const sorted = [...marks]
    .filter((m) => m.end > m.start && m.start >= 0 && m.end <= length)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const out: TextMark[] = [];
  let lastEnd = -1;
  for (const m of sorted) {
    if (m.start < lastEnd) continue;
    out.push(m);
    lastEnd = m.end;
  }
  return out;
}

/** Shows the manuscript with proof marks. Marks are keyboard-focusable and select their margin note. */
export function AnnotatedText({
  text,
  marks,
  activeId,
  onSelect,
}: {
  text: string;
  marks: readonly TextMark[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const flat = flattenMarks(marks, text.length);
  const parts: Array<{ text: string; mark?: TextMark }> = [];
  let cursor = 0;
  for (const m of flat) {
    if (m.start > cursor) parts.push({ text: text.slice(cursor, m.start) });
    parts.push({ text: text.slice(m.start, m.end), mark: m });
    cursor = m.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });

  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(id);
    }
  };

  return (
    <div className="sheet-text">
      {parts.map((p, i) =>
        p.mark ? (
          <mark
            key={p.mark.id}
            id={`mark-${p.mark.id}`}
            role={onSelect ? "button" : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={`${p.mark.label}: ${p.text}`}
            aria-current={activeId === p.mark.id ? "true" : undefined}
            onClick={() => onSelect?.(p.mark!.id)}
            onKeyDown={(e) => onKey(e, p.mark!.id)}
            className={cx("mark", p.mark.className)}
            data-src={p.mark.group}
          >
            {p.text}
          </mark>
        ) : (
          <Fragment key={`t${i}`}>{p.text}</Fragment>
        ),
      )}
    </div>
  );
}

/** Scrolls a margin note into view and focuses it. */
export function focusNote(id: string) {
  const el = document.getElementById(`note-${id}`);
  if (!el) return;
  el.scrollIntoView({
    block: "nearest",
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
  el.focus({ preventScroll: true });
}

export function focusMark(id: string) {
  const el = document.getElementById(`mark-${id}`);
  if (!el) return;
  el.scrollIntoView({
    block: "center",
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
  el.focus({ preventScroll: true });
}
