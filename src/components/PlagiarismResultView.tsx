"use client";

import { useState } from "react";
import type { PlagiarismReport } from "@/core/plagiarism/types";
import { AnnotatedText, focusMark, type TextMark } from "./AnnotatedText";
import { Limits, ProofLayout, Sheet, Warnings, cx } from "./ui";

const VERDICT = { low: "Low overlap", moderate: "Some overlap to review", high: "High overlap" } as const;

export function PlagiarismSummary({ report }: { report: PlagiarismReport }) {
  return (
    <div>
      <p className="font-serif text-5xl font-semibold tabular-nums">{report.similarity}%</p>
      <p className="mt-1 font-semibold">{VERDICT[report.verdict]}</p>
      <p className="text-sm text-ink-soft">
        {report.matchedWords.toLocaleString("en")} of {report.words.toLocaleString("en")} words appear word for word in at least one source.
        {report.excluded.references ? " Reference list excluded." : ""}
        {report.excluded.quotes ? " Quotations excluded." : ""}
      </p>
      {report.paraphrasePercent > 0 && (
        <p className="mt-2 text-sm">
          <span className="font-semibold">Plus {report.paraphrasePercent}% reworded:</span> {report.paraphrases.length} sentence
          {report.paraphrases.length === 1 ? "" : "s"} say the same thing as a source in different words. Not counted in the percentage above.
        </p>
      )}
    </div>
  );
}

/** Numbers sources 1 to 6 in report order so each gets its own highlight colour; later ones share the last colours. */
export function sourceColours(report: PlagiarismReport): Map<string, number> {
  return new Map(report.sources.map((s, i) => [s.id, (i % 6) + 1]));
}

