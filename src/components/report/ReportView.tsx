"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { buildActionList, documentStats, type ActionItem, type ActionLevel } from "@/core/report/actions";
import type { CitationStyle } from "@/core/citations/types";
import type { OverviewStatus, PaperReport, Section, ToolId } from "@/core/report/report";
import { reportToMarkdown } from "@/lib/report-markdown";
import { CrossCheckView, StylePicker, VerifyView, WorkCitation } from "../CitationViews";
import { DetectorResultView, VERDICT_TEXT } from "../DetectorResultView";
import { AlertIcon, ArrowLeftIcon, CheckIcon, ChevronDownIcon, DownloadIcon, InfoIcon } from "../icons";
import { PlagiarismResultView } from "../PlagiarismResultView";
import { RewriteResultView } from "../RewriteResultView";
import { Button, Notice, cx } from "../ui";
import { CountUp } from "../motion";
import { GrammarDetail } from "./GrammarDetail";
import { collectFindings, PaperPanel } from "./PaperPanel";
import { ImagesPanel } from "./ImagesPanel";
import { useImageReport } from "../DocumentContext";
import { ORDER, STATUS, TONE_BAR, TONE_CLASS, TOOL_LABEL, type Tone } from "./labels";

type TabId = "paper" | "overview" | "images" | "similarity" | "ai" | "citations" | "grammar" | "rewrites";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "paper", label: "Your paper" },
  { id: "overview", label: "What to fix" },
  { id: "similarity", label: "Similarity" },
  { id: "images", label: "Images" },
  { id: "ai", label: "AI patterns" },
  { id: "citations", label: "Citations" },
  { id: "grammar", label: "Grammar" },
  { id: "rewrites", label: "Rewrites" },
];

const TOOL_TAB: Record<ToolId, TabId> = {
  plagiarism: "similarity",
  detector: "ai",
  citations: "citations",
  grammar: "grammar",
  paraphrase: "rewrites",
  humanise: "rewrites",
};

const LEVEL: Record<ActionLevel, { text: string; cls: string; icon: ReactNode }> = {
  high: { text: "Fix", cls: "bg-danger-soft text-danger", icon: <AlertIcon size={14} strokeWidth={2.2} /> },
  medium: { text: "Check", cls: "bg-warn-soft text-warn", icon: <AlertIcon size={14} strokeWidth={2.2} /> },
  low: { text: "Consider", cls: "bg-desk-deep text-ink-soft", icon: <InfoIcon size={14} strokeWidth={2.2} /> },
};

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A short title for the report: the paper's first line when it looks like a title. */
export function guessTitle(text: string): string | null {
  const first = text.trim().split("\n")[0]?.trim() ?? "";
  return first && first.length <= 160 && !/[.!?]$/.test(first) ? first : null;
}

const statusOf = (r: PaperReport, tool: ToolId): OverviewStatus => r.overview.find((o) => o.tool === tool)?.status ?? "skipped";

function SectionBody<T>({ s, children }: { s: Section<T>; children: (r: T) => ReactNode }) {
  if (s.status === "skipped") return <Notice kind="info">This check was not run: {s.reason}</Notice>;
  if (s.status === "error") return <Notice kind="error">This check failed: {s.message}</Notice>;
  return <>{children(s.result)}</>;
}

function StatusPill({ status }: { status: OverviewStatus }) {
  const st = STATUS[status];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", TONE_CLASS[st.tone])}>
      {st.tone === "ok" ? <CheckIcon size={13} strokeWidth={2.6} /> : st.tone === "muted" ? null : <AlertIcon size={13} strokeWidth={2.2} />}
      {st.text}
    </span>
  );
}

interface Score {
  tab: TabId;
  tool: ToolId;
  label: string;
  value: string;
  unit?: string;
  note: string;
  /** 0 to 100 for the meter; undefined hides it. */
  meter?: number;
}

