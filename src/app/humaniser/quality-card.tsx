"use client";

import { useMemo } from "react";
import { PenIcon } from "@/components/icons";
import { cx } from "@/components/ui";
import { mostGeneric, writingQuality } from "@/core/rewrite/quality";
import { finalOf, type Job } from "./shared";

const tone = (s: number) =>
  s >= 75 ? "bg-ok" : s >= 50 ? "bg-warn" : "bg-danger";

/**
 * Writing quality before and after: how plain, easy to follow, varied, direct and specific the revised paragraphs
 * are, worked out in the browser. It describes the writing only. Below it, the paragraphs that most need the
 * author's own details, each with a way into "Make it yours".
 */
export function QualityCard({
  job,
  onMakeYours,
}: {
  job: Job;
  onMakeYours: (i: number) => void;
}) {
  const { before, after, generic } = useMemo(() => {
    const rewrite = job.items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => it.piece.rewrite);
    const finals = rewrite.map(({ it }) => finalOf(it));
    return {
      before: writingQuality(rewrite.map(({ it }) => it.piece.text).join("\n\n")),
      after: writingQuality(finals.join("\n\n")),
      generic: mostGeneric(finals).map((k) => rewrite[k]!.i),
    };
  }, [job]);
  if (!before.words) return null;
  const left = after.phrases.slice(0, 6);

  return (
    <section
      aria-labelledby="quality-h"
      className="card grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="quality-h" className="font-display text-xl font-semibold">
              Writing quality
            </h2>
            <p className="text-sm text-ink-soft">
              How plain, clear and specific the text reads. It describes the
              writing, not who wrote it.
            </p>
          </div>
          <p
            className="flex items-baseline gap-2 font-display tabular-nums"
            aria-label={`Score ${before.score} before, ${after.score} after, out of 100`}
          >
            <span className="text-2xl font-semibold text-ink-faint">
              {before.score}
            </span>
            <span aria-hidden className="text-ink-faint">
              →
            </span>
            <span className="text-4xl font-bold text-ink">{after.score}</span>
            <span className="text-sm text-ink-soft">/ 100</span>
          </p>
        </div>
        <ul className="space-y-3">
          {after.parts.map((p, k) => {
            const was = before.parts[k]!;
            return (
              <li key={p.id}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-semibold">{p.label}</span>
                  <span className="tabular-nums text-ink-soft">
                    {was.score} → <span className="font-semibold text-ink">{p.score}</span>
                  </span>
                </div>
                <div
                  className="relative mt-1 h-2 overflow-hidden rounded-full bg-desk-deep"
                  aria-hidden
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-ink-faint/40"
                    style={{ width: `${was.score}%` }}
                  />
                  <div
                    className={cx(
                      "absolute inset-y-0 left-0 rounded-full transition-[width] duration-700",
                      tone(p.score),
                    )}
                    style={{ width: `${p.score}%` }}
                  />
                </div>
                <p className="mt-0.5 text-xs text-ink-soft">{p.detail}</p>
              </li>
            );
          })}
        </ul>
        {left.length > 0 && (
          <p className="text-sm text-ink-soft">
            Still in the text:{" "}
            {left.map((ph, k) => (
              <span key={ph.text}>
                {k > 0 && ", "}
                <q className="font-medium text-ink">{ph.text}</q>
                {ph.count > 1 && ` ×${ph.count}`}
              </span>
            ))}
            . Open the paragraph and edit it, or try another version.
          </p>
        )}
      </div>

      <div className="space-y-3 rounded-xl bg-action-soft/50 p-4 sm:p-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <PenIcon size={16} className="text-action" /> Make it more yours
        </h3>
        <p className="text-sm text-ink-soft">
          Writing reads as your own when it holds things only you know: what you
          measured, chose, saw go wrong. These paragraphs have the fewest
          numbers, names or citations. Answer a few questions and your own
          details are written in.
        </p>
        {generic.length ? (
          <ol className="space-y-2">
            {generic.map((i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onMakeYours(i)}
                  className="group block w-full rounded-lg border border-rule bg-page px-3 py-2 text-left text-sm hover:border-action/50"
                >
                  <span className="line-clamp-2 font-serif text-ink-soft">
                    {finalOf(job.items[i]!)}
                  </span>
                  <span className="mt-1 inline-flex items-center gap-1 font-semibold text-action group-hover:underline">
                    <PenIcon size={13} /> Add my own details
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm font-medium text-ok">
            Every paragraph already carries specific details.
          </p>
        )}
      </div>
    </section>
  );
}
