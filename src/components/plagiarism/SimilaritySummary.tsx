"use client";

import { useMemo } from "react";
import { ISSUE_TEXT, type ReviewedReport } from "@/core/plagiarism/review";
import type { MatchedSource, PlagiarismReport } from "@/core/plagiarism/types";
import { titleSimilarity } from "@/core/text/similarity";
import { paperTitle } from "@/lib/paper-title";
import { StackedBar } from "../charts";
import { CountUp } from "../motion";
import { XIcon } from "../icons";
import { Notice, cx } from "../ui";
import { BREAKDOWN_ORDER, KIND_COLOR, KIND_STYLE, SHORT_LABEL, VERDICT } from "./shared";

/** The similarity score, what the matches are, and the filters (minimum length, excluded sources). */
export function SimilaritySummary({
  text,
  report,
  r,
  byId,
  number,
  minWords,
  onMinWords,
  excluded,
  onExclude,
  onInclude,
}: {
  text: string;
  report: PlagiarismReport;
  r: ReviewedReport;
  byId: ReadonlyMap<string, MatchedSource>;
  number: (sourceId: string | undefined) => number | undefined;
  minWords: number;
  onMinWords: (n: number) => void;
  excluded: ReadonlySet<string>;
  onExclude: (sourceId: string) => void;
  onInclude: (sourceId: string) => void;
}) {
  // A source with this paper's own title is most likely the paper itself, already published or posted.
  const ownTitle = useMemo(() => paperTitle(text), [text]);
  const ownCopy = ownTitle
    ? r.primary.find(
        (s) =>
          s.kind !== "self" &&
          !excluded.has(s.id) &&
          titleSimilarity(s.title, ownTitle) >= 0.85,
      )
    : undefined;
  const total = Math.max(1, report.words);
  const serious = r.issues.filter((i) => ISSUE_TEXT[i.kind].serious).length;

  return (
    <section
      aria-label="Similarity summary"
      style={{ ["--i" as string]: 0 }}
      className="animate-fade-up card grid gap-6 p-5 sm:p-6 lg:grid-cols-[auto_1fr]"
    >
      <div className="lg:min-w-48 lg:border-r lg:border-rule lg:pr-8">
        <p className="font-display text-6xl font-semibold tracking-tight tabular-nums">
          <CountUp
            value={r.similarity}
            decimals={Number.isInteger(r.similarity) ? 0 : 1}
          />
          <span className="text-3xl text-ink-faint">%</span>
        </p>
        <p className="mt-1 font-semibold">{VERDICT[r.verdict]}</p>
        <p className="text-sm text-ink-soft">
          {r.matchedWords.toLocaleString("en")} of{" "}
          {report.words.toLocaleString("en")} words match a source word for
          word.
        </p>
      </div>
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-semibold">What the matches are</p>
          <StackedBar
            label="What the matches are, as a share of the text"
            segments={BREAKDOWN_ORDER.filter(
              (k) =>
                (k !== "repeated" && k !== "own_work") || r.breakdown[k] > 0,
            ).map((k) => ({
              key: k,
              label: SHORT_LABEL[k],
              value: (r.breakdown[k] / total) * 100,
              color: KIND_COLOR[k],
            }))}
            legendExtra={
              r.breakdown.quote_uncited > 0 ? (
                <li className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={cx(
                      "size-2.5 rounded-full",
                      KIND_STYLE.quote_uncited.dot,
                    )}
                  />
                  Quotations without citation:{" "}
                  <span className="font-semibold tabular-nums">
                    {r.breakdown.quote_uncited}
                  </span>
                </li>
              ) : undefined
            }
          />
          <p className="mt-2 text-sm text-ink-soft">
            {serious === 0 && r.issues.length === 0
              ? "No problems found in the sources searched."
              : serious === 0
                ? "Nothing serious: only notes worth a quick look."
                : `${serious} passage${serious === 1 ? "" : "s"} need${serious === 1 ? "s" : ""} fixing before you submit. Reworded sentences are not counted in the percentage.`}
          </p>
        </div>
        {ownCopy && (
          <Notice kind="info" title="This looks like your paper itself">
            Source {number(ownCopy.id)}, “{ownCopy.title}”, has the same title
            as this paper, so it is probably this paper already published or
            posted online. Checkers such as Turnitin count that match too. If
            it is yours, exclude it to see what else matches.{" "}
            <button
              type="button"
              className="font-semibold text-action hover:underline"
              onClick={() => onExclude(ownCopy.id)}
            >
              Exclude it
            </button>
          </Notice>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-rule pt-3 text-sm print:hidden">
          <label className="flex items-center gap-2">
            Hide matches under
            <select
              value={minWords}
              onChange={(e) => onMinWords(Number(e.target.value))}
              className="neu-sm rounded-lg border border-[var(--neu-edge)] px-2.5 py-1"
            >
              <option value={0}>any length</option>
              <option value={8}>8 words</option>
              <option value={12}>12 words</option>
              <option value={20}>20 words</option>
            </select>
          </label>
          {r.hidden.smallMatches > 0 && (
            <span className="text-ink-faint">
              {r.hidden.smallMatches} small match
              {r.hidden.smallMatches === 1 ? "" : "es"} hidden
            </span>
          )}
          {[...excluded].map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full bg-desk-deep py-0.5 pr-1 pl-2.5"
            >
              Excluded:{" "}
              <span className="max-w-48 truncate">
                {byId.get(id)?.title ?? id}
              </span>
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-rule"
                aria-label={`Include ${byId.get(id)?.title ?? "source"} again`}
                onClick={() => onInclude(id)}
              >
                <XIcon size={14} />
              </button>
            </span>
          ))}
          <span className="text-ink-faint">
            {[
              report.excluded.quotes ? "Quotations" : "",
              report.excluded.references ? "reference list" : "",
              report.excluded.authorBlockWords
                ? "author names and affiliations"
                : "",
            ]
              .filter(Boolean)
              .join(", ")
              .replace(/^./, (c) => c.toUpperCase())}
            {report.excluded.quotes ||
            report.excluded.references ||
            report.excluded.authorBlockWords
              ? " left out of the score."
              : ""}
          </span>
        </div>
      </div>
    </section>
  );
}
