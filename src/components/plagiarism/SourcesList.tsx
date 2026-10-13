"use client";

import { useState } from "react";
import type { ReviewedReport } from "@/core/plagiarism/review";
import { SourceLink } from "./FindingDetail";

/** Numbered sources with their share of the text, then other places with the same wording. */
export function SourcesList({
  r,
  colour,
  onShow,
  onExclude,
}: {
  r: ReviewedReport;
  colour: ReadonlyMap<string, number>;
  /** Selects the first finding from this source. */
  onShow: (sourceId: string) => void;
  onExclude: (sourceId: string) => void;
}) {
  const [showOthers, setShowOthers] = useState(false);
  return (
    <section aria-labelledby="src-h">
      <h3 id="src-h" className="font-semibold">
        Sources ({r.primary.length})
      </h3>
      {r.primary.length === 0 ? (
        <p className="mt-1 text-sm text-ink-soft">
          None of the searched sources shared a run of words with your
          text.
        </p>
      ) : (
        <ol className="mt-2 space-y-2">
          {r.primary.map((s, n) => (
            <li
              key={s.id}
              className="card print-avoid px-3 py-2.5 text-sm"
              data-src={colour.get(s.id)}
            >
              <div className="flex items-start gap-3">
                <span
                  className="src-badge mt-0.5 shrink-0"
                  aria-label={`Source ${n + 1}`}
                >
                  {n + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <SourceLink s={s} />
                    <span className="shrink-0 font-semibold tabular-nums">
                      {s.primaryPercent}%
                    </span>
                  </div>
                  <div
                    aria-hidden
                    className="mt-1 h-1.5 rounded-full bg-desk-deep"
                  >
                    <div
                      className="h-full rounded-full bg-[var(--src-line,var(--mark-match-line))]"
                      style={{
                        width: `${Math.min(100, Math.max(2, s.primaryPercent * 2))}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-ink-faint">
                    {[s.authors, s.provider]
                      .filter(Boolean)
                      .join(" · ")}
                    {s.primaryWords
                      ? ` · ${s.primaryWords} words`
                      : " · reworded only"}
                    {s.alsoAt.length
                      ? ` · also found via ${s.alsoAt.join(", ")}`
                      : ""}
                    {s.fullText
                      ? ` · whole paper compared (${s.fullText})`
                      : ""}
                    {s.kind === "own"
                      ? " · your own earlier paper"
                      : ""}
                  </p>
                  <div className="mt-1 flex gap-4 print:hidden">
                    <button
                      type="button"
                      className="text-action underline-offset-4 hover:underline"
                      onClick={() => onShow(s.id)}
                    >
                      Show in text
                    </button>
                    {s.kind !== "self" && (
                      <button
                        type="button"
                        className="text-ink-soft underline-offset-4 hover:underline"
                        onClick={() => onExclude(s.id)}
                      >
                        Exclude
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {r.others.length > 0 && (
        <div className="mt-3 text-sm">
          <button
            type="button"
            onClick={() => setShowOthers((x) => !x)}
            aria-expanded={showOthers}
            className="font-semibold text-action hover:underline"
          >
            {showOthers ? "Hide" : "Show"} {r.others.length} other place
            {r.others.length === 1 ? "" : "s"} with the same wording
          </button>
          <p className="text-ink-faint">
            These contain the same passages but are not the best match,
            often because they quote the original.
          </p>
          {showOthers && (
            <ul className="mt-2 space-y-1.5">
              {r.others.map((s) => (
                <li
                  key={s.id}
                  className="flex items-baseline justify-between gap-3 border-l-2 border-rule pl-3"
                >
                  <span className="min-w-0">
                    <SourceLink s={s} />{" "}
                    <span className="text-ink-faint">
                      · {s.provider}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-faint">
                    {s.matchedWords} words
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
