"use client";

import { useMemo, useState } from "react";
import { aiBreakdown, type AiBreakdown } from "@/core/detector/breakdown";
import type { DetectorResult } from "@/core/detector/types";
import { ISSUE_TEXT, reviewReport, type Issue, type IssueKind } from "@/core/plagiarism/review";
import type { MatchedSource, PlagiarismReport, SourceExcerpt } from "@/core/plagiarism/types";
import { AnnotatedText, focusMark, focusNote, type TextMark } from "./AnnotatedText";
import { AlertIcon, CheckIcon, InfoIcon, XIcon } from "./icons";
import { Limits, ProofLayout, Sheet, Warnings, cx } from "./ui";

const VERDICT = { low: "Low similarity", moderate: "Some similarity to review", high: "High similarity" } as const;

const KIND_STYLE: Record<IssueKind, { bar: string; chip: string; dot: string }> = {
  copied_uncited: { bar: "bg-danger", chip: "bg-danger-soft text-danger", dot: "bg-danger" },
  copied_cited: { bar: "bg-warn", chip: "bg-warn-soft text-warn", dot: "bg-warn" },
  reworded_uncited: { bar: "bg-ai", chip: "bg-ai-soft text-ai", dot: "bg-ai" },
  quote_uncited: { bar: "bg-cite", chip: "bg-cite-soft text-cite", dot: "bg-cite" },
  reworded_cited: { bar: "bg-ink-faint", chip: "bg-desk-deep text-ink-soft", dot: "bg-ink-faint" },
  repeated: { bar: "bg-ink-soft", chip: "bg-desk-deep text-ink-soft", dot: "bg-ink-soft" },
};

const BREAKDOWN_ORDER: IssueKind[] = ["copied_uncited", "copied_cited", "reworded_uncited", "repeated"];
const SHORT_LABEL: Record<IssueKind, string> = {
  copied_uncited: "Copied, not cited",
  copied_cited: "Cited, missing quotation marks",
  reworded_uncited: "Reworded, not cited",
  quote_uncited: "Quotation without citation",
  reworded_cited: "Reworded, cited",
  repeated: "Repeated in your text",
};

/** Numbers credited sources 1 to 6 so each gets its own highlight colour; later ones share colours. */
export function sourceColours(sources: readonly MatchedSource[]): Map<string, number> {
  return new Map(sources.map((s, i) => [s.id, (i % 6) + 1]));
}

const words = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 3));

