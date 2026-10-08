"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type {
  DocModel,
  DocxModel,
  Paragraph,
  PdfModel,
  PdfPage,
  Run,
} from "@/lib/doc/model";
import type { TextMark } from "./AnnotatedText";
import { useImageReport } from "./DocumentContext";
import { cx } from "./ui";

/** A stretch of text and every mark covering it, most important first. */
interface Segment {
  start: number;
  end: number;
  marks: TextMark[];
}

/**
 * Splits [0, length) wherever a mark starts or ends. Marks may overlap: each segment lists all marks covering it
 * in the order they were given, so the first is the one a click selects.
 */
export function segmentMarks(
  marks: readonly TextMark[],
  length: number,
): Segment[] {
  const valid = marks.filter(
    (m) => m.end > m.start && m.start >= 0 && m.start < length,
  );
  const cuts = new Set<number>([0, length]);
  for (const m of valid) {
    cuts.add(m.start);
    cuts.add(Math.min(m.end, length));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const order = new Map(valid.map((m, i) => [m, i]));
  const byStart = [...valid].sort((a, b) => a.start - b.start);
  const active: TextMark[] = [];
  const out: Segment[] = [];
  let k = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    while (k < byStart.length && byStart[k]!.start <= a)
      active.push(byStart[k++]!);
    for (let j = active.length - 1; j >= 0; j--)
      if (active[j]!.end <= a) active.splice(j, 1);
    out.push({
      start: a,
      end: b,
      marks: [...active].sort((x, y) => order.get(x)! - order.get(y)!),
    });
  }
  return out;
}

function slice(segs: Segment[], start: number, end: number): Segment[] {
  // Binary search for the first segment ending after `start`.
  let lo = 0;
  let hi = segs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid]!.end <= start) lo = mid + 1;
    else hi = mid;
  }
  const out: Segment[] = [];
  for (let i = lo; i < segs.length && segs[i]!.start < end; i++) {
    const s = segs[i]!;
    out.push({
      start: Math.max(s.start, start),
      end: Math.min(s.end, end),
      marks: s.marks,
    });
  }
  return out;
}

interface Ctx {
  text: string;
  segs: Segment[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
  /** Marks already given their focusable first segment. */
  placed: Set<string>;
}

/** Text with nested marks: the first mark is innermost and takes the click; outer marks only add their style. */
function Marked({
  ctx,
  start,
  end,
  render = (s) => s,
}: {
  ctx: Ctx;
  start: number;
  end: number;
  render?: (s: string) => ReactNode;
}) {
  return (
    <>
      {slice(ctx.segs, start, end).map((s) => {
        const content = render(ctx.text.slice(s.start, s.end));
        if (!s.marks.length)
          return <Fragment key={s.start}>{content}</Fragment>;
        const [top, ...rest] = s.marks;
        const first = !ctx.placed.has(top!.id);
        if (first) ctx.placed.add(top!.id);
        const onKey = (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            ctx.onSelect?.(top!.id);
          }
        };
        let node: ReactNode = (
          <mark
            id={first ? `mark-${top!.id}` : undefined}
            role={ctx.onSelect && first ? "button" : undefined}
            tabIndex={ctx.onSelect && first ? 0 : undefined}
            aria-label={
              first
                ? `${top!.label}: ${ctx.text.slice(top!.start, top!.end).replace(/\s+/g, " ").slice(0, 120)}`
                : undefined
            }
            aria-current={ctx.activeId === top!.id ? "true" : undefined}
            data-mark={top!.id}
            data-src={top!.group}
            data-n={first ? top!.n : undefined}
            onClick={(e) => {
              e.stopPropagation();
              ctx.onSelect?.(top!.id);
            }}
            onKeyDown={first ? onKey : undefined}
            className={cx(
              "mark",
              top!.className,
              ctx.activeId === top!.id && "is-active",
            )}
          >
            {content}
          </mark>
        );
        for (const m of rest) {
          node = (
            <span
              className={cx("mark mark-under", m.className)}
              data-src={m.group}
              data-mark={m.id}
            >
              {node}
            </span>
          );
        }
        return <Fragment key={s.start}>{node}</Fragment>;
      })}
    </>
  );
}

