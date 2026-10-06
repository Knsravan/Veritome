import { cx } from "./ui";

/**
 * A 0-100 scale with the plausible range shaded and the point estimate marked.
 * Used instead of a gauge so the uncertainty is always visible.
 */
export function BandBar({
  score,
  low,
  high,
  leftLabel,
  rightLabel,
  size = "lg",
  caption,
}: {
  score: number;
  low: number;
  high: number;
  leftLabel: string;
  rightLabel: string;
  size?: "lg" | "sm";
  caption?: string;
}) {
  const clamp = (n: number) => Math.min(100, Math.max(0, n));
  return (
    <figure className="w-full">
      <div
        role="img"
        aria-label={`Score ${score} out of 100; plausible range ${low} to ${high}. 0 means ${leftLabel.toLowerCase()}, 100 means ${rightLabel.toLowerCase()}.`}
        className={cx("relative w-full rounded-sm bg-desk-deep", size === "lg" ? "h-8" : "h-4")}
      >
        {[25, 50, 75].map((t) => (
          <span key={t} aria-hidden className="absolute inset-y-0 w-px bg-rule" style={{ left: `${t}%` }} />
        ))}
        <span
          aria-hidden
          className="absolute inset-y-0 rounded-sm bg-ai/35 ring-1 ring-ai/60 ring-inset"
          style={{ left: `${clamp(low)}%`, width: `${Math.max(1, clamp(high) - clamp(low))}%` }}
        />
        <span aria-hidden className="absolute -inset-y-1 w-1 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${clamp(score)}%` }} />
      </div>
      <div className={cx("mt-1 flex justify-between text-ink-faint", size === "lg" ? "text-sm" : "text-xs")} aria-hidden>
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
      {caption && <figcaption className="mt-2 text-sm text-ink-soft">{caption}</figcaption>}
    </figure>
  );
}
