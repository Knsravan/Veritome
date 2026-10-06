"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CrossCheckView, StylePicker, VerifyView, WorkCitation } from "@/components/CitationViews";
import { useConsent } from "@/components/Consent";
import { DetectorResultView } from "@/components/DetectorResultView";
import { LibraryPicker, type LibraryItem } from "@/components/LibraryPicker";
import { PlagiarismResultView } from "@/components/PlagiarismResultView";
import { RewriteResultView } from "@/components/RewriteResultView";
import { TextSource } from "@/components/TextSource";
import { Button, Checkbox, Notice, ToolHeader, cx } from "@/components/ui";
import type { CitationStyle } from "@/core/citations/types";
import type { OverviewStatus, PaperReport, Section, ToolId } from "@/core/report/report";
import { postJson } from "@/lib/api";
import { reportToMarkdown } from "@/lib/report-markdown";
import { useHasLlm, useSettings } from "@/lib/settings";
import { useRun } from "@/lib/useRun";

const TOOL_LABEL: Record<ToolId, string> = {
  plagiarism: "Plagiarism",
  detector: "AI writing patterns",
  citations: "Citations",
  grammar: "Grammar and style",
  paraphrase: "Paraphrase suggestions",
  humanise: "Revision suggestions",
};

const TOOL_HINT: Record<ToolId, string> = {
  plagiarism: "Overlap with scholarly abstracts, the web and your documents.",
  detector: "Writing patterns common in model output, with a range.",
  citations: "Reference lookup, in-text cross-check, uncited claims.",
  grammar: "Built-in rules and readability, plus LanguageTool if connected.",
  paraphrase: "Rewrites for the longest matched passages.",
  humanise: "Revisions for the most formulaic paragraphs.",
};

const STATUS: Record<OverviewStatus, { text: string; cls: string; icon: string }> = {
  ok: { text: "Looks fine", cls: "bg-ok-soft text-ok", icon: "✓" },
  review: { text: "Worth reviewing", cls: "bg-warn-soft text-warn", icon: "!" },
  attention: { text: "Needs attention", cls: "bg-danger-soft text-danger", icon: "!!" },
  skipped: { text: "Skipped", cls: "bg-desk text-ink-faint", icon: "–" },
  error: { text: "Failed", cls: "bg-danger-soft text-danger", icon: "×" },
};

const ORDER: ToolId[] = ["plagiarism", "detector", "citations", "grammar", "paraphrase", "humanise"];

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Elapsed() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular-nums">{s}s</span>;
}

function SectionBody<T>({ s, children }: { s: Section<T>; children: (r: T) => ReactNode }) {
  if (s.status === "skipped") return <p className="text-ink-soft">Skipped: {s.reason}</p>;
  if (s.status === "error") return <Notice kind="error">This check failed: {s.message}</Notice>;
  return <>{children(s.result)}</>;
}