function RunView({ ctx, run }: { ctx: Ctx; run: Run }) {
  let el: ReactNode = <Marked ctx={ctx} start={run.start} end={run.end} />;
  if (run.script === "sup") el = <sup>{el}</sup>;
  if (run.script === "sub") el = <sub>{el}</sub>;
  if (run.bold) el = <strong>{el}</strong>;
  if (run.italic) el = <em>{el}</em>;
  if (run.underline) el = <span className="underline">{el}</span>;
  if (run.hidden)
    el = (
      <span
        className="doc-hidden"
        title="Hidden in the file: invisible on the page, but read by checkers"
      >
        {el}
      </span>
    );
  return el;
}

const P_CLASS: Record<Paragraph["style"], string> = {
  title: "font-display text-[1.7rem] leading-tight font-bold text-center mb-5",
  h1: "font-display text-[1.4rem] leading-snug font-bold mt-7 mb-3",
  h2: "font-display text-[1.2rem] leading-snug font-semibold mt-6 mb-2",
  h3: "font-display text-[1.05rem] font-semibold mt-5 mb-2",
  h4: "font-semibold italic mt-4 mb-1",
  normal: "mb-3",
  caption: "text-sm text-ink-soft italic text-center mb-4",
  quote: "mb-3 border-l-4 border-rule pl-4 italic",
};

function ParagraphView({ ctx, p }: { ctx: Ctx; p: Paragraph }) {
  return (
    <p
      className={cx(
        P_CLASS[p.style],
        p.align === "center" && "text-center",
        p.align === "right" && "text-right",
        p.align === "justify" && "text-justify",
      )}
      style={{ whiteSpace: "pre-wrap" }}
    >
      {p.runs.map((r) => (
        <RunView key={r.start} ctx={ctx} run={r} />
      ))}
    </p>
  );
}

const IMAGE_FLAG: Record<string, string> = {
  duplicate: "The same picture appears elsewhere in the paper",
  source_figure: "Matches a figure in a published source",
  text_match: "Text in this picture matches a source",
};