function scores(r: PaperReport): Score[] {
  const out: Score[] = [];
  const p = r.plagiarism;
  out.push(
    p.status === "done"
      ? {
          tab: "similarity",
          tool: "plagiarism",
          label: "Similarity",
          value: `${p.result.similarity}`,
          unit: "%",
          meter: p.result.similarity,
          note: `${p.result.sources.filter((s) => s.kind !== "self" && s.primaryWords > 0).length} matching sources${p.result.paraphrasePercent > 0 ? `, ${p.result.paraphrasePercent}% reworded` : ""}`,
        }
      : { tab: "similarity", tool: "plagiarism", label: "Similarity", value: "–", note: p.status === "skipped" ? "Not run" : "Check failed" },
  );
  const d = r.detector;
  out.push(
    d.status === "done" && d.result.verdict !== "insufficient_text"
      ? { tab: "ai", tool: "detector", label: "AI patterns", value: `${d.result.score}`, unit: "/100", meter: d.result.score, note: VERDICT_TEXT[d.result.verdict] }
      : { tab: "ai", tool: "detector", label: "AI patterns", value: "–", note: d.status === "done" ? "Not enough text" : d.status === "skipped" ? "Not run" : "Check failed" },
  );
  const c = r.citations;
  if (c.status === "done") {
    const v = c.result.verification;
    const total = c.result.references.length;
    out.push(
      v
        ? {
            tab: "citations",
            tool: "citations",
            label: "References found",
            value: `${v.counts.verified + v.counts.likely}`,
            unit: `/${total}`,
            meter: total ? ((v.counts.verified + v.counts.likely) / total) * 100 : 0,
            note: `${v.counts.not_found + v.counts.mismatch} to check by hand${v.counts.flagged ? `, ${v.counts.flagged} flagged` : ""}`,
          }
        : { tab: "citations", tool: "citations", label: "References", value: total ? `${total}` : "–", note: c.result.verificationSkipped ?? "Not checked online" },
    );
  } else {
    out.push({ tab: "citations", tool: "citations", label: "References", value: "–", note: c.status === "skipped" ? "Not run" : "Check failed" });
  }
  const g = r.grammar;
  out.push(
    g.status === "done"
      ? { tab: "grammar", tool: "grammar", label: "Writing score", value: `${g.result.summary.score}`, unit: "/100", meter: g.result.summary.score, note: `${g.result.summary.total} notes, ${g.result.summary.bySeverity.error} likely errors` }
      : { tab: "grammar", tool: "grammar", label: "Writing score", value: "–", note: g.status === "skipped" ? "Not run" : "Check failed" },
  );
  return out;
}

function ScoreCard({ s, status, onOpen }: { s: Score; status: OverviewStatus; onOpen: () => void }) {
  const tone: Tone = STATUS[status].tone;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card card-hover group flex w-full flex-col p-4 text-left sm:p-5"
      aria-label={`${s.label}: ${s.value}${s.unit ?? ""}. ${s.note}. ${STATUS[status].text}. Open details.`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink-soft">{s.label}</span>
        <StatusPill status={status} />
      </span>
      <span className="mt-3 font-display text-4xl font-semibold tracking-tight tabular-nums">
        {Number.isFinite(Number(s.value)) ? <CountUp value={Number(s.value)} decimals={Number.isInteger(Number(s.value)) ? 0 : 1} /> : s.value}
        {s.unit && <span className="ml-0.5 text-lg font-normal text-ink-faint">{s.unit}</span>}
      </span>
      {s.meter !== undefined && (
        <span aria-hidden className="mt-3 block h-1.5 overflow-hidden rounded-full bg-desk-deep">
          <span className={cx("block h-full rounded-full", TONE_BAR[tone])} style={{ width: `${Math.max(2, Math.min(100, s.meter))}%` }} />
        </span>
      )}
      <span className="mt-2 text-sm text-ink-soft">{s.note}</span>
      <span className="mt-auto pt-3 text-sm font-semibold text-action group-hover:underline print:hidden">View details</span>
    </button>
  );
}

function ActionList({ items, onOpen }: { items: ActionItem[]; onOpen: (tab: TabId) => void }) {
  const [all, setAll] = useState(false);
  if (!items.length) {
    return (
      <div className="card flex items-start gap-3 p-5">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok">
          <CheckIcon size={18} strokeWidth={2.4} />
        </span>
        <div>
          <p className="font-semibold">Nothing urgent found</p>
          <p className="text-sm text-ink-soft">The checks that ran found nothing that needs fixing. Skim each tab anyway: every tool can miss things.</p>
        </div>
      </div>
    );
  }
  const shown = all ? items : items.slice(0, 8);
  const counts = { high: 0, medium: 0, low: 0 };
  for (const i of items) counts[i.level]++;
  return (
    <div>
      <p className="text-sm text-ink-soft">
        {counts.high} to fix, {counts.medium} to check, {counts.low} to consider. Most important first.
      </p>
      <ol className="card mt-3 divide-y divide-rule">
        {shown.map((a) => (
          <li key={a.id} className="print-avoid flex gap-3 px-4 py-3.5 sm:px-5">
            <span className={cx("mt-0.5 inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold", LEVEL[a.level].cls)}>
              {LEVEL[a.level].icon}
              {LEVEL[a.level].text}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{a.title}</p>
              {a.quote && <p className="mt-1 border-l-2 border-rule pl-3 font-serif text-[0.95rem] text-ink-soft">“{a.quote}”</p>}
              <p className="mt-1 text-sm text-ink-soft">{a.detail}</p>
            </div>
            <button
              type="button"
              onClick={() => onOpen(TOOL_TAB[a.tool])}
              className="h-fit shrink-0 rounded-md px-2 py-1 text-sm font-semibold whitespace-nowrap text-action hover:bg-action-soft print:hidden"
            >
              View <span className="sr-only">in {TABS.find((t) => t.id === TOOL_TAB[a.tool])?.label}</span>
            </button>
          </li>
        ))}
      </ol>
      {items.length > 8 && (
        <Button variant="quiet" className="mt-2 print:hidden" onClick={() => setAll((x) => !x)}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </Button>
      )}
    </div>
  );
}