export function PlagiarismResultView({ text, report }: { text: string; report: PlagiarismReport }) {
  const [active, setActive] = useState<number | null>(null);
  const byId = new Map(report.sources.map((s) => [s.id, s]));
  const colour = sourceColours(report);
  const marks: TextMark[] = report.spans.map((s, i) => ({
    id: `m${i}`,
    start: s.start,
    end: s.end,
    className: "mark-match",
    label: `Matches ${byId.get(s.sourceIds[0] ?? "")?.title ?? "a source"}`,
    ...(colour.has(s.sourceIds[0] ?? "") ? { group: colour.get(s.sourceIds[0] ?? "")! } : {}),
  }));
  marks.push(
    ...report.paraphrases.map((pm, i) => ({
      id: `p${i}`,
      start: pm.start,
      end: pm.end,
      className: "mark-para",
      label: `Reworded from ${byId.get(pm.sourceId)?.title ?? "a source"}`,
      ...(colour.has(pm.sourceId) ? { group: colour.get(pm.sourceId)! } : {}),
    })),
  );
  const [activePara, setActivePara] = useState<number | null>(null);
  const activeSpan = active !== null ? report.spans[active] : undefined;
  const para = activePara !== null ? report.paraphrases[activePara] : undefined;

  return (
    <ProofLayout
      sheet={
        <Sheet label="Your text with matched passages">
          {report.spans.length === 0 && report.paraphrases.length === 0 ? (
            <p className="text-ink-soft">No matched passages. Read the limits beside this before relying on it.</p>
          ) : (
            <>
              <p className="mb-4 text-sm text-ink-faint">
                <span className="mark mark-match px-1">Highlighted</span>: word for word. <span className="mark mark-para px-1">Dotted</span>: reworded.
                Colours match the numbered sources.
              </p>
              <AnnotatedText
                text={text}
                marks={marks}
                activeId={active !== null ? `m${active}` : activePara !== null ? `p${activePara}` : null}
                onSelect={(id) => {
                  if (id.startsWith("p")) {
                    setActive(null);
                    setActivePara(Number(id.slice(1)));
                  } else {
                    setActivePara(null);
                    setActive(Number(id.slice(1)));
                  }
                }}
              />
            </>
          )}
        </Sheet>
      }
      margin={
        <>
          <PlagiarismSummary report={report} />
          <Warnings items={report.warnings} />
          {activeSpan && (
            <section aria-live="polite" className="rounded border-l-4 border-match-line bg-page px-3 py-2 text-sm">
              <p className="font-semibold">Selected passage, {activeSpan.words} words</p>
              <p className="mt-1 font-serif">“{activeSpan.text}”</p>
              <p className="mt-2 text-ink-soft">Also found in:</p>
              <ul className="list-disc pl-5">
                {activeSpan.sourceIds.map((id) => {
                  const s = byId.get(id);
                  return <li key={id}>{s?.url ? <a className="text-action underline" href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : (s?.title ?? id)}</li>;
                })}
              </ul>
            </section>
          )}
          {para && (
            <section aria-live="polite" className="rounded border-l-4 border-dotted border-match-line bg-page px-3 py-2 text-sm">
              <p className="font-semibold">Reworded sentence, {Math.round(para.similarity * 100)}% of ideas shared</p>
              <p className="mt-1 font-serif">“{para.text}”</p>
              <p className="mt-2 text-ink-soft">Closest sentence in {byId.get(para.sourceId)?.title ?? "the source"}:</p>
              <p className="mt-1 font-serif">“{para.sourceText}”</p>
              <p className="mt-2 text-ink-faint">Rewording a source without citing it is still plagiarism. Cite it, or make sure the idea is your own.</p>
            </section>
          )}
          <section aria-labelledby="src-h">
            <h2 id="src-h" className="font-semibold">
              Sources ({report.sources.length})
            </h2>
            {report.sources.length === 0 ? (
              <p className="mt-1 text-sm text-ink-soft">None of the searched sources shared a run of words with your text.</p>
            ) : (
              <ol className="mt-2 space-y-2">
                {report.sources.map((s, n) => (
                  <li key={s.id} className="card px-3 py-2.5 text-sm" data-src={colour.get(s.id)}>
                    <div className="flex items-start gap-3">
                      <span className="src-badge mt-0.5 shrink-0" aria-label={`Source ${n + 1}`}>
                        {n + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          {s.url ? (
                            <a href={s.url} target="_blank" rel="noreferrer" className="font-semibold text-action underline-offset-4 hover:underline">
                              {s.title}
                            </a>
                          ) : (
                            <span className="font-semibold">{s.title}</span>
                          )}
                          <span className="shrink-0 tabular-nums">{s.percent}%</span>
                        </div>
                        <div aria-hidden className="mt-1 h-1.5 rounded-full bg-desk-deep">
                          <div className="h-full rounded-full bg-[var(--src-line,var(--mark-match-line))]" style={{ width: `${Math.min(100, Math.max(2, s.percent))}%` }} />
                        </div>
                        <p className="mt-1 text-ink-faint">
                          {[s.authors, s.year, s.provider].filter(Boolean).join(" · ")} · {s.matchedWords} words
                        </p>
                        <button
                          type="button"
                          className="mt-1 text-action underline-offset-4 hover:underline print:hidden"
                          onClick={() => {
                            const i = report.spans.findIndex((sp) => sp.sourceIds.includes(s.id));
                            if (i >= 0) {
                              setActive(i);
                              focusMark(`m${i}`);
                            }
                          }}
                        >
                          Show in text
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <details className="rounded border border-rule bg-page px-3 py-2 text-sm">
            <summary className="cursor-pointer font-semibold">What was searched</summary>
            <table className="mt-2 w-full text-left">
              <thead>
                <tr className="text-ink-faint">
                  <th className="py-1 font-normal">Source</th>
                  <th className="py-1 font-normal">Queries</th>
                  <th className="py-1 font-normal">Failed</th>
                </tr>
              </thead>
              <tbody>
                {report.providers.map((p) => (
                  <tr key={p.name} className="border-t border-rule align-top">
                    <td className="py-1 pr-2">
                      {p.name}
                      <span className="block text-ink-faint">{p.coverage}</span>
                    </td>
                    <td className="py-1 tabular-nums">{p.kind === "library" || p.kind === "self" ? "n/a" : p.queries}</td>
                    <td className={cx("py-1 tabular-nums", p.failures > 0 && "text-danger")}>{p.kind === "library" || p.kind === "self" ? "n/a" : p.failures}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <Limits>
            <p>{report.disclaimer}</p>
            <p>
              Word-for-word runs of six or more words are counted. Reworded sentences are found when a source sentence shares most of their
              ideas, allowing for synonyms and reordering; heavier rewriting and translated text can still slip through.
            </p>
          </Limits>
        </>
      }
    />
  );
}