function DocxView({ doc, ctx }: { doc: DocxModel; ctx: Ctx }) {
  const images = new Map(doc.images.map((i) => [i.id, i]));
  const imageReport = useImageReport();
  const out: ReactNode[] = [];
  let figure = 0;
  for (let i = 0; i < doc.blocks.length; i++) {
    const b = doc.blocks[i]!;
    if (b.kind === "p" && b.list) {
      // Consecutive list items become one list.
      const items: Paragraph[] = [];
      while (
        i < doc.blocks.length &&
        doc.blocks[i]!.kind === "p" &&
        (doc.blocks[i] as Paragraph).list
      )
        items.push(doc.blocks[i++] as Paragraph);
      i--;
      const ordered = items[0]!.list!.ordered;
      const List = ordered ? "ol" : "ul";
      out.push(
        <List
          key={`l${items[0]!.runs[0]?.start ?? i}`}
          className={cx("mb-3 pl-6", ordered ? "list-decimal" : "list-disc")}
        >
          {items.map((p, n) => (
            <li
              key={p.runs[0]?.start ?? n}
              style={{
                marginLeft: `${p.list!.level * 1.25}rem`,
                whiteSpace: "pre-wrap",
              }}
            >
              {p.runs.map((r) => (
                <RunView key={r.start} ctx={ctx} run={r} />
              ))}
            </li>
          ))}
        </List>,
      );
    } else if (b.kind === "p")
      out.push(
        <ParagraphView key={`p${b.runs[0]?.start ?? i}`} ctx={ctx} p={b} />,
      );
    else if (b.kind === "table")
      out.push(
        <div key={`t${i}`} className="mb-4 overflow-x-auto">
          <table className="w-full border-collapse font-sans text-[0.9rem]">
            <tbody>
              {b.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={cx(
                        "border border-rule px-2 py-1 align-top",
                        ri === 0 && "bg-desk font-semibold",
                      )}
                    >
                      {cell.map((p, pi) => (
                        <div key={pi} style={{ whiteSpace: "pre-wrap" }}>
                          {p.runs.map((r) => (
                            <RunView key={r.start} ctx={ctx} run={r} />
                          ))}
                        </div>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    else {
      const img = images.get(b.imageId);
      figure++;
      if (img)
        out.push(
          <figure
            key={`f${i}`}
            id={`doc-image-${img.id}`}
            className="my-4 flex flex-col items-center gap-1.5"
          >
            {img.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={img.src}
                alt={`Image ${figure} in the document`}
                className="max-h-[28rem] max-w-full rounded border border-rule bg-white object-contain"
              />
            ) : (
              <span className="rounded border border-dashed border-rule px-4 py-6 text-sm text-ink-faint">
                Image {figure} ({img.mime.replace("image/", "").toUpperCase()},
                cannot be shown in a browser)
              </span>
            )}
            {imageReport?.findings
              .filter((f) => f.imageId === img.id || f.otherId === img.id)
              .slice(0, 2)
              .map((f) => (
                <figcaption
                  key={f.id}
                  className="font-sans text-sm font-semibold text-danger underline decoration-[var(--u-flag)] decoration-double underline-offset-4"
                >
                  {IMAGE_FLAG[f.kind]}
                </figcaption>
              ))}
          </figure>,
        );
    }
  }
  return (
    <div className="doc-docx font-serif text-[1.02rem] leading-[1.75]">
      {out}
    </div>
  );
}

/** Plain text split into paragraphs, for pasted text. */
function PlainView({ ctx }: { ctx: Ctx }) {
  return (
    <div className="sheet-text">
      <Marked ctx={ctx} start={0} end={ctx.text.length} />
    </div>
  );
}

// PDF pages are always white paper, so their highlights use fixed light colours (see .pdf-hl in globals.css).
const pdfCache = new WeakMap<Uint8Array, Promise<unknown>>();
async function loadPdf(
  data: Uint8Array,
): Promise<{ getPage: (n: number) => Promise<unknown> }> {
  let p = pdfCache.get(data);
  if (!p) {
    p = import("unpdf").then(({ getDocumentProxy }) =>
      getDocumentProxy(data.slice()),
    );
    pdfCache.set(data, p);
  }
  return p as Promise<{ getPage: (n: number) => Promise<unknown> }>;
}

function PdfPageView({
  doc,
  page,
  ctx,
  firstAt,
}: {
  doc: PdfModel;
  page: PdfPage;
  ctx: Ctx;
  firstAt: Map<string, number>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "drawn" | "error">("idle");
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let cancelled = false;
    let task: { cancel?: () => void } | null = null;
    const draw = async () => {
      try {
        const pdf = await loadPdf(doc.data);
        const pg = (await pdf.getPage(page.number)) as {
          getViewport: (o: { scale: number }) => {
            width: number;
            height: number;
          };
          render: (o: unknown) => {
            promise: Promise<void>;
            cancel?: () => void;
          };
        };
        const c = canvas.current;
        if (!c || cancelled) return;
        const scale =
          (el.clientWidth / page.width) *
          Math.min(2, window.devicePixelRatio || 1);
        const vp = pg.getViewport({ scale });
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        const r = pg.render({
          canvasContext: c.getContext("2d"),
          viewport: vp,
          canvas: c,
        });
        task = r;
        await r.promise;
        if (!cancelled) setState("drawn");
      } catch {
        if (!cancelled) setState("error");
      }
    };
    if (!("IntersectionObserver" in window)) void draw();
    else {
      const io = new IntersectionObserver(
        ([e]) => {
          if (e?.isIntersecting) {
            io.disconnect();
            void draw();
          }
        },
        { rootMargin: "600px 0px" },
      );
      io.observe(el);
      return () => {
        cancelled = true;
        io.disconnect();
        task?.cancel?.();
      };
    }
    return () => {
      cancelled = true;
      task?.cancel?.();
    };
  }, [doc.data, page.number, page.width]);

  // Highlight boxes: each item's share of a marked range, drawn over the page.
  const boxes: ReactNode[] = [];
  for (const it of page.items) {
    if (it.skipped || it.end <= it.start) continue;
    for (const s of slice(ctx.segs, it.start, it.end)) {
      if (!s.marks.length) continue;
      const span = it.end - it.start;
      const f0 = (s.start - it.start) / span;
      const f1 = (s.end - it.start) / span;
      s.marks.forEach((m, depth) => {
        // Each mark gets one focusable button, on the first piece of it drawn anywhere in the document.
        const first = firstAt.get(m.id) === s.start;
        const style = {
          left: `${((it.x + f0 * it.w) / page.width) * 100}%`,
          top: `${(it.y / page.height) * 100}%`,
          width: `${(((f1 - f0) * it.w) / page.width) * 100}%`,
          height: `${(it.h / page.height) * 100}%`,
          ["--depth" as string]: depth,
        };
        const cls = cx(
          "pdf-hl",
          m.className,
          depth > 0 && "is-under",
          ctx.activeId === m.id && "is-active",
        );
        boxes.push(
          first && ctx.onSelect ? (
            <button
              key={`${m.id}-${it.start}-${s.start}-${depth}`}
              type="button"
              id={`mark-${m.id}`}
              aria-label={`${m.label}: ${ctx.text.slice(m.start, m.end).replace(/\s+/g, " ").slice(0, 120)}`}
              aria-current={ctx.activeId === m.id ? "true" : undefined}
              data-mark={m.id}
              data-src={m.group}
              data-n={m.n}
              className={cls}
              style={style}
              onClick={() => ctx.onSelect?.(m.id)}
            />
          ) : (
            <span
              key={`${m.id}-${it.start}-${s.start}-${depth}`}
              aria-hidden
              data-mark={m.id}
              data-src={m.group}
              data-n={first ? m.n : undefined}
              className={cls}
              style={style}
              onClick={() => ctx.onSelect?.(m.id)}
            />
          ),
        );
      });
    }
  }

  return (
    <div
      ref={box}
      className="pdf-page relative mx-auto w-full overflow-hidden rounded-md bg-white shadow-[var(--shadow-card)] ring-1 ring-black/5"
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
      aria-label={`Page ${page.number}`}
      role="group"
    >
      <canvas
        ref={canvas}
        aria-hidden
        className={cx(
          "absolute inset-0 h-full w-full transition-opacity duration-500",
          state === "drawn" ? "opacity-100" : "opacity-0",
        )}
      />
      {state !== "drawn" && (
        <div
          aria-hidden
          className="absolute inset-0 flex items-center justify-center text-sm text-neutral-500"
        >
          {state === "error" ? (
            "This page could not be drawn."
          ) : (
            <span className="inline-block size-5 animate-spin rounded-full border-2 border-neutral-400 border-r-transparent" />
          )}
        </div>
      )}
      {boxes}
    </div>
  );
}

function PdfView({ doc, ctx }: { doc: PdfModel; ctx: Ctx }) {
  const firstAt = new Map<string, number>();
  for (const p of doc.pages)
    for (const it of p.items) {
      if (it.skipped || it.end <= it.start) continue;
      for (const s of slice(ctx.segs, it.start, it.end))
        for (const m of s.marks)
          if (!firstAt.has(m.id) || firstAt.get(m.id)! > s.start)
            firstAt.set(m.id, s.start);
    }
  return (
    <div className="space-y-5">
      {doc.pages.map((p) => (
        <PdfPageView
          key={p.number}
          doc={doc}
          page={p}
          ctx={ctx}
          firstAt={firstAt}
        />
      ))}
    </div>
  );
}

/**
 * A Word file in its exact layout (pages, columns, fonts) with findings drawn on as underlines. Falls back to
 * the structured view if the file cannot be laid out.
 */
function DocxExact({
  doc,
  ctx,
  marks,
  fallback,
}: {
  doc: DocxModel;
  ctx: Ctx;
  marks: readonly TextMark[];
  fallback: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [zoom, setZoom] = useState(1);
  const key = marks
    .map((m) => `${m.id}:${m.start}:${m.end}:${m.className}:${m.group ?? ""}`)
    .join(",");
  const onSelect = ctx.onSelect;

  useEffect(() => {
    let off = false;
    setState("loading");
    void import("@/lib/doc/docx-exact")
      .then(({ renderDocx }) => renderDocx(pages.current!, doc.data!))
      .then(() => {
        if (off) return;
        // Size the pages to fit before showing them, so nothing jumps once they appear.
        const page = pages.current?.querySelector<HTMLElement>("section.docx");
        if (page && box.current)
          setZoom(
            Math.min(1, (box.current.clientWidth - 8) / page.offsetWidth),
          );
        setState("ready");
      })
      .catch(() => !off && setState("error"));
    return () => {
      off = true;
    };
  }, [doc.data]);

  useEffect(() => {
    if (state !== "ready" || !pages.current) return;
    void import("@/lib/doc/docx-exact").then(({ drawMarks }) =>
      drawMarks(pages.current!, ctx.text, marks, Boolean(onSelect)),
    );
    // `key` stands for the marks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, key, ctx.text]);

  useEffect(() => {
    const root = pages.current;
    if (state !== "ready" || !root) return;
    for (const el of Array.from(root.querySelectorAll("mark.is-active")))
      el.classList.remove("is-active");
    if (ctx.activeId)
      for (const el of Array.from(
        root.querySelectorAll(`mark[data-mark="${CSS.escape(ctx.activeId)}"]`),
      ))
        el.classList.add("is-active");
  }, [ctx.activeId, state, key]);

  // Fit the pages to the available width.
  useEffect(() => {
    const el = box.current;
    if (state !== "ready" || !el || !("ResizeObserver" in window)) return;
    const fit = () => {
      const page = pages.current?.querySelector<HTMLElement>("section.docx");
      if (!page) return;
      const z = Math.min(1, (el.clientWidth - 8) / page.offsetWidth);
      setZoom((old) => (Math.abs(old - z) > 0.01 ? z : old));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  if (state === "error") return <>{fallback}</>;
  const pick = (target: EventTarget | null) => {
    const el = (target as HTMLElement | null)?.closest?.(
      "mark[data-mark]",
    ) as HTMLElement | null;
    if (el?.dataset.mark) onSelect?.(el.dataset.mark);
  };
  return (
    <div
      ref={box}
      className="docx-exact relative min-h-40 overflow-hidden [contain:paint]"
    >
      {state === "loading" && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-faint">
          <span className="inline-block size-5 animate-spin rounded-full border-2 border-current border-r-transparent" />{" "}
          Laying out your paper…
        </div>
      )}
      <div
        ref={pages}
        style={{ zoom }}
        className={cx(
          "transition-opacity duration-500",
          state === "ready"
            ? "opacity-100"
            : "pointer-events-none invisible absolute inset-x-0 top-0 opacity-0",
        )}
        onClick={(e) => pick(e.target)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            const el = e.target as HTMLElement;
            if (el.matches?.("mark[data-mark]")) {
              e.preventDefault();
              pick(el);
            }
          }
        }}
      />
    </div>
  );
}

/**
 * Your paper with its findings drawn on it. With an uploaded Word or PDF file it keeps the original layout
 * (headings, emphasis, lists, tables, images, or the PDF pages themselves); pasted text is shown as text.
 * Marks can overlap: a passage can be both copied and AI-like, and both show.
 */
export function DocumentView({
  doc,
  text,
  marks,
  activeId,
  onSelect,
  layout = "original",
}: {
  doc: DocModel | null;
  text: string;
  marks: readonly TextMark[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
  layout?: "original" | "plain";
}) {
  const segs = useMemo(
    () => segmentMarks(marks, text.length),
    [marks, text.length],
  );
  const ctx: Ctx = {
    text,
    segs,
    activeId: activeId ?? null,
    ...(onSelect ? { onSelect } : {}),
    placed: new Set(),
  };
  const usable = doc && doc.text === text ? doc : null;
  if (!usable || layout === "plain") return <PlainView ctx={ctx} />;
  if (usable.kind === "docx") {
    const structured = <DocxView doc={usable} ctx={ctx} />;
    return usable.data && typeof window !== "undefined" ? (
      <DocxExact doc={usable} ctx={ctx} marks={marks} fallback={structured} />
    ) : (
      structured
    );
  }
  return <PdfView doc={usable} ctx={ctx} />;
}

/** Switch between the paper's original layout and plain text. */
export function LayoutToggle({
  value,
  onChange,
  kind,
}: {
  value: "original" | "plain";
  onChange: (v: "original" | "plain") => void;
  kind: "docx" | "pdf";
}) {
  return (
    <div
      role="radiogroup"
      aria-label="How to show your paper"
      className="mb-4 ml-auto flex w-fit rounded-lg border border-rule p-0.5 text-sm print:hidden"
    >
      {(
        [
          ["original", kind === "pdf" ? "Original pages" : "Original layout"],
          ["plain", "Plain text"],
        ] as const
      ).map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cx(
            "rounded-md px-3 py-1.5 font-semibold transition-colors",
            value === v ? "bg-ink text-page" : "text-ink-soft hover:bg-desk",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
