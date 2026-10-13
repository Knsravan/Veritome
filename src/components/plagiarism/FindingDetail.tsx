"use client";

import { ISSUE_TEXT, type Issue } from "@/core/plagiarism/review";
import type { MatchedSource, SourceExcerpt } from "@/core/plagiarism/types";
import { AlertIcon, InfoIcon, XIcon } from "../icons";
import { cx } from "../ui";
import { KIND_STYLE, badgeSlot } from "./shared";

const words = (s: string) =>
  new Set(
    (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
      (w) => w.length > 3,
    ),
  );

/** Text with the words it shares with `other` in bold, for comparing a reworded sentence with its source. */
function SharedWords({ text, other }: { text: string; other: string }) {
  const shared = words(other);
  return (
    <>
      {text.split(/(\s+)/).map((part, i) => {
        const w = part.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
        return shared.has(w) ? (
          <strong
            key={i}
            className="font-semibold text-ink underline decoration-match-line decoration-2 underline-offset-2"
          >
            {part}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}

function Excerpt({ ex }: { ex: SourceExcerpt }) {
  return (
    <>
      {ex.text.slice(0, ex.matchStart)}
      <mark className="mark mark-match rounded-sm">
        {ex.text.slice(ex.matchStart, ex.matchEnd)}
      </mark>
      {ex.text.slice(ex.matchEnd)}
    </>
  );
}

export function SourceLink({ s }: { s: MatchedSource | undefined }) {
  if (!s) return <span>an unknown source</span>;
  const label = `${s.title}${s.year ? ` (${s.year})` : ""}`;
  return s.url ? (
    <a
      href={s.url}
      target="_blank"
      rel="noreferrer"
      className="font-semibold text-action underline-offset-4 hover:underline"
    >
      {label}
    </a>
  ) : (
    <span className="font-semibold">{label}</span>
  );
}

/** The detail card for one finding: what is wrong, how to fix it, and the two texts side by side. */
export function FindingDetail({
  issue,
  source,
  number,
  excerpt,
  sourceSentence,
  onExclude,
  onClose,
}: {
  issue: Issue;
  source: MatchedSource | undefined;
  number: number | undefined;
  excerpt: SourceExcerpt | undefined;
  sourceSentence: string | undefined;
  onExclude: (id: string) => void;
  onClose: () => void;
}) {
  const t = ISSUE_TEXT[issue.kind];
  return (
    <section
      aria-live="polite"
      aria-label="Selected finding"
      className="card overflow-hidden"
    >
      <div
        className={cx(
          "flex items-start justify-between gap-2 px-4 py-3",
          KIND_STYLE[issue.kind].chip,
        )}
      >
        <p className="flex items-center gap-2 font-semibold">
          {t.serious ? (
            <AlertIcon size={16} strokeWidth={2.2} />
          ) : (
            <InfoIcon size={16} strokeWidth={2.2} />
          )}
          {t.title}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 hover:bg-page/60"
          aria-label="Close finding"
        >
          <XIcon size={16} />
        </button>
      </div>
      <div className="space-y-3 px-4 py-3 text-sm">
        {issue.note && <p className="font-semibold">{issue.note}</p>}
        {issue.kind !== "disguised" && <p className="text-ink-soft">{t.why}</p>}
        <p>
          <span className="font-semibold">How to fix: </span>
          {t.fix}
        </p>
        {issue.citation && (
          <p className="text-ink-soft">
            Citation found nearby: {issue.citation}
          </p>
        )}
        <div className="grid gap-2">
          <div className="rounded-md border border-rule bg-desk/50 px-3 py-2">
            <p className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
              Your text
            </p>
            <p className="mt-1 font-serif text-[0.95rem]">
              {sourceSentence ? (
                <SharedWords text={issue.text} other={sourceSentence} />
              ) : (
                <mark className="mark mark-match rounded-sm">{issue.text}</mark>
              )}
            </p>
          </div>
          {(excerpt || sourceSentence) && (
            <div className="rounded-md border border-rule bg-desk/50 px-3 py-2">
              <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">
                {number !== undefined && (
                  <span className="src-badge" data-src={badgeSlot(number)}>
                    {number}
                  </span>
                )}
                Source
              </p>
              <p className="mt-1 font-serif text-[0.95rem]">
                {excerpt ? (
                  <Excerpt ex={excerpt} />
                ) : (
                  <SharedWords text={sourceSentence ?? ""} other={issue.text} />
                )}
              </p>
            </div>
          )}
        </div>
        {source && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-3">
            <p className="min-w-0 text-ink-soft">
              From <SourceLink s={source} />
              {source.authors ? `, ${source.authors}` : ""} · {source.provider}
            </p>
            {source.kind !== "self" && (
              <button
                type="button"
                onClick={() => onExclude(source.id)}
                className="text-sm font-semibold text-action hover:underline print:hidden"
              >
                Exclude this source
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