export function ReportTool() {
  const [text, setText] = useState("");
  const [checked, setChecked] = useState("");
  const [tools, setTools] = useState<Record<ToolId, boolean>>({ plagiarism: true, detector: true, citations: true, grammar: true, paraphrase: true, humanise: true });
  const [external, setExternal] = useState(true);
  const [useLlm, setUseLlm] = useState(true);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [style, setStyle] = useState<CitationStyle>("apa");
  const { settings, status, llmFields } = useSettings();
  const hasLlm = useHasLlm();
  const consent = useConsent();
  const { result, error, busy, run, cancel } = useRun<PaperReport>();

  const go = async () => {
    if (external && !(await consent("report"))) return;
    await run(async (signal) => {
      const r = await postJson<PaperReport>(
        "/api/report",
        { text, tools, external, consent: external, web: settings.webSearch, useLlm: useLlm && hasLlm, library, ...llmFields() },
        signal,
      );
      setChecked(text);
      return r;
    });
  };

  return (
    <div className="space-y-8">
      <ToolHeader
        title="Full paper report"
        intro="Runs every check on your manuscript and collects the findings in one place, each with its evidence and its limits."
      />
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <TextSource value={text} onChange={setText} rows={16} />
        <div className="space-y-6">
          <fieldset className="space-y-3">
            <legend className="font-semibold">Checks to run</legend>
            {ORDER.map((id) => (
              <Checkbox key={id} checked={tools[id]} onChange={(v) => setTools((t) => ({ ...t, [id]: v }))} label={TOOL_LABEL[id]} hint={TOOL_HINT[id]} />
            ))}
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="font-semibold">Outside services</legend>
            <Checkbox
              checked={external}
              onChange={setExternal}
              label="Search scholarly databases"
              hint="Needed for plagiarism search, reference checks and source suggestions. Asks before sending anything."
            />
            <Checkbox
              checked={useLlm && hasLlm}
              onChange={setUseLlm}
              disabled={!hasLlm}
              label={`Use the language model${status?.llmModel ? ` (${status.llmModel})` : ""}`}
              hint={hasLlm ? "For rewrite suggestions and a second opinion on writing patterns." : "None configured; rewrites fall back to light rule-based edits."}
            />
          </fieldset>
          <LibraryPicker items={library} onChange={setLibrary} serverCount={status?.libraryDocuments ?? 0} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void go()} busy={busy} disabled={!text.trim() || !Object.values(tools).some(Boolean)}>
          {busy ? "Building the report" : "Build the report"}
        </Button>
        {busy && (
          <>
            <p role="status" className="text-sm text-ink-soft">
              Searching and checking; long papers can take a few minutes. <Elapsed />
            </p>
            <Button variant="quiet" onClick={cancel}>
              Cancel
            </Button>
          </>
        )}
      </div>
      {error && <Notice kind="error">{error}</Notice>}

      {result && checked && (
        <article aria-labelledby="report-h" className="space-y-12">
          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="report-h" className="font-serif text-3xl font-semibold">
                  Report
                </h2>
                <p className="text-sm text-ink-faint">
                  {result.words.toLocaleString("en")} words, generated {new Date(result.generatedAt).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => download("veritome-report.md", "text/markdown", reportToMarkdown(result))}>
                  Download Markdown
                </Button>
                <Button variant="secondary" onClick={() => download("veritome-report.json", "application/json", JSON.stringify(result, null, 2))}>
                  Download JSON
                </Button>
              </div>
            </div>
            <ul className="divide-y divide-rule rounded-sm bg-page">
              {ORDER.map((id) => {
                const o = result.overview.find((x) => x.tool === id);
                if (!o) return null;
                const st = STATUS[o.status];
                return (
                  <li key={id} className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_10rem_1fr] sm:items-baseline sm:gap-4">
                    <a href={`#sec-${id}`} className="font-semibold text-action underline-offset-4 hover:underline">
                      {TOOL_LABEL[id]}
                    </a>
                    <span className={cx("w-fit rounded px-2 py-0.5 text-sm font-semibold", st.cls)}>
                      <span aria-hidden>{st.icon} </span>
                      {st.text}
                    </span>
                    <span className="text-ink-soft">{o.headline}</span>
                  </li>
                );
              })}
            </ul>
            <p className="text-sm text-ink-faint">{result.disclaimer}</p>
          </section>

          <section id="sec-plagiarism" aria-labelledby="h-plag" className="scroll-mt-6 space-y-4">
            <h2 id="h-plag" className="font-serif text-2xl font-semibold">
              Plagiarism
            </h2>
            <SectionBody s={result.plagiarism}>{(r) => <PlagiarismResultView text={checked} report={r} />}</SectionBody>
          </section>

          <section id="sec-detector" aria-labelledby="h-det" className="scroll-mt-6 space-y-4">
            <h2 id="h-det" className="font-serif text-2xl font-semibold">
              AI writing patterns
            </h2>
            <SectionBody s={result.detector}>{(r) => <DetectorResultView text={checked} result={r} />}</SectionBody>
          </section>

          <section id="sec-citations" aria-labelledby="h-cit" className="scroll-mt-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="h-cit" className="font-serif text-2xl font-semibold">
                Citations
              </h2>
              <StylePicker value={style} onChange={setStyle} />
            </div>
            <SectionBody s={result.citations}>
              {(c) => (
                <div className="space-y-6">
                  {c.verification ? (
                    <VerifyView result={c.verification} crossCheck={c.crossCheck} />
                  ) : (
                    <>
                      <Notice kind="info">{c.verificationSkipped}</Notice>
                      <CrossCheckView check={c.crossCheck} />
                    </>
                  )}
                  <div>
                    <h3 className="font-semibold">Sentences that may need a citation ({c.claims.length})</h3>
                    <ol className="mt-2 space-y-3">
                      {c.claims.map((cl) => {
                        const sug = c.suggestions.find((s) => s.claim.start === cl.start);
                        return (
                          <li key={cl.start} className="rounded bg-page px-4 py-3">
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
                  </div>
                </div>
              )}
            </SectionBody>
          </section>

          <section id="sec-grammar" aria-labelledby="h-gram" className="scroll-mt-6 space-y-4">
            <h2 id="h-gram" className="font-serif text-2xl font-semibold">
              Grammar and style
            </h2>
            <SectionBody s={result.grammar}>
              {(g) => (
                <div className="space-y-3">
                  <p className="text-ink-soft">
                    {g.summary.total} issues ({g.summary.bySeverity.error} likely errors), {g.summary.issuesPer1000Words} per 1,000 words. Readability:{" "}
                    {g.metrics.level}. Open the Grammar tool to fix them one by one.
                  </p>
                  <ul className="columns-1 gap-6 text-sm md:columns-2">
                    {g.issues.slice(0, 40).map((i) => (
                      <li key={i.id} className="mb-2 break-inside-avoid rounded border-l-4 border-grammar bg-page px-3 py-1.5">
                        <span className="font-serif">“{i.text}”</span> {i.message}
                        {i.suggestions[0] !== undefined && <span className="text-ok"> Try: “{i.suggestions[0] || "delete"}”.</span>}
                      </li>
                    ))}
                  </ul>
                  {g.issues.length > 40 && <p className="text-sm text-ink-faint">and {g.issues.length - 40} more.</p>}
                </div>
              )}
            </SectionBody>
          </section>

          {(["paraphrase", "humanise"] as const).map((key) => (
            <section key={key} id={`sec-${key}`} aria-labelledby={`h-${key}`} className="scroll-mt-6 space-y-4">
              <h2 id={`h-${key}`} className="font-serif text-2xl font-semibold">
                {TOOL_LABEL[key]}
              </h2>
              <SectionBody s={result[key]}>
                {(list) =>
                  list.length === 0 ? (
                    <p className="text-ink-soft">{key === "paraphrase" ? "No matched passages needed a rewrite." : "No paragraph was formulaic enough to suggest a revision."}</p>
                  ) : (
                    <div className="space-y-8">
                      {list.map((sg) => (
                        <div key={sg.start} className="space-y-2">
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
        </article>
      )}
    </div>
  );
}
