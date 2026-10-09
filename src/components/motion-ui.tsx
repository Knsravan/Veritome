"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cx } from "./ui";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * A row of choices with one highlighted pill that slides to the chosen one. Works as tabs (Text mode / File mode) or
 * as a radio group (Tone, Strength), with the usual keyboard support for each.
 */
export function SlidingChoice<T extends string>({
  value,
  options,
  onChange,
  kind = "tabs",
  label,
  labelledBy,
  equal,
  className,
  size = "md",
}: {
  value: T;
  options: ReadonlyArray<{ id: T; label: ReactNode; title?: string }>;
  onChange: (v: T) => void;
  kind?: "tabs" | "radios";
  label?: string;
  labelledBy?: string;
  /** All choices the same width. */
  equal?: boolean;
  className?: string;
  size?: "md" | "sm";
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const index = Math.max(0, options.findIndex((o) => o.id === value));

  useIso(() => {
    const measure = () => {
      const el = box.current?.querySelectorAll<HTMLElement>("[data-choice]")[index];
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    if (!("ResizeObserver" in window) || !box.current) return;
    const ro = new ResizeObserver(measure);
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [index, options.length]);

  const move = (d: number) => {
    const next = options[(index + d + options.length) % options.length]!;
    onChange(next.id);
    requestAnimationFrame(() => box.current?.querySelectorAll<HTMLElement>("[data-choice]")[(index + d + options.length) % options.length]?.focus());
  };
  const round = size === "md" ? "rounded-full" : "rounded-lg";

  return (
    <div
      ref={box}
      role={kind === "tabs" ? "tablist" : "radiogroup"}
      {...(label ? { "aria-label": label } : {})}
      {...(labelledBy ? { "aria-labelledby": labelledBy } : {})}
      className={cx(
        "relative isolate border border-rule bg-page p-1 shadow-sm",
        size === "md" ? "inline-flex rounded-full" : "grid rounded-xl",
        className,
      )}
      style={equal && size === "sm" ? ({ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } as CSSProperties) : undefined}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      <span
        aria-hidden
        className={cx(
          "absolute top-1 bottom-1 -z-10 bg-ink shadow-sm transition-[transform,width] duration-300 ease-[cubic-bezier(0.3,0.7,0.2,1)]",
          round,
          !pill && "opacity-0",
        )}
        style={pill ? { width: pill.width, transform: `translateX(${pill.left - 4}px)`, left: 4 } : undefined}
      />
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            data-choice
            type="button"
            role={kind === "tabs" ? "tab" : "radio"}
            {...(kind === "tabs" ? { "aria-selected": on } : { "aria-checked": on })}
            tabIndex={on ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.id)}
            className={cx(
              "inline-flex items-center justify-center gap-2 font-semibold transition-colors duration-300",
              round,
              size === "md" ? "px-5 py-2 text-sm" : "px-3 py-2 text-sm",
              on ? "text-page" : "text-ink-soft hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A small on/off switch drawn over a real checkbox, so it works with the keyboard and screen readers. */
export function Switch({
  checked,
  disabled,
  onChange,
  label,
  describedBy,
  hue,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
  label: string;
  describedBy?: string;
  /** The colour when on; by default the surrounding --hue, or the action colour. */
  hue?: string;
}) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center"
      style={hue ? ({ ["--hue" as string]: hue } as CSSProperties) : undefined}
    >
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-default"
      />
      <span
        aria-hidden
        className={cx(
          "h-5 w-9 rounded-full transition-colors duration-200 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)]",
          checked ? "bg-[var(--hue,var(--action))]" : "bg-desk-deep ring-1 ring-rule ring-inset",
          disabled && !checked && "opacity-50",
        )}
      />
      <span
        aria-hidden
        className={cx(
          "pointer-events-none absolute top-[3px] left-[3px] size-3.5 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked && "translate-x-4",
        )}
      />
    </span>
  );
}

/** Whether the visitor asked for less motion. */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(m.matches);
    const on = () => setReduce(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduce;
}

/** The AI detector's picture: a page being read by a beam, with the AI-like lines underlined as it passes. */
export function ScanArt() {
  const lines = [92, 100, 84, 96, 70, 100, 88, 60];
  const ai = new Set([1, 2, 5]);
  return (
    <div aria-hidden className="relative h-56 w-64 select-none">
      <div className="absolute top-6 left-8 h-48 w-48 rotate-[6deg] rounded-xl border border-rule bg-page/70 shadow-sm" />
      <div className="animate-fade-up absolute top-2 left-2 h-52 w-52 -rotate-[3deg] overflow-hidden rounded-xl border border-rule bg-page p-4 shadow-[var(--shadow-lift)]" style={{ ["--i" as string]: 2 }}>
        <div className="mb-3 h-2.5 w-1/2 rounded-full bg-ink/80" />
        <div className="space-y-2.5">
          {lines.map((w, k) => (
            <div key={k} className="relative" style={{ width: `${w}%` }}>
              <div className="h-1.5 rounded-full bg-desk-deep" />
              {ai.has(k) && (
                <div
                  className="scan-u scan-u-ai animate-grow-x absolute -bottom-1.5 left-0 w-full"
                  style={{ ["--i" as string]: k * 3 + 4 }}
                />
              )}
            </div>
          ))}
        </div>
        <div className="scan-beam" />
      </div>
      <div
        className="animate-pop absolute right-0 bottom-3 flex items-center gap-2 rounded-full border border-rule bg-page px-3 py-1.5 text-xs font-semibold shadow-md"
        style={{ animationDelay: "1.6s" }}
      >
        <span className="size-2 rounded-full bg-[var(--u-ai)]" /> 3 of 8 read as AI
      </div>
    </div>
  );
}

const SWAPS: ReadonlyArray<readonly [string, string]> = [
  ["utilize", "use"],
  ["delve into", "look at"],
  ["plays a pivotal role in", "drives"],
  ["a plethora of", "many"],
  ["in order to", "to"],
];

/** The Humaniser's picture: a stiff phrase in a sentence turns into the plain word, one after another. */
export function MorphArt() {
  const reduce = useReducedMotion();
  const [k, setK] = useState(0);
  const [plain, setPlain] = useState(false);
  useEffect(() => {
    if (reduce) {
      setPlain(true);
      return;
    }
    const t = setInterval(() => {
      setPlain((p) => {
        if (p) setK((x) => (x + 1) % SWAPS.length);
        return !p;
      });
    }, 1500);
    return () => clearInterval(t);
  }, [reduce]);
  const [stiff, easy] = SWAPS[k]!;
  return (
    <div aria-hidden className="relative h-56 w-72 select-none">
      <div className="animate-fade-up absolute inset-x-0 top-3 rounded-2xl border border-rule bg-page p-5 shadow-[var(--shadow-lift)]" style={{ ["--i" as string]: 2 }}>
        <p className="mb-3 text-xs font-semibold tracking-wide text-ink-faint uppercase">Your sentence</p>
        <p className="min-h-[4.5rem] font-serif text-[1.05rem] leading-relaxed">
          We{" "}
          <span key={`${k}-${plain}`} className="animate-swap inline-block">
            {plain ? (
              <span className="rounded bg-[color-mix(in_srgb,var(--ok)_14%,transparent)] px-1 font-semibold text-ok">{easy}</span>
            ) : (
              <span className="rounded bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-1 text-danger line-through decoration-2">{stiff}</span>
            )}
          </span>{" "}
          the river samples.
        </p>
        <div className="mt-3 flex items-center gap-2 text-xs text-ink-soft">
          <span className="font-semibold">Writing quality</span>
          <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-desk-deep">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-ok transition-[width] duration-700"
              style={{ width: plain ? "84%" : "46%" }}
            />
          </span>
          <span className="w-6 text-right font-semibold tabular-nums text-ink">{plain ? 84 : 46}</span>
        </div>
      </div>
      <div
        className="animate-pop absolute right-2 bottom-2 rounded-full border border-rule bg-page px-3 py-1.5 text-xs font-semibold shadow-md"
        style={{ animationDelay: "1.2s" }}
      >
        Citations and numbers locked
      </div>
    </div>
  );
}

const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["The results demonstrate a significant improvement in accuracy.", "Accuracy improved markedly, as the results show."],
  ["Participants were asked to complete the survey twice.", "Each participant filled in the survey on two occasions."],
  ["This approach reduces the cost of training by half.", "Training costs half as much with this approach."],
];

/** The Paraphraser's picture: a sentence, and below it the same idea typed out in new words. */
export function ParaphraseArt() {
  const reduce = useReducedMotion();
  const [k, setK] = useState(0);
  const [n, setN] = useState(0);
  const [before, after] = PAIRS[k]!;
  useEffect(() => {
    if (reduce) {
      setN(after.length);
      return;
    }
    if (n < after.length) {
      const t = setTimeout(() => setN((x) => x + 1), 28);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setK((x) => (x + 1) % PAIRS.length);
      setN(0);
    }, 2600);
    return () => clearTimeout(t);
  }, [n, after.length, reduce]);
  return (
    <div aria-hidden className="relative w-80 select-none">
      <div className="animate-fade-up space-y-3 rounded-2xl border border-rule bg-page p-5 shadow-[var(--shadow-lift)]" style={{ ["--i" as string]: 2 }}>
        <div>
          <p className="text-[0.68rem] font-semibold tracking-wide text-ink-faint uppercase">Original</p>
          <p key={k} className="animate-swap mt-1 font-serif text-[0.95rem] leading-relaxed text-ink-soft">
            {before}
          </p>
        </div>
        <div className="h-px bg-rule" />
        <div>
          <p className="text-[0.68rem] font-semibold tracking-wide text-action uppercase">Paraphrased</p>
          <p className="mt-1 min-h-[3.2rem] font-serif text-[0.95rem] leading-relaxed text-ink">
            {after.slice(0, n)}
            {n < after.length && <span className="ml-px inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-action" />}
          </p>
        </div>
      </div>
      <div className="animate-pop absolute -right-3 -bottom-4 rounded-full border border-rule bg-page px-3 py-1.5 text-xs font-semibold shadow-md" style={{ animationDelay: "1.2s" }}>
        Same meaning, checked
      </div>
    </div>
  );
}
