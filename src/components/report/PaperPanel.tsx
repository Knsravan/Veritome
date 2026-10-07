"use client";

import { useMemo, useState } from "react";
import { aiBreakdown } from "@/core/detector/breakdown";
import { ISSUE_TEXT, reviewReport, type IssueKind } from "@/core/plagiarism/review";
import type { PaperReport } from "@/core/report/report";
import { focusMark } from "../AnnotatedText";
import type { TextMark } from "../AnnotatedText";
import { useDocModel } from "../DocumentContext";
import { DocumentView, LayoutToggle } from "../DocumentView";
import { ArrowLeftIcon, ArrowRightIcon, XIcon } from "../icons";
import { sourceColours } from "../PlagiarismResultView";
import { Sheet, cx } from "../ui";

export type Category = "flags" | "copied" | "reworded" | "ai" | "citations" | "grammar";

/** What each kind of underline means. The swatch uses the same class as the marks, so it shows the same line. */
const CATEGORY: Record<Category, { label: string; line: string; sample: string; tab: string }> = {
  flags: { label: "Hidden copying", line: "Double red", sample: "mark-flag", tab: "similarity" },
  copied: { label: "Copied word for word", line: "Solid, in the source’s colour", sample: "mark-match", tab: "similarity" },
  reworded: { label: "Reworded from a source", line: "Dotted, in the source’s colour", sample: "mark-para", tab: "similarity" },
  ai: { label: "Reads as AI-written", line: "Wavy violet", sample: "mark-ai", tab: "ai" },
  citations: { label: "Citation needed", line: "Dashed teal", sample: "mark-cite", tab: "citations" },
  grammar: { label: "Grammar and spelling", line: "Thin coral", sample: "mark-grammar", tab: "grammar" },
};
const ORDER: Category[] = ["flags", "copied", "reworded", "ai", "citations", "grammar"];

export interface Finding {
  id: string;
  category: Category;
  start: number;
  end: number;
  className: string;
  group?: number;
  title: string;
  why: string;
  fix: string;
  note?: string;
  /** The source's wording or the closest source sentence. */
  compare?: { label: string; text: string };
  suggestions?: string[];
}

const KIND_CATEGORY: Record<IssueKind, Category> = {
  disguised: "flags",
  tortured: "flags",
  copied_uncited: "copied",
  copied_cited: "copied",
  own_work: "copied",
  translated: "reworded",
  repeated: "copied",
  reworded_uncited: "reworded",
  reworded_cited: "reworded",
  quote_uncited: "citations",
};

