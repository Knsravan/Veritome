"use client";

import { useMemo, useState } from "react";
import { aiBreakdown } from "@/core/detector/breakdown";
import type { DetectorResult } from "@/core/detector/types";
import { ISSUE_TEXT, reviewReport } from "@/core/plagiarism/review";
import type { PlagiarismReport } from "@/core/plagiarism/types";
import { paragraphStats } from "@/core/report/paragraphs";
import { AiSummary } from "./AiSummary";
import { focusMark, focusNote, type TextMark } from "./AnnotatedText";
import { useDocModel } from "./DocumentContext";
import { DocumentView, LayoutToggle } from "./DocumentView";
import { DownloadIcon } from "./icons";
import { FindingDetail } from "./plagiarism/FindingDetail";
import { FindingsList } from "./plagiarism/FindingsList";
import { IntegrityFlags } from "./plagiarism/IntegrityFlags";
import { SearchedTable } from "./plagiarism/SearchedTable";
import { SimilaritySummary } from "./plagiarism/SimilaritySummary";
import { SourcesList } from "./plagiarism/SourcesList";
import { WhereInDocument } from "./plagiarism/WhereInDocument";
import { issueId, sourceColours } from "./plagiarism/shared";
import { Button, Limits, Notice, ProofLayout, Sheet, Warnings, cx } from "./ui";

