"use client";

import { useState } from "react";
import type { GrammarCheckResult } from "@/core/grammar/check";
import type { IssueCategory, Severity } from "@/core/grammar/types";
import { CATEGORY_LABEL, SEVERITY_LABEL } from "@/lib/grammar-labels";
import { AnnotatedText, focusMark, focusNote, type TextMark } from "../AnnotatedText";
import { Limits, ProofLayout, Sheet, Warnings, cx } from "../ui";

const SEVERITY_ORDER: Severity[] = ["error", "warning", "info"];
const SEVERITY_DOT: Record<Severity, string> = { error: "bg-danger", warning: "bg-warn", info: "bg-ink-faint" };

function Metric({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-rule py-2 first:border-t-0">
      <dt>
        {label}
        <span className="block text-xs text-ink-faint">{help}</span>
      </dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** The grammar section of the report: the text with every issue marked, a breakdown and readability measures. */
export function GrammarDetail({ text, result }: { text: string; result: GrammarCheckResult }) {
  const [active, setActive] = useState<string | null>(null);
  const [filter, setFilter] = useState<Severity | "all">("all");
  const { summary, metrics } = result;
  const visible = result.issues.filter((i) => filter === "all" || i.severity === filter);
  const marks: TextMark[] = visible.map((i) => ({
    id: i.id,
    start: i.start,
    end: i.end,
    className: cx("mark-grammar", i.severity === "info" && "is-info"),
    label: `${CATEGORY_LABEL[i.category]}: ${i.message}`,
  }));
  const categories = (Object.entries(summary.byCategory) as Array<[IssueCategory, number]>).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...categories.map(([, n]) => n));

  return (
    <ProofLayout
      sheet={
        <Sheet label="Your text with grammar and style notes">
          {result.issues.length === 0 ? (
            <p className="text-ink-soft">No grammar or style issues found by the checks that ran.</p>
          ) : (
            <>
              <p className="mb-4 text-sm text-ink-faint">
                <span className="mark mark-grammar px-1">Solid underline</span>: likely error or worth a look.{" "}
                <span className="mark mark-grammar is-info px-1">Dashed</span>: suggestion. Select a mark to see the note.
              </p>
              <AnnotatedText
                text={text}
                marks={marks}
                activeId={active}
                onSelect={(id) => {
                  setActive(id);
                  focusNote(id);
                }}
              />
            </>
          )}
        </Sheet>
      }
      margin={
        <>
          <div>
            <p className="font-display text-5xl font-semibold tabular-nums">
              {summary.score}
              <span className="text-2xl text-ink-faint">/100</span>
            </p>
            <p className="mt-1 font-semibold">Writing score</p>
            <p className="text-sm text-ink-soft">
              {summary.total} note{summary.total === 1 ? "" : "s"}: {summary.bySeverity.error} likely error{summary.bySeverity.error === 1 ? "" : "s"},{" "}
              {summary.bySeverity.warning} worth a look, {summary.bySeverity.info} suggestion{summary.bySeverity.info === 1 ? "" : "s"}.{" "}
              {summary.issuesPer1000Words} per 1,000 words.
            </p>
          </div>
          <Warnings items={result.warnings} />

          {categories.length > 0 && (
            <section aria-labelledby="gcat-h" className="print-avoid">
              <h3 id="gcat-h" className="font-semibold">
                By type
              </h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {categories.map(([c, n]) => (
                  <li key={c} className="grid grid-cols-[8.5rem_1fr_2rem] items-center gap-2">
                    <span>{CATEGORY_LABEL[c]}</span>
                    <span aria-hidden className="h-2 rounded-full bg-desk-deep">
                      <span className="block h-full rounded-full bg-grammar" style={{ width: `${(n / maxCat) * 100}%` }} />
                    </span>
                    <span className="text-right tabular-nums">{n}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="gread-h" className="print-avoid">
            <h3 id="gread-h" className="font-semibold">
              Readability
            </h3>
            <dl className="card mt-2 px-3 py-1 text-sm">
              <Metric label="Reading level" value={metrics.level} help="From the Flesch reading-ease score" />
              <Metric label="Flesch reading ease" value={String(Math.round(metrics.fleschReadingEase))} help="Higher is easier; research papers often score 10 to 40" />
              <Metric label="Grade level" value={metrics.fleschKincaidGrade.toFixed(1)} help="Flesch–Kincaid, years of schooling" />
              <Metric label="Average sentence" value={`${metrics.avgSentenceLength.toFixed(1)} words`} help="Over 25 words gets hard to follow" />
              <Metric label="Longest sentence" value={`${metrics.longestSentence} words`} help="Consider splitting anything over 40" />
              <Metric label="Passive sentences" value={`${Math.round(metrics.passiveSentenceRatio * 100)}%`} help="Fine in methods; use sparingly elsewhere" />
              <Metric label="Vocabulary variety" value={`${Math.round(metrics.lexicalDiversity * 100)}%`} help="Share of distinct words" />
            </dl>
          </section>

          {result.issues.length > 0 && (
            <section aria-labelledby="glist-h">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="glist-h" className="font-semibold">
                  All notes ({visible.length})
                </h3>
                <label className="text-sm print:hidden">
                  <span className="sr-only">Show</span>
                  <select value={filter} onChange={(e) => setFilter(e.target.value as Severity | "all")} className="rounded-md border border-rule bg-page px-2 py-1">
                    <option value="all">All notes</option>
                    {SEVERITY_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {SEVERITY_LABEL[s]} ({summary.bySeverity[s]})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <ol className="mt-2 space-y-2">
                {visible.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      id={`note-${i.id}`}
                      aria-current={active === i.id ? "true" : undefined}
                      onClick={() => {
                        setActive(i.id);
                        focusMark(i.id);
                      }}
                      className={cx(
                        "card w-full px-3 py-2 text-left text-sm transition-colors hover:border-ink-faint/60",
                        active === i.id && "border-action ring-2 ring-action/25",
                      )}
                    >
                      <span className="flex items-center gap-2 text-xs font-semibold text-ink-soft uppercase tracking-wide">
                        <span aria-hidden className={cx("size-2 rounded-full", SEVERITY_DOT[i.severity])} />
                        {SEVERITY_LABEL[i.severity]} · {CATEGORY_LABEL[i.category]}
                      </span>
                      <span className="mt-1 block">
                        <span className="font-serif">“{i.text}”</span> {i.message}
                      </span>
                      {i.suggestions[0] !== undefined && (
                        <span className="mt-1 block text-ok">
                          Suggestion: {i.suggestions[0] === "" ? "delete it" : `“${i.suggestions.slice(0, 3).join("”, “")}”`}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-sm text-ink-faint print:hidden">To apply fixes one click at a time, open the Grammar tool.</p>
            </section>
          )}

          <Limits>
            <p>The built-in rules catch common slips, not every grammatical error, and readability formulas are rough guides for technical writing.</p>
          </Limits>
        </>
      }
    />
  );
}