/** Every finding from every check, with offsets into the checked text. */
export function collectFindings(report: PaperReport, text: string): Finding[] {
  const out: Finding[] = [];
  if (report.plagiarism.status === "done") {
    const p = report.plagiarism.result;
    const r = reviewReport(p);
    const colour = sourceColours(r.primary);
    const byId = new Map(p.sources.map((s) => [s.id, s]));
    for (const i of r.issues) {
      const t = ISSUE_TEXT[i.kind];
      const cat = KIND_CATEGORY[i.kind];
      const span = r.spans.find((s) => s.start === i.start);
      const para = r.paraphrases.find((x) => x.start === i.start);
      const src = i.sourceId ? byId.get(i.sourceId) : undefined;
      const f: Finding = {
        id: `p-${i.kind}-${i.start}`,
        category: cat,
        start: i.start,
        end: i.end,
        className: cat === "flags" ? "mark-flag" : cat === "reworded" ? "mark-para" : cat === "citations" ? "mark-cite" : "mark-match",
        title: t.title,
        why: t.why,
        fix: t.fix,
      };
      if (i.sourceId && colour.has(i.sourceId)) f.group = colour.get(i.sourceId)!;
      const note = [i.note, src && src.kind !== "self" ? `Source: ${src.title}${src.year ? ` (${src.year})` : ""}` : "", i.citation ? `Citation found nearby: ${i.citation}` : ""].filter(Boolean).join(" · ");
      if (note) f.note = note;
      if (span?.sourceExcerpt) f.compare = { label: "The source says", text: span.sourceExcerpt.text };
      else if (para) f.compare = { label: "Closest source sentence", text: para.sourceText };
      else if (i.kind === "translated") {
        const tr = p.translated?.find((x) => x.start === i.start);
        if (tr) f.compare = { label: "The English source says", text: tr.sourceText };
      }
      out.push(f);
    }
  }
  if (report.detector.status === "done") {
    const b = aiBreakdown(report.detector.result, text);
    b.regions
      .filter((x) => x.kind === "ai")
      .forEach((x) =>
        out.push({
          id: `ai-${x.start}`,
          category: "ai",
          start: x.start,
          end: x.end,
          className: "mark-ai",
          title: "Reads as AI-written",
          why: `The trained model rates this part as likely machine-written (score ${Math.round(x.probability * 100)} out of 100). This is a signal to review, not proof of who wrote it.`,
          fix: "If you used an AI tool, rewrite this in your own words and disclose the use where your journal or university asks. If you wrote it, add specific detail and vary sentence length.",
        }),
      );
  }
  if (report.citations.status === "done") {
    const c = report.citations.result;
    for (const cl of c.claims)
      out.push({
        id: `c-claim-${cl.start}`,
        category: "citations",
        start: cl.start,
        end: cl.end,
        className: "mark-cite",
        title: "This claim may need a citation",
        why: cl.reasons.length ? `It ${cl.reasons.join("; ")}.` : "It states something that readers will want a source for.",
        fix: "Add a citation to the work that supports this, or soften the claim. The Citations tab suggests papers.",
      });
    for (const m of c.crossCheck.citedButMissing)
      out.push({
        id: `c-miss-${m.citation.start}`,
        category: "citations",
        start: m.citation.start,
        end: m.citation.end,
        className: "mark-cite",
        title: "Citation with no entry in the reference list",
        why: m.reason,
        fix: "Add the missing entry to your reference list, or correct the citation.",
      });
  }
  if (report.grammar.status === "done") {
    for (const g of report.grammar.result.issues)
      out.push({
        id: `g-${g.id}`,
        category: "grammar",
        start: g.start,
        end: g.end,
        className: cx("mark-grammar", g.severity === "info" && "is-info"),
        title: g.message,
        why: `${g.category[0]!.toUpperCase()}${g.category.slice(1)}${g.severity === "error" ? ", likely an error" : g.severity === "warning" ? ", worth fixing" : ", a style note"}.`,
        fix: g.suggestions.length ? "Replace it with one of the suggestions below." : "Reword this part.",
        ...(g.suggestions.length ? { suggestions: g.suggestions.slice(0, 4) } : {}),
      });
  }
  // Small marks first, so a click on a word picks the grammar note over the paragraph around it.
  const rank: Record<Category, number> = { grammar: 0, flags: 1, copied: 2, reworded: 3, citations: 4, ai: 5 };
  return out.filter((f) => f.end > f.start && f.start >= 0 && f.end <= text.length).sort((a, b) => rank[a.category] - rank[b.category] || a.start - b.start);
}

/**
 * The paper itself, with every finding from every check underlined in its own colour and line style. Select an
 * underline, or step through them in reading order, to see what is wrong and how to fix it.
 */