/** Text with the words it shares with `other` in bold, for comparing a reworded sentence with its source. */
function SharedWords({ text, other }: { text: string; other: string }) {
  const shared = words(other);
  return (
    <>
      {text.split(/(\s+)/).map((part, i) => {
        const w = part.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
        return shared.has(w) ? (
          <strong key={i} className="font-semibold text-ink underline decoration-match-line decoration-2 underline-offset-2">
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
      <mark className="mark mark-match rounded-sm">{ex.text.slice(ex.matchStart, ex.matchEnd)}</mark>
      {ex.text.slice(ex.matchEnd)}
    </>
  );
}

function SourceLink({ s }: { s: MatchedSource | undefined }) {
  if (!s) return <span>an unknown source</span>;
  const label = `${s.title}${s.year ? ` (${s.year})` : ""}`;
  return s.url ? (
    <a href={s.url} target="_blank" rel="noreferrer" className="font-semibold text-action underline-offset-4 hover:underline">
      {label}
    </a>
  ) : (
    <span className="font-semibold">{label}</span>
  );
}

/** The detail card for one finding: what is wrong, how to fix it, and the two texts side by side. */
function FindingDetail({
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
    <section aria-live="polite" aria-label="Selected finding" className="card overflow-hidden">
      <div className={cx("flex items-start justify-between gap-2 px-4 py-3", KIND_STYLE[issue.kind].chip)}>
        <p className="flex items-center gap-2 font-semibold">
          {t.serious ? <AlertIcon size={16} strokeWidth={2.2} /> : <InfoIcon size={16} strokeWidth={2.2} />}
          {t.title}
        </p>
        <button type="button" onClick={onClose} className="rounded p-0.5 hover:bg-page/60" aria-label="Close finding">
          <XIcon size={16} />
        </button>
      </div>
      <div className="space-y-3 px-4 py-3 text-sm">
        <p className="text-ink-soft">{t.why}</p>
        <p>
          <span className="font-semibold">How to fix: </span>
          {t.fix}
        </p>
        {issue.citation && <p className="text-ink-soft">Citation found nearby: {issue.citation}</p>}
        <div className="grid gap-2">
          <div className="rounded-md border border-rule bg-desk/50 px-3 py-2">
            <p className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Your text</p>
            <p className="mt-1 font-serif text-[0.95rem]">
              {sourceSentence ? <SharedWords text={issue.text} other={sourceSentence} /> : <mark className="mark mark-match rounded-sm">{issue.text}</mark>}
            </p>
          </div>
          {(excerpt || sourceSentence) && (
            <div className="rounded-md border border-rule bg-desk/50 px-3 py-2">
              <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">
                {number !== undefined && (
                  <span className="src-badge" data-src={((number - 1) % 6) + 1}>
                    {number}
                  </span>
                )}
                Source
              </p>
              <p className="mt-1 font-serif text-[0.95rem]">{excerpt ? <Excerpt ex={excerpt} /> : <SharedWords text={sourceSentence ?? ""} other={issue.text} />}</p>
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
              <button type="button" onClick={() => onExclude(source.id)} className="text-sm font-semibold text-action hover:underline print:hidden">
                Exclude this source
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

const AI_LABEL = { ai: "Likely AI-written", uncertain: "Unclear", human: "Likely human-written" } as const;
const AI_STYLE = { ai: "bg-ai", uncertain: "bg-ink-faint/50", human: "bg-ok" } as const;

/** The AI-writing score: what share of the text reads as machine-written, with how far to trust it. */
function AiSummary({ ai, b }: { ai: DetectorResult; b: AiBreakdown }) {
  return (
    <section aria-label="AI writing summary" className="card grid gap-6 p-5 sm:p-6 lg:grid-cols-[auto_1fr]">
      <div className="lg:min-w-48 lg:border-r lg:border-rule lg:pr-8">
        <p className="text-sm font-semibold text-ink-soft">AI writing</p>
        {b.judged ? (
          <>
            <p className="font-serif text-6xl font-semibold tracking-tight tabular-nums">
              {b.aiPercent}
              <span className="text-3xl text-ink-faint">%</span>
            </p>
            <p className="mt-1 font-semibold">
              {b.aiPercent >= 20 ? "Parts read as AI-written" : b.aiPercent > 0 ? "A little reads as AI-written" : "No AI-written parts found"}
            </p>
            <p className="text-sm text-ink-soft">of the text is in paragraphs that read as likely AI-written.</p>
          </>
        ) : (
          <>
            <p className="mt-1 font-serif text-4xl font-semibold text-ink-faint">–</p>
            <p className="mt-1 text-sm text-ink-soft">Not enough text to judge. AI detection needs about 150 words or more.</p>
          </>
        )}
      </div>
      <div className="space-y-3">
        {b.judged && (
          <div>
            <p className="text-sm font-semibold">How the text reads</p>
            <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-desk-deep" aria-hidden>
              {(["ai", "uncertain", "human"] as const).map((k) => (
                <span key={k} className={AI_STYLE[k]} style={{ width: `${k === "ai" ? b.aiPercent : k === "human" ? b.humanPercent : b.uncertainPercent}%` }} />
              ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {(["ai", "uncertain", "human"] as const).map((k) => (
                <li key={k} className="flex items-center gap-1.5">
                  <span aria-hidden className={cx("size-2.5 rounded-full", AI_STYLE[k])} />
                  {AI_LABEL[k]}: <span className="font-semibold tabular-nums">{k === "ai" ? b.aiPercent : k === "human" ? b.humanPercent : b.uncertainPercent}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="rounded-md bg-desk/60 px-3 py-2 text-sm text-ink-soft">
          <p>
            <span className="font-semibold text-ink">How far to trust this: </span>
            in testing, it wrongly flagged 2 of 764 paragraphs written by people before AI tools existed (0.3%), and caught about half of
            AI-written texts. A high score is a reason to look again, never proof; edited or paraphrased AI text often passes.
          </p>
        </div>
        {ai.warnings.filter((w) => !w.includes("per-section")).length > 0 && (
          <p className="text-sm text-ink-faint">{ai.warnings.filter((w) => !w.includes("per-section")).join(" ")}</p>
        )}
      </div>
    </section>
  );
}

export function PlagiarismResultView({ text, report, ai }: { text: string; report: PlagiarismReport; ai?: DetectorResult | null }) {
  const [minWords, setMinWords] = useState(0);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [view, setView] = useState<"matches" | "ai">("matches");
  const aiB = useMemo(() => (ai ? aiBreakdown(ai, text) : null), [ai, text]);
  const aiRegions = aiB?.regions.filter((x) => x.kind !== "human") ?? [];
  const aiFlagged = aiRegions.filter((x) => x.kind === "ai");
  const r = useMemo(() => reviewReport(report, { minWords, excludeSources: excluded }), [report, minWords, excluded]);
  const byId = useMemo(() => new Map(report.sources.map((s) => [s.id, s])), [report.sources]);
  const colour = sourceColours(r.primary);
  const number = (id: string | undefined) => (id && colour.has(id) ? r.primary.findIndex((s) => s.id === id) + 1 : undefined);

  // One id per finding, shared by its mark in the text and its row in the list.
  const issueId = (i: Issue) => `${i.kind}-${i.start}`;
  const marks: TextMark[] = r.issues
    .filter((i) => i.kind !== "quote_uncited")
    .map((i) => ({
      id: issueId(i),
      start: i.start,
      end: i.end,
      className: i.kind.startsWith("reworded") ? "mark-para" : "mark-match",
      label: `${ISSUE_TEXT[i.kind].title}${i.sourceId ? `, source ${number(i.sourceId) ?? ""}` : ""}`,
      ...(i.sourceId && colour.has(i.sourceId) ? { group: colour.get(i.sourceId)! } : {}),
    }));
  for (const q of r.issues.filter((i) => i.kind === "quote_uncited")) {
    marks.push({ id: issueId(q), start: q.start, end: q.end, className: "mark-cite", label: ISSUE_TEXT.quote_uncited.title });
  }
  const selected = r.issues.find((i) => issueId(i) === active);
  const select = (id: string, from: "text" | "list") => {
    setActive(id);
    if (from === "text") focusNote("finding");
    else focusMark(id);
  };
  const exclude = (id: string) => {
    setExcluded((s) => new Set(s).add(id));
    setActive(null);
  };

  const grouped = (Object.keys(ISSUE_TEXT) as IssueKind[]).map((k) => ({ kind: k, items: r.issues.filter((i) => i.kind === k) })).filter((g) => g.items.length);
  const total = Math.max(1, report.words);
  const serious = r.issues.filter((i) => ISSUE_TEXT[i.kind].serious).length;

  return (
    <div className="space-y-6">
      <section aria-label="Similarity summary" className="card grid gap-6 p-5 sm:p-6 lg:grid-cols-[auto_1fr]">
        <div className="lg:min-w-48 lg:border-r lg:border-rule lg:pr-8">
          <p className="font-serif text-6xl font-semibold tracking-tight tabular-nums">
            {r.similarity}
            <span className="text-3xl text-ink-faint">%</span>
          </p>
          <p className="mt-1 font-semibold">{VERDICT[r.verdict]}</p>
          <p className="text-sm text-ink-soft">
            {r.matchedWords.toLocaleString("en")} of {report.words.toLocaleString("en")} words match a source word for word.
          </p>
        </div>
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold">What the matches are</p>
            <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-desk-deep" aria-hidden>
              {BREAKDOWN_ORDER.map((k) => (
                <span key={k} className={KIND_STYLE[k].bar} style={{ width: `${(r.breakdown[k] / total) * 100}%` }} />
              ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {BREAKDOWN_ORDER.filter((k) => k !== "repeated" || r.breakdown[k] > 0).map((k) => (
                <li key={k} className="flex items-center gap-1.5">
                  <span aria-hidden className={cx("size-2.5 rounded-full", KIND_STYLE[k].dot)} />
                  {SHORT_LABEL[k]}: <span className="font-semibold tabular-nums">{Math.round((r.breakdown[k] / total) * 1000) / 10}%</span>
                </li>
              ))}
              {r.breakdown.quote_uncited > 0 && (
                <li className="flex items-center gap-1.5">
                  <span aria-hidden className={cx("size-2.5 rounded-full", KIND_STYLE.quote_uncited.dot)} />
                  Quotations without citation: <span className="font-semibold tabular-nums">{r.breakdown.quote_uncited}</span>
                </li>
              )}
            </ul>
            <p className="mt-2 text-sm text-ink-soft">
              {serious === 0 && r.issues.length === 0
                ? "No problems found in the sources searched."
                : serious === 0
                  ? "Nothing serious: only notes worth a quick look."
                  : `${serious} passage${serious === 1 ? "" : "s"} need${serious === 1 ? "s" : ""} fixing before you submit. Reworded sentences are not counted in the percentage.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-rule pt-3 text-sm print:hidden">
            <label className="flex items-center gap-2">
              Hide matches under
              <select value={minWords} onChange={(e) => setMinWords(Number(e.target.value))} className="rounded-md border border-rule bg-page px-2 py-1">
                <option value={0}>any length</option>
                <option value={8}>8 words</option>
                <option value={12}>12 words</option>
                <option value={20}>20 words</option>
              </select>
            </label>
            {r.hidden.smallMatches > 0 && <span className="text-ink-faint">{r.hidden.smallMatches} small match{r.hidden.smallMatches === 1 ? "" : "es"} hidden</span>}
            {[...excluded].map((id) => (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-desk-deep py-0.5 pr-1 pl-2.5">
                Excluded: <span className="max-w-48 truncate">{byId.get(id)?.title ?? id}</span>
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-rule"
                  aria-label={`Include ${byId.get(id)?.title ?? "source"} again`}
                  onClick={() =>
                    setExcluded((s) => {
                      const n = new Set(s);
                      n.delete(id);
                      return n;
                    })
                  }
                >
                  <XIcon size={14} />
                </button>
              </span>
            ))}
            <span className="text-ink-faint">
              {[report.excluded.quotes ? "Quotations" : "", report.excluded.references ? "reference list" : ""].filter(Boolean).join(" and ")}
              {report.excluded.quotes || report.excluded.references ? " left out of the score." : ""}
            </span>
          </div>
        </div>
      </section>

      {ai && aiB && <AiSummary ai={ai} b={aiB} />}

      <ProofLayout
        sheet={
          <Sheet label="Your text with matched passages">
            {aiB?.judged && (
              <div role="radiogroup" aria-label="Highlight in the text" className="mb-4 inline-flex rounded-lg border border-rule p-0.5 text-sm print:hidden">
                {(
                  [
                    ["matches", "Matches with sources"],
                    ["ai", `AI writing (${aiRegions.length})`],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={view === v}
                    onClick={() => {
                      setView(v);
                      setActive(null);
                    }}
                    className={cx("rounded-md px-3 py-1.5 font-semibold", view === v ? "bg-action text-action-ink" : "text-ink-soft hover:bg-desk")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {view === "ai" && aiB ? (
              <>
                <p className="mb-4 text-sm text-ink-faint">
                  <span className="mark mark-ai px-1">Wavy underline</span>: likely AI-written. <span className="mark mark-ai-medium px-1">Dotted</span>: unclear.
                  Each paragraph is judged on its own; short paragraphs are grouped until there are at least 150 words to judge.
                </p>
                <AnnotatedText
                  text={text}
                  marks={aiRegions.map((x, i) => ({
                    id: `ai${i}`,
                    start: x.start,
                    end: x.end,
                    className: x.kind === "ai" ? "mark-ai" : "mark-ai-medium",
                    label: x.kind === "ai" ? "Likely AI-written" : "Unclear whether AI-written",
                  }))}
                />
              </>
            ) : marks.length === 0 ? (
              <p className="text-ink-soft">No matched passages in the sources that were searched. Read the limits beside this before relying on it.</p>
            ) : (
              <>
                <p className="mb-4 text-sm text-ink-faint">
                  <span className="mark mark-match px-1" data-src="1">
                    Highlighted
                  </span>
                  : word for word. <span className="mark mark-para px-1">Dotted</span>: reworded. Colours match the numbered sources. Select a passage to
                  compare it with its source.
                </p>
                <AnnotatedText text={text} marks={marks} activeId={active} onSelect={(id) => select(id, "text")} />
              </>
            )}
            {report.searched.length > 0 && (
              <p className="mt-6 border-t border-rule pt-3 text-sm text-ink-faint">
                {report.searched.length} passage{report.searched.length === 1 ? "" : "s"}, spread across the whole text, were searched online; every source found was
                then compared with all of your text.
              </p>
            )}
          </Sheet>
        }
        margin={
          <>
            <div id="note-finding" tabIndex={-1} className="focus-visible:outline-none">
              {selected && (
                <FindingDetail
                  issue={selected}
                  source={selected.sourceId ? byId.get(selected.sourceId) : undefined}
                  number={number(selected.sourceId)}
                  excerpt={r.spans.find((s) => s.start === selected.start)?.sourceExcerpt}
                  sourceSentence={r.paraphrases.find((p) => p.start === selected.start)?.sourceText}
                  onExclude={exclude}
                  onClose={() => setActive(null)}
                />
              )}
            </div>

            <section aria-labelledby="mistakes-h">
              <h3 id="mistakes-h" className="font-semibold">
                What to fix ({r.issues.length + aiFlagged.length})
              </h3>
              {aiFlagged.length > 0 && (
                <details open className="card mt-2 overflow-hidden">
                  <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm font-semibold">
                    <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-ai" />
                    <span className="flex-1">Reads as AI-written</span>
                    <span className="rounded-full bg-ai-soft px-2 text-xs text-ai tabular-nums">{aiFlagged.length}</span>
                  </summary>
                  <p className="border-t border-rule px-3 py-2 text-sm text-ink-soft">
                    Rewrite these parts in your own words and voice. If you used an AI tool, say so in the way your journal or university asks. This is a
                    pattern match, not proof, so ignore it if you wrote the text yourself.
                  </p>
                  <ol className="divide-y divide-rule border-t border-rule">
                    {aiFlagged.map((x, i) => (
                      <li key={x.start}>
                        <button
                          type="button"
                          onClick={() => {
                            setView("ai");
                            requestAnimationFrame(() => focusMark(`ai${aiRegions.indexOf(x)}`));
                          }}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-desk/60"
                        >
                          <span className="line-clamp-2 font-serif">“{text.slice(x.start, x.end).replace(/\s+/g, " ")}”</span>
                          <span className="text-xs text-ink-faint">
                            Part {i + 1} · about {text.slice(x.start, x.end).split(/\s+/).length} words
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {r.issues.length === 0 ? (
                <p className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
                  <CheckIcon size={16} className="text-ok" strokeWidth={2.4} /> No copied or reworded passages in the sources searched.
                </p>
              ) : (
                <div className="mt-2 space-y-3">
                  {grouped.map((g) => (
                    <details key={g.kind} open={ISSUE_TEXT[g.kind].serious || grouped.length <= 2} className="card overflow-hidden">
                      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm font-semibold">
                        <span aria-hidden className={cx("size-2.5 shrink-0 rounded-full", KIND_STYLE[g.kind].dot)} />
                        <span className="flex-1">{ISSUE_TEXT[g.kind].title}</span>
                        <span className={cx("rounded-full px-2 text-xs tabular-nums", KIND_STYLE[g.kind].chip)}>{g.items.length}</span>
                      </summary>
                      <p className="border-t border-rule px-3 py-2 text-sm text-ink-soft">{ISSUE_TEXT[g.kind].fix}</p>
                      <ol className="divide-y divide-rule border-t border-rule">
                        {g.items.map((i) => {
                          const n = number(i.sourceId);
                          return (
                            <li key={issueId(i)}>
                              <button
                                type="button"
                                aria-current={active === issueId(i) ? "true" : undefined}
                                onClick={() => select(issueId(i), "list")}
                                className={cx("flex w-full gap-2.5 px-3 py-2 text-left text-sm hover:bg-desk/60", active === issueId(i) && "bg-action-soft/60")}
                              >
                                {n !== undefined ? (
                                  <span className="src-badge mt-0.5 shrink-0" data-src={((n - 1) % 6) + 1} aria-label={`Source ${n}`}>
                                    {n}
                                  </span>
                                ) : (
                                  <span className="src-badge mt-0.5 shrink-0" aria-hidden>
                                    “
                                  </span>
                                )}
                                <span className="min-w-0">
                                  <span className="line-clamp-2 font-serif">“{i.text}”</span>
                                  <span className="text-xs text-ink-faint">{i.words} words</span>
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ol>
                    </details>
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="src-h">
              <h3 id="src-h" className="font-semibold">
                Sources ({r.primary.length})
              </h3>
              {r.primary.length === 0 ? (
                <p className="mt-1 text-sm text-ink-soft">None of the searched sources shared a run of words with your text.</p>
              ) : (
                <ol className="mt-2 space-y-2">
                  {r.primary.map((s, n) => (
                    <li key={s.id} className="card print-avoid px-3 py-2.5 text-sm" data-src={colour.get(s.id)}>
                      <div className="flex items-start gap-3">
                        <span className="src-badge mt-0.5 shrink-0" aria-label={`Source ${n + 1}`}>
                          {n + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <SourceLink s={s} />
                            <span className="shrink-0 font-semibold tabular-nums">{s.primaryPercent}%</span>
                          </div>
                          <div aria-hidden className="mt-1 h-1.5 rounded-full bg-desk-deep">
                            <div className="h-full rounded-full bg-[var(--src-line,var(--mark-match-line))]" style={{ width: `${Math.min(100, Math.max(2, s.primaryPercent * 2))}%` }} />
                          </div>
                          <p className="mt-1 text-ink-faint">
                            {[s.authors, s.provider].filter(Boolean).join(" · ")}
                            {s.primaryWords ? ` · ${s.primaryWords} words` : " · reworded only"}
                            {s.alsoAt.length ? ` · also found via ${s.alsoAt.join(", ")}` : ""}
                          </p>
                          <div className="mt-1 flex gap-4 print:hidden">
                            <button
                              type="button"
                              className="text-action underline-offset-4 hover:underline"
                              onClick={() => {
                                const i = r.issues.find((x) => x.sourceId === s.id);
                                if (i) select(issueId(i), "list");
                              }}
                            >
                              Show in text
                            </button>
                            {s.kind !== "self" && (
                              <button type="button" className="text-ink-soft underline-offset-4 hover:underline" onClick={() => exclude(s.id)}>
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
                  <button type="button" onClick={() => setShowOthers((x) => !x)} aria-expanded={showOthers} className="font-semibold text-action hover:underline">
                    {showOthers ? "Hide" : "Show"} {r.others.length} other place{r.others.length === 1 ? "" : "s"} with the same wording
                  </button>
                  <p className="text-ink-faint">These contain the same passages but are not the best match, often because they quote the original.</p>
                  {showOthers && (
                    <ul className="mt-2 space-y-1.5">
                      {r.others.map((s) => (
                        <li key={s.id} className="flex items-baseline justify-between gap-3 border-l-2 border-rule pl-3">
                          <span className="min-w-0">
                            <SourceLink s={s} /> <span className="text-ink-faint">· {s.provider}</span>
                          </span>
                          <span className="shrink-0 tabular-nums text-ink-faint">{s.matchedWords} words</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>

            <Warnings items={report.warnings} />

            <details className="card px-3 py-2 text-sm">
              <summary className="cursor-pointer font-semibold">What was searched</summary>
              <table className="mt-2 w-full text-left">
                <thead>
                  <tr className="text-ink-faint">
                    <th className="py-1 font-normal">Source</th>
                    <th className="py-1 font-normal">Searches</th>
                    <th className="py-1 font-normal">Found</th>
                  </tr>
                </thead>
                <tbody>
                  {report.providers.map((p) => (
                    <tr key={p.name} className="border-t border-rule align-top">
                      <td className="py-1 pr-2">
                        {p.name}
                        <span className="block text-ink-faint">{p.coverage}</span>
                      </td>
                      <td className={cx("py-1 tabular-nums", p.failures > 0 && "text-danger")}>
                        {p.kind === "library" || p.kind === "self" ? "–" : p.failures ? `${p.queries - p.failures} of ${p.queries}` : p.queries}
                      </td>
                      <td className="py-1 tabular-nums">{p.documents}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>

            <Limits>
              <p>{report.disclaimer}</p>
              <p>
                Word-for-word runs of six or more words are counted. Reworded sentences are found when a source sentence shares most of their ideas; heavier
                rewriting and translated text can still slip through. Whether a match is cited is judged from citations in the same sentence.
              </p>
            </Limits>
          </>
        }
      />
    </div>
  );
}