function Overview({ report, text, onOpen }: { report: PaperReport; text: string; onOpen: (tab: TabId) => void }) {
  const actions = buildActionList(report);
  const images = useImageReport();
  const stats = documentStats(report, text);
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="todo-h">
        <h3 id="todo-h" className="font-display text-2xl font-semibold">
          What to fix first
        </h3>
        {images && images.findings.length > 0 && (
          <button
            type="button"
            onClick={() => onOpen("images")}
            className="card card-hover mt-3 flex w-full items-start gap-3 border-danger/30 p-4 text-left"
          >
            <span className="mt-0.5 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">Fix</span>
            <span>
              <span className="font-semibold">
                {images.findings.length} problem{images.findings.length === 1 ? "" : "s"} with the pictures
              </span>
              <span className="block text-sm text-ink-soft">A picture used twice, copied from a source, or holding copied text. See the Images tab.</span>
            </span>
          </button>
        )}
        <div className="mt-3">
          <ActionList items={actions} onOpen={onOpen} />
        </div>
      </section>
      <div className="space-y-6">
        <section aria-labelledby="checks-h">
          <h3 id="checks-h" className="font-semibold">
            Checks
          </h3>
          <ul className="card mt-2 divide-y divide-rule text-sm">
            {ORDER.map((id) => {
              const o = report.overview.find((x) => x.tool === id);
              if (!o) return null;
              return (
                <li key={id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" onClick={() => onOpen(TOOL_TAB[id])} className="text-left font-semibold text-action hover:underline">
                      {TOOL_LABEL[id]}
                    </button>
                    <StatusPill status={o.status} />
                  </div>
                  <p className="mt-1 text-ink-soft">{o.headline}</p>
                </li>
              );
            })}
          </ul>
        </section>
        <section aria-labelledby="doc-h">
          <h3 id="doc-h" className="font-semibold">
            About this document
          </h3>
          <dl className="card mt-2 grid grid-cols-2 gap-px overflow-hidden bg-rule text-sm">
            {[
              ["Words", stats.words.toLocaleString("en")],
              ["Sentences", stats.sentences?.toLocaleString("en") ?? "–"],
              ["Paragraphs", stats.paragraphs.toLocaleString("en")],
              ["References", stats.references.toLocaleString("en")],
              ["Reading time", `${stats.readingMinutes} min`],
              ["Reading level", stats.readingLevel ?? "–"],
            ].map(([k, v]) => (
              <div key={k} className="bg-page px-4 py-3">
                <dt className="text-ink-faint">{k}</dt>
                <dd className="mt-0.5 font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}

function CitationsPanel({ report }: { report: PaperReport }) {
  const [style, setStyle] = useState<CitationStyle>("apa");
  return (
    <SectionBody s={report.citations}>
      {(c) => (
        <div className="space-y-8">
          <div className="flex justify-end print:hidden">
            <StylePicker value={style} onChange={setStyle} />
          </div>
          {c.verification ? (
            <VerifyView result={c.verification} crossCheck={c.crossCheck} />
          ) : (
            <>
              <Notice kind="info">{c.verificationSkipped}</Notice>
              <CrossCheckView check={c.crossCheck} />
            </>
          )}
          <section aria-labelledby="claims-h">
            <h3 id="claims-h" className="font-display text-xl font-semibold">
              Sentences that may need a citation ({c.claims.length})
            </h3>
            {c.claims.length === 0 ? (
              <p className="mt-2 text-ink-soft">No unsupported claims stood out.</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {c.claims.map((cl) => {
                  const sug = c.suggestions.find((s) => s.claim.start === cl.start);
                  return (
                    <li key={cl.start} className="card print-avoid px-4 py-3">
                      <p className="font-serif">
                        <span className="mark mark-cite">{cl.text}</span>
                      </p>
                      <p className="mt-1 text-sm text-ink-soft">Why: {cl.reasons.join("; ")}.</p>
                      {sug && sug.suggestions.length > 0 && (
                        <div className="mt-3 space-y-3">
                          <p className="text-sm font-semibold">Papers to look at (check they support the claim)</p>
                          {sug.suggestions.map((s) => (
                            <div key={s.work.doi ?? s.work.title} className="border-l-4 border-cite pl-3">
                              <WorkCitation work={s.work} style={style} />
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      )}
    </SectionBody>
  );
}

function RewritesPanel({ report }: { report: PaperReport }) {
  return (
    <div className="space-y-10">
      {(["paraphrase", "humanise"] as const).map((key) => (
        <section key={key} aria-labelledby={`h-${key}`} className="space-y-4">
          <h3 id={`h-${key}`} className="font-display text-xl font-semibold">
            {TOOL_LABEL[key]}
          </h3>
          <SectionBody s={report[key]}>
            {(list) =>
              list.length === 0 ? (
                <p className="text-ink-soft">{key === "paraphrase" ? "No matched passages needed a rewrite." : "No paragraph was formulaic enough to suggest a revision."}</p>
              ) : (
                <div className="space-y-8">
                  {list.map((sg) => (
                    <div key={sg.start} className="print-avoid space-y-2">
                      <p className="font-semibold">{sg.reason}</p>
                      <RewriteResultView result={sg.result} compact />
                    </div>
                  ))}
                </div>
              )
            }
          </SectionBody>
        </section>
      ))}
    </div>
  );
}

function ExportMenu({ report }: { report: PaperReport }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute("open");
  return (
    <details ref={ref} className="relative">
      <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-md border border-rule bg-page px-3 font-semibold hover:bg-desk [&::-webkit-details-marker]:hidden">
        More formats <ChevronDownIcon size={16} />
      </summary>
      <div className="card absolute right-0 z-20 mt-1 w-56 p-1">
        <button
          type="button"
          className="block w-full rounded px-3 py-2 text-left hover:bg-desk"
          onClick={() => {
            close();
            window.print();
          }}
        >
          Print this page
        </button>
        <button
          type="button"
          className="block w-full rounded px-3 py-2 text-left hover:bg-desk"
          onClick={() => {
            download("veritome-report.md", "text/markdown", reportToMarkdown(report));
            close();
          }}
        >
          Download Markdown
        </button>
        <button
          type="button"
          className="block w-full rounded px-3 py-2 text-left hover:bg-desk"
          onClick={() => {
            download("veritome-report.json", "application/json", JSON.stringify(report, null, 2));
            close();
          }}
        >
          Download JSON
        </button>
      </div>
    </details>
  );
}

/** The finished report: headline scores, a ranked to-do list and one tab per check. Printing shows every tab. */
export function ReportView({ report, text, onNew }: { report: PaperReport; text: string; onNew: () => void }) {
  const [tab, setTab] = useState<TabId>("paper");
  const imageReport = useImageReport();
  const tabs = TABS.filter((t) => t.id !== "images" || imageReport);
  const baseId = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const topRef = useRef<HTMLDivElement>(null);
  const title = guessTitle(text);
  const [pdf, setPdf] = useState<"idle" | "busy" | "error">("idle");
  const downloadPdf = async () => {
    setPdf("busy");
    try {
      const { buildReportPdf } = await import("@/lib/pdf/report-pdf");
      const url = URL.createObjectURL(await buildReportPdf(report, text));
      const a = document.createElement("a");
      a.href = url;
      a.download = `veritome-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setPdf("idle");
    } catch {
      setPdf("error");
    }
  };
  const date = new Date(report.generatedAt);

  const open = (t: TabId) => {
    setTab(t);
    topRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = tabs.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    const t = tabs[next]!.id;
    setTab(t);
    tabRefs.current[t]?.focus();
  };
  const findings = useMemo(() => collectFindings(report, text).length, [report, text]);
  const badge = (t: TabId): number | null => {
    if (t === "paper") return findings;
    if (t === "images") return imageReport?.findings.length || null;
    if (t === "similarity" && report.plagiarism.status === "done") return report.plagiarism.result.spans.length + report.plagiarism.result.paraphrases.length;
    if (t === "grammar" && report.grammar.status === "done") return report.grammar.result.summary.total;
    if (t === "citations" && report.citations.status === "done") return report.citations.result.references.length;
    if (t === "rewrites") return (report.paraphrase.status === "done" ? report.paraphrase.result.length : 0) + (report.humanise.status === "done" ? report.humanise.result.length : 0);
    return null;
  };

  const panels: Record<TabId, ReactNode> = {
    paper: <PaperPanel report={report} text={text} onOpen={(t) => open(t as TabId)} />,
    overview: <Overview report={report} text={text} onOpen={open} />,
    images: imageReport ? <ImagesPanel report={imageReport} /> : null,
    similarity: <SectionBody s={report.plagiarism}>{(r) => <PlagiarismResultView text={text} report={r} ai={report.detector.status === "done" ? report.detector.result : null} showDownload={false} />}</SectionBody>,
    ai: <SectionBody s={report.detector}>{(r) => <DetectorResultView text={text} result={r} />}</SectionBody>,
    citations: <CitationsPanel report={report} />,
    grammar: <SectionBody s={report.grammar}>{(r) => <GrammarDetail text={text} result={r} />}</SectionBody>,
    rewrites: <RewritesPanel report={report} />,
  };

  return (
    <article aria-labelledby="report-h" className="space-y-8">
      <header className="flex flex-col gap-4 border-b border-rule pb-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <button type="button" onClick={onNew} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-action hover:underline print:hidden">
            <ArrowLeftIcon size={16} /> New check
          </button>
          <p className="text-sm font-semibold tracking-wide text-ink-faint uppercase">Veritome report</p>
          <h2 id="report-h" className="sr-only">
            Report
          </h2>
          <p className="mt-1 font-display text-3xl leading-tight font-semibold tracking-tight sm:text-4xl" aria-hidden={!title}>
            {title ?? "Report"}
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            {report.words.toLocaleString("en")} words · checked {date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })} at{" "}
            {date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="primary" onClick={() => void downloadPdf()} busy={pdf === "busy"}>
            <DownloadIcon /> {pdf === "busy" ? "Making the PDF" : "Download PDF report"}
          </Button>
          <ExportMenu report={report} />
        </div>
      </header>

      {pdf === "error" && (
        <Notice kind="error">The PDF could not be made in this browser. Try another browser, or use Print this page under More formats.</Notice>
      )}
      <section aria-label="Summary scores" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {scores(report).map((s, i) => (
          <div key={s.label} className="animate-fade-up flex" style={{ ["--i" as string]: i }}>
            <ScoreCard s={s} status={statusOf(report, s.tool)} onOpen={() => open(s.tab)} />
          </div>
        ))}
      </section>

      <div ref={topRef} className="scroll-mt-20">
        <div role="tablist" aria-label="Report sections" className="-mx-4 flex gap-1 overflow-x-auto border-b border-rule px-4 sm:mx-0 sm:px-0 print:hidden">
          {tabs.map((t, i) => {
            const n = badge(t.id);
            const selected = tab === t.id;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${t.id}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${t.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={cx(
                  "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-3 text-[0.95rem] font-semibold whitespace-nowrap transition-colors",
                  selected ? "border-action text-ink" : "border-transparent text-ink-soft hover:border-rule hover:text-ink",
                )}
              >
                {t.label}
                {n !== null && n > 0 && (
                  <span className={cx("rounded-full px-1.5 py-px text-xs tabular-nums", selected ? "bg-action text-action-ink" : "bg-desk-deep text-ink-soft")}>{n}</span>
                )}
              </button>
            );
          })}
        </div>

        {tabs.map((t, i) => (
          <section
            key={t.id}
            role="tabpanel"
            id={`${baseId}-panel-${t.id}`}
            aria-labelledby={`${baseId}-tab-${t.id}`}
            tabIndex={0}
            // A class rather than the hidden attribute, so printing can still show every section.
            className={cx("pt-8 focus-visible:outline-none", tab === t.id ? "animate-fade-up" : "hidden print:block", i > 0 && "print-break")}
          >
            <h2 className="mb-6 hidden font-display text-2xl font-semibold print:block">{t.label}</h2>
            {panels[t.id]}
          </section>
        ))}
      </div>

      <p className="border-t border-rule pt-6 text-sm text-ink-faint">{report.disclaimer}</p>
    </article>
  );
}