export function PaperPanel({ report, text, onOpen }: { report: PaperReport; text: string; onOpen: (tab: string) => void }) {
  const doc = useDocModel(text);
  const all = useMemo(() => collectFindings(report, text), [report, text]);
  const [hidden, setHidden] = useState<Set<Category>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [layout, setLayout] = useState<"original" | "plain">("original");
  const shown = all.filter((f) => !hidden.has(f.category));
  const inOrder = [...shown].sort((a, b) => a.start - b.start || a.end - b.end);
  const marks: TextMark[] = shown.map((f) => ({ id: f.id, start: f.start, end: f.end, className: f.className, label: f.title, ...(f.group ? { group: f.group } : {}) }));
  const selected = all.find((f) => f.id === active) ?? null;
  const counts = Object.fromEntries(ORDER.map((c) => [c, all.filter((f) => f.category === c).length])) as Record<Category, number>;
  const idx = selected ? inOrder.findIndex((f) => f.id === selected.id) : -1;
  const go = (d: number) => {
    if (!inOrder.length) return;
    const next = inOrder[(idx + d + inOrder.length) % inOrder.length]!;
    setActive(next.id);
    requestAnimationFrame(() => focusMark(next.id));
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_25rem]">
      <div className="min-w-0">
        <Sheet label="Your paper with every finding underlined">
          {doc && <LayoutToggle value={layout} onChange={setLayout} kind={doc.kind} />}
          <DocumentView doc={doc} layout={layout} text={text} marks={marks} activeId={active} onSelect={setActive} />
        </Sheet>
      </div>
      <div className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto">
        <section aria-labelledby="legend-h" className="card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h3 id="legend-h" className="font-semibold">
              {all.length} finding{all.length === 1 ? "" : "s"} in your paper
            </h3>
            <span className="text-xs text-ink-faint">Tap a type to hide it</span>
          </div>
          <ul className="mt-3 space-y-1">
            {ORDER.filter((c) => counts[c] > 0).map((c) => {
              const off = hidden.has(c);
              return (
                <li key={c}>
                  <button
                    type="button"
                    aria-pressed={!off}
                    onClick={() =>
                      setHidden((h) => {
                        const n = new Set(h);
                        if (n.has(c)) n.delete(c);
                        else n.add(c);
                        return n;
                      })
                    }
                    className={cx("flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-[opacity,background-color] hover:bg-desk", off && "opacity-45")}
                  >
                    <span aria-hidden className={cx("mark w-12 shrink-0 text-center font-serif text-ink-faint", CATEGORY[c].sample)} data-src={c === "copied" || c === "reworded" ? 1 : undefined}>
                      text
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{CATEGORY[c].label}</span>
                      <span className="block text-xs text-ink-faint">{CATEGORY[c].line}</span>
                    </span>
                    <span className="rounded-full bg-desk-deep px-2 py-px text-xs font-semibold tabular-nums">{counts[c]}</span>
                  </button>
                </li>
              );
            })}
            {all.length === 0 && <li className="text-sm text-ink-soft">Nothing was flagged by the checks that ran.</li>}
          </ul>
          {inOrder.length > 0 && (
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-rule pt-3">
              <button type="button" onClick={() => go(-1)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-semibold text-action hover:bg-action-soft">
                <ArrowLeftIcon size={16} /> Previous
              </button>
              <span className="text-sm text-ink-faint tabular-nums" aria-live="polite">
                {idx >= 0 ? `${idx + 1} of ${inOrder.length}` : `${inOrder.length} shown`}
              </span>
              <button type="button" onClick={() => go(1)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-semibold text-action hover:bg-action-soft">
                Next <ArrowRightIcon size={16} />
              </button>
            </div>
          )}
        </section>

        {selected ? (
          <section key={selected.id} aria-live="polite" aria-label="Selected finding" className="card animate-fade-up overflow-hidden">
            <div className="flex items-start justify-between gap-2 border-b border-rule px-4 py-3">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">
                  <span aria-hidden className={cx("mark inline-block w-8", CATEGORY[selected.category].sample)} data-src={selected.group}>
                    &nbsp;&nbsp;&nbsp;
                  </span>
                  {CATEGORY[selected.category].label}
                </p>
                <p className="mt-1 font-semibold">{selected.title}</p>
              </div>
              <button type="button" onClick={() => setActive(null)} className="rounded p-0.5 hover:bg-desk" aria-label="Close finding">
                <XIcon size={16} />
              </button>
            </div>
            <div className="space-y-3 px-4 py-3 text-sm">
              <blockquote className="rounded-md border border-rule bg-desk/50 px-3 py-2 font-serif text-[0.95rem]">
                <span className={cx("mark", selected.className)} data-src={selected.group}>
                  {text.slice(selected.start, selected.end).replace(/\s+/g, " ").slice(0, 400)}
                  {selected.end - selected.start > 400 ? "…" : ""}
                </span>
              </blockquote>
              {selected.note && <p className="font-semibold">{selected.note}</p>}
              <p className="text-ink-soft">{selected.why}</p>
              <p>
                <span className="font-semibold">How to fix: </span>
                {selected.fix}
              </p>
              {selected.suggestions && (
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold">Suggestions:</span>
                  {selected.suggestions.map((s) => (
                    <span key={s} className="rounded-md bg-ok-soft px-2 py-0.5 font-semibold text-ok">
                      {s === "" ? "(delete)" : s}
                    </span>
                  ))}
                </p>
              )}
              {selected.compare && (
                <div className="rounded-md border border-rule bg-desk/50 px-3 py-2">
                  <p className="text-xs font-semibold tracking-wide text-ink-faint uppercase">{selected.compare.label}</p>
                  <p className="mt-1 font-serif text-[0.95rem]">{selected.compare.text}</p>
                </div>
              )}
              <button type="button" onClick={() => onOpen(CATEGORY[selected.category].tab)} className="font-semibold text-action hover:underline">
                Full details in the {CATEGORY[selected.category].tab === "ai" ? "AI patterns" : CATEGORY[selected.category].tab[0]!.toUpperCase() + CATEGORY[selected.category].tab.slice(1)} tab
              </button>
            </div>
          </section>
        ) : (
          all.length > 0 && (
            <p className="card px-4 py-3 text-sm text-ink-soft">
              Select any underline in your paper, or press <span className="font-semibold">Next</span>, to see what is wrong and how to fix it.
            </p>
          )
        )}
      </div>
    </div>
  );
}