export function PlagiarismResultView({
  text,
  report,
  ai,
  showDownload = true,
}: {
  text: string;
  report: PlagiarismReport;
  ai?: DetectorResult | null;
  /** Offer a PDF of this report (off inside the full report, which has its own). */
  showDownload?: boolean;
}) {
  const [minWords, setMinWords] = useState(0);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [view, setView] = useState<"matches" | "ai">("matches");
  const doc = useDocModel(text);
  const [layout, setLayout] = useState<"original" | "plain">("original");
  const [pdf, setPdf] = useState<"idle" | "busy" | "error">("idle");
  const aiB = useMemo(() => (ai ? aiBreakdown(ai, text) : null), [ai, text]);
  const aiRegions = aiB?.regions.filter((x) => x.kind !== "human") ?? [];
  const aiFlagged = aiRegions.filter((x) => x.kind === "ai");
  const r = useMemo(
    () => reviewReport(report, { minWords, excludeSources: excluded }),
    [report, minWords, excluded],
  );
  const paras = useMemo(
    () =>
      paragraphStats(text, { spans: r.spans, paraphrases: r.paraphrases }, aiB),
    [text, r.spans, r.paraphrases, aiB],
  );
  const byId = useMemo(
    () => new Map(report.sources.map((s) => [s.id, s])),
    [report.sources],
  );
  const colour = sourceColours(r.primary);
  const number = (id: string | undefined) =>
    id && colour.has(id)
      ? r.primary.findIndex((s) => s.id === id) + 1
      : undefined;

  const marks: TextMark[] = r.issues
    .filter((i) => i.kind !== "quote_uncited")
    .map((i) => ({
      id: issueId(i),
      start: i.start,
      end: i.end,
      className:
        i.kind === "disguised" || i.kind === "tortured"
          ? "mark-flag"
          : i.kind.startsWith("reworded") || i.kind === "translated"
            ? "mark-para"
            : "mark-match",
      label: `${ISSUE_TEXT[i.kind].title}${i.sourceId ? `, source ${number(i.sourceId) ?? ""}` : ""}`,
      ...(i.sourceId && colour.has(i.sourceId)
        ? { group: colour.get(i.sourceId)! }
        : {}),
    }));
  for (const q of r.issues.filter((i) => i.kind === "quote_uncited")) {
    marks.push({
      id: issueId(q),
      start: q.start,
      end: q.end,
      className: "mark-cite",
      label: ISSUE_TEXT.quote_uncited.title,
    });
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
  const showAi = (k: number) => {
    setView("ai");
    requestAnimationFrame(() => focusMark(`ai${k}`));
  };

  const downloadPdf = async () => {
    setPdf("busy");
    try {
      const { buildPlagiarismPdf } = await import("@/lib/pdf/plagiarism-pdf");
      const blob = await buildPlagiarismPdf({
        text,
        report,
        reviewed: r,
        ai: aiB,
        ...(ai ? { aiThreshold: ai.model.thresholds.likelyAi } : {}),
        paragraphs: paras,
        filters: { minWords, excluded: [...excluded] },
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `veritome-similarity-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setPdf("idle");
    } catch {
      setPdf("error");
    }
  };

  return (
    <div className="space-y-6">
      {showDownload && (
        <div className="flex flex-wrap items-center justify-end gap-3 print:hidden">
          {pdf === "error" && (
            <Notice kind="error">
              The PDF could not be made in this browser. Try another browser, or
              use your browser&rsquo;s Print and choose Save as PDF.
            </Notice>
          )}
          <Button variant="pillow" onClick={() => void downloadPdf()} busy={pdf === "busy"}>
            <DownloadIcon />{" "}
            {pdf === "busy" ? "Making the PDF" : "Download PDF report"}
          </Button>
        </div>
      )}
      {report.language?.translatedCheck && (
        <Notice kind="info" title={`Your paper is in ${report.language.name}`}>
          It was also translated into English and checked against English
          sources, to catch text translated from them. Translated matches are
          dotted and listed under “Translated from a source without a citation”.
        </Notice>
      )}
      <IntegrityFlags r={r} />
      <SimilaritySummary
        text={text}
        report={report}
        r={r}
        byId={byId}
        number={number}
        minWords={minWords}
        onMinWords={setMinWords}
        excluded={excluded}
        onExclude={exclude}
        onInclude={(id) =>
          setExcluded((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          })
        }
      />

      {ai && aiB && <AiSummary ai={ai} b={aiB} />}

      <WhereInDocument
        paras={paras}
        issues={r.issues}
        ai={ai}
        aiB={aiB}
        aiRegions={aiRegions}
        onShowIssue={(hit) => {
          setView("matches");
          requestAnimationFrame(() => select(issueId(hit), "list"));
        }}
        onShowAi={showAi}
      />

      <ProofLayout
        sheet={
          <Sheet label="Your text with matched passages">
            {doc && (
              <LayoutToggle
                value={layout}
                onChange={setLayout}
                kind={doc.kind}
              />
            )}
            {aiB?.judged && (
              <div
                role="radiogroup"
                aria-label="Highlight in the text"
                className="mb-4 inline-flex rounded-lg border border-rule p-0.5 text-sm print:hidden"
              >
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
                    className={cx(
                      "rounded-md px-3 py-1.5 font-semibold",
                      view === v
                        ? "bg-action text-action-ink"
                        : "text-ink-soft hover:bg-desk",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {view === "ai" && aiB ? (
              <>
                <p className="mb-4 text-sm text-ink-faint">
                  <span className="mark mark-ai">Wavy underline</span>: likely
                  AI-written.{" "}
                  <span className="mark mark-ai-medium">Dotted</span>: unclear.
                  Each paragraph is judged on its own; short paragraphs are
                  grouped until there are at least 150 words to judge.
                </p>
                <DocumentView
                  doc={doc}
                  layout={layout}
                  text={text}
                  marks={aiRegions.map((x, i) => ({
                    id: `ai${i}`,
                    start: x.start,
                    end: x.end,
                    className: x.kind === "ai" ? "mark-ai" : "mark-ai-medium",
                    label:
                      x.kind === "ai"
                        ? "Likely AI-written"
                        : "Unclear whether AI-written",
                  }))}
                />
              </>
            ) : marks.length === 0 ? (
              <p className="text-ink-soft">
                No matched passages in the sources that were searched. Read the
                limits beside this before relying on it.
              </p>
            ) : (
              <>
                <p className="mb-4 text-sm text-ink-faint">
                  <span className="mark mark-match" data-src="1">
                    Solid underline
                  </span>
                  : word for word.{" "}
                  <span className="mark mark-para" data-src="1">
                    Dotted
                  </span>
                  : reworded. <span className="mark mark-flag">Double</span>:
                  hidden copying. Colours match the numbered sources. Select a
                  passage to compare it with its source.
                </p>
                <DocumentView
                  doc={doc}
                  layout={layout}
                  text={text}
                  marks={marks}
                  activeId={active}
                  onSelect={(id) => select(id, "text")}
                />
              </>
            )}
            {report.searched.length > 0 && (
              <p className="mt-6 border-t border-rule pt-3 text-sm text-ink-faint">
                {report.searched.length} passage
                {report.searched.length === 1 ? "" : "s"}, spread across the
                whole text, were searched online; every source found was then
                compared with all of your text.
              </p>
            )}
          </Sheet>
        }
        margin={
          <>
            <div
              id="note-finding"
              tabIndex={-1}
              className="focus-visible:outline-none"
            >
              {selected && (
                <FindingDetail
                  issue={selected}
                  source={
                    selected.sourceId ? byId.get(selected.sourceId) : undefined
                  }
                  number={number(selected.sourceId)}
                  excerpt={
                    r.spans.find((s) => s.start === selected.start)
                      ?.sourceExcerpt
                  }
                  sourceSentence={
                    r.paraphrases.find((p) => p.start === selected.start)
                      ?.sourceText ??
                    (selected.kind === "translated"
                      ? report.translated?.find(
                          (t) => t.start === selected.start,
                        )?.sourceText
                      : undefined)
                  }
                  onExclude={exclude}
                  onClose={() => setActive(null)}
                />
              )}
            </div>

            <FindingsList
              text={text}
              issues={r.issues}
              aiRegions={aiRegions}
              aiFlagged={aiFlagged}
              active={active}
              number={number}
              onSelect={(id) => select(id, "list")}
              onShowAi={showAi}
            />

            <SourcesList
              r={r}
              colour={colour}
              onShow={(sourceId) => {
                const i = r.issues.find((x) => x.sourceId === sourceId);
                if (i) select(issueId(i), "list");
              }}
              onExclude={exclude}
            />

            <Warnings items={report.warnings} />

            <SearchedTable providers={report.providers} />

            <Limits>
              <p>{report.disclaimer}</p>
              <p>
                Word-for-word runs of six or more words are counted. Reworded
                sentences are found when a source sentence shares most of their
                ideas; heavier rewriting and translated text can still slip
                through. Whether a match is cited is judged from citations in
                the same sentence.
              </p>
            </Limits>
          </>
        }
      />
    </div>
  );
}
