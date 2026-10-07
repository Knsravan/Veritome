"use client";

import { useId, useState, type ReactNode } from "react";
import { cx } from "./ui";

export interface Segment {
  key: string;
  label: string;
  /** Share of the whole, 0 to 100. */
  value: number;
  /** A CSS colour, usually a chart or status token. */
  color: string;
}

const pct = (n: number) => `${Math.round(n * 10) / 10}%`;

/**
 * A part-to-whole stacked bar: 2px surface gaps between segments, rounded outer ends, a tooltip per segment
 * and a legend with every value, so no segment is identified by colour alone.
 */
export function StackedBar({ segments, label, legendExtra }: { segments: Segment[]; label: string; legendExtra?: ReactNode }) {
  const [hover, setHover] = useState<string | null>(null);
  const shown = segments.filter((s) => s.value > 0);
  const hovered = shown.find((s) => s.key === hover);
  return (
    <figure className="m-0">
      <div className="relative">
        <div role="img" aria-label={`${label}: ${segments.map((s) => `${s.label} ${pct(s.value)}`).join(", ")}`} className="flex h-3.5 w-full gap-[2px] overflow-hidden rounded-full bg-desk-deep">
          {shown.map((s) => (
            <span
              key={s.key}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
              className="h-full first:rounded-l-full last:rounded-r-full transition-opacity"
              style={{ width: `${Math.max(0.6, s.value)}%`, background: s.color, opacity: hover && hover !== s.key ? 0.45 : 1 }}
            />
          ))}
        </div>
        {hovered && (
          <div role="tooltip" className="card pointer-events-none absolute -top-11 left-0 z-10 px-2.5 py-1 text-xs whitespace-nowrap">
            <span className="font-semibold">{hovered.label}</span> {pct(hovered.value)}
          </div>
        )}
      </div>
      <figcaption>
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {segments.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5" onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}>
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: s.color }} />
              {s.label}: <span className="font-semibold tabular-nums">{pct(s.value)}</span>
            </li>
          ))}
          {legendExtra}
        </ul>
      </figcaption>
    </figure>
  );
}

export interface ColumnDatum {
  /** Short label for the tooltip and table, such as "Paragraph 3". */
  label: string;
  /** 0 to 1. */
  value: number;
  /** Extra detail for the tooltip. */
  note?: string;
}

/**
 * One series of columns along the document, one column per paragraph, with an optional threshold line. Columns
 * are at most 24px wide, rounded at the data end and square at the baseline; hovering shows the value, and a
 * table view lists every value for screen readers and anyone who prefers numbers.
 */
export function ColumnStrip({
  title,
  data,
  color,
  threshold,
  thresholdLabel,
  format = (v) => pct(v * 100),
  onSelect,
}: {
  title: string;
  data: ColumnDatum[];
  color: string;
  threshold?: number;
  thresholdLabel?: string;
  format?: (v: number) => string;
  onSelect?: (index: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  const h = 96;
  return (
    <figure className="m-0" aria-labelledby={`${id}-t`}>
      <div className="flex items-baseline justify-between gap-3">
        <figcaption id={`${id}-t`} className="text-sm font-semibold">
          {title}
        </figcaption>
        <button type="button" onClick={() => setTable((t) => !t)} className="text-xs font-semibold text-action hover:underline print:hidden" aria-expanded={table}>
          {table ? "Show chart" : "Show as table"}
        </button>
      </div>
      {table ? (
        <table className="mt-2 w-full text-left text-sm">
          <thead>
            <tr className="text-ink-faint">
              <th className="py-1 font-normal">Part</th>
              <th className="py-1 text-right font-normal">Value</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={i} className="border-t border-rule">
                <td className="py-1">
                  {d.label}
                  {d.note ? <span className="text-ink-faint"> · {d.note}</span> : null}
                </td>
                <td className="py-1 text-right tabular-nums">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative mt-2" style={{ height: h + 18 }}>
          {/* Recessive baseline and threshold. */}
          <div aria-hidden className="absolute inset-x-0 border-t border-rule" style={{ top: h }} />
          {threshold !== undefined && (
            <div aria-hidden className="absolute inset-x-0 border-t border-dashed border-ink-faint/70" style={{ top: h - threshold * h }}>
              {thresholdLabel && <span className="absolute -top-4 left-0 bg-page pr-1 text-[0.7rem] text-ink-faint">{thresholdLabel}</span>}
            </div>
          )}
          <div className="absolute inset-x-0 top-0 flex items-end gap-[2px]" style={{ height: h }} role="list" aria-label={title}>
            {data.map((d, i) => (
              <div key={i} role="listitem" className="flex h-full min-w-[3px] flex-1">
              <button
                type="button"
                aria-label={`${d.label}: ${format(d.value)}${d.note ? `, ${d.note}` : ""}`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onClick={() => onSelect?.(i)}
                className={cx("group flex h-full w-full items-end justify-center", onSelect && "cursor-pointer")}
              >
                <span
                  className="block w-full max-w-6 rounded-t-[4px] transition-opacity"
                  style={{ height: `${Math.max(d.value > 0 ? 3 : 1, d.value * h)}px`, background: d.value > 0 ? color : "var(--rule)", opacity: hover !== null && hover !== i ? 0.5 : 1 }}
                />
              </button>
              </div>
            ))}
          </div>
          <div aria-hidden className="absolute inset-x-0 flex justify-between text-[0.7rem] text-ink-faint" style={{ top: h + 3 }}>
            <span>Start</span>
            <span>End of text</span>
          </div>
          {hover !== null && data[hover] && (
            <div
              role="tooltip"
              className="card pointer-events-none absolute z-10 -translate-x-1/2 px-2.5 py-1 text-xs whitespace-nowrap"
              style={{ left: `${((hover + 0.5) / data.length) * 100}%`, top: -8 }}
            >
              <span className="font-semibold">{data[hover].label}</span> {format(data[hover].value)}
              {data[hover].note ? <span className="text-ink-faint"> · {data[hover].note}</span> : null}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
