"use client";

import { useEffect, useRef, useState } from "react";
import { useConsent } from "@/components/Consent";
import { DocumentProvider } from "@/components/DocumentContext";
import { ArrowRightIcon, CheckIcon, ShieldIcon } from "@/components/icons";
import { LibraryPicker, type LibraryItem } from "@/components/LibraryPicker";
import { ORDER } from "@/components/report/labels";
import { ReportProgress, type ProgressState, type StepState } from "@/components/report/ReportProgress";
import { ReportView } from "@/components/report/ReportView";
import { FileDrop, type LoadedPaper } from "@/components/FileDrop";
import { fileOf, SeenBefore, useSavedCheck } from "@/components/HistoryBits";
import { aiBreakdown } from "@/core/detector/breakdown";
import { saveCheck, titleFor } from "@/lib/history";
import { Button, Checkbox, Notice, cx } from "@/components/ui";
import { detectorOverview } from "@/core/detector/overview";
import type { PaperReport, ReportEvent, ToolId } from "@/core/report/report";
import { ApiError, postNdjson } from "@/lib/api";
import { sampleDocx } from "@/lib/sample-file";
import type { ImageReport } from "@/lib/images/analyze";
import { reviewReport } from "@/core/plagiarism/review";
import { useHasLlm, useSettings } from "@/lib/settings";
import { CheckOptions, type Extra } from "./check-options";

type Phase = "compose" | "running" | "done";

const countWords = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;

/**
 * The plagiarism check is the full paper check: matching passages are always searched, and the AI-writing,
 * reference, grammar and rewrite checks run alongside by default, all in one report.
 */
export function PlagiarismTool() {
  const [phase, setPhase] = useState<Phase>("compose");
  const [paper, setPaper] = useState<LoadedPaper | null>(null);
  const text = paper?.text ?? "";
  const doc = paper?.doc ?? null;
  const [wantSample] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("sample") === "1");
  const [checked, setChecked] = useState("");
  const [images, setImages] = useState<ImageReport | null>(null);
  const [extras, setExtras] = useState<Record<Extra, boolean>>({ detector: true, citations: true, grammar: true, rewrites: true });
  const [external, setExternal] = useState(true);
  const [excludeQuotes, setExcludeQuotes] = useState(true);
  const [excludeReferences, setExcludeReferences] = useState(true);
  const [useLlm, setUseLlm] = useState(true);
  const [author, setAuthor] = useState("");
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [report, setReport] = useState<PaperReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const opening = useSavedCheck("plagiarism", (entry, saved) => {
    const r = (entry.payload as { report?: PaperReport } | null)?.report;
    if (!r) return;
    setPaper(saved);
    setChecked(entry.text);
    setReport(r);
    setPhase("done");
  });
  const ctrl = useRef<AbortController | null>(null);
  const { settings, update, status, llmFields } = useSettings();
  const hasLlm = useHasLlm();
  const consent = useConsent();
  const words = countWords(text);
  const web = status?.webSearch ?? [];

  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [phase]);

  const tools: Record<ToolId, boolean> = {
    plagiarism: true,
    detector: extras.detector,
    citations: extras.citations,
    grammar: extras.grammar,
    paraphrase: extras.rewrites,
    humanise: extras.rewrites && extras.detector,
  };

  const go = async () => {
    if (external && !(await consent("report"))) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const steps = Object.fromEntries(ORDER.map((id) => [id, tools[id] ? "waiting" : "off"])) as Record<ToolId, StepState>;
    const checkImages = Boolean(doc && doc.text === text && (doc.kind === "pdf" || doc.images.length > 0));
    setImages(null);
    setProgress({ steps, ...(checkImages ? { extra: { label: "Pictures", state: "waiting" as StepState } } : {}) });
    setError(null);
    setChecked(text);
    setPhase("running");
    let finished: PaperReport | null = null;
    try {
      await postNdjson<ReportEvent>(
        "/api/report",
        {
          text,
          tools,
          external,
          consent: external,
          web: settings.webSearch,
          excludeQuotes,
          excludeReferences,
          ...(external && author.trim() ? { author: author.trim() } : {}),
          ...(doc && doc.text === text && doc.hidden.length ? { hiddenText: doc.hidden } : {}),
          useLlm: useLlm && hasLlm,
          library,
          stream: true,
          ...llmFields(),
        },
        (ev) => {
          if (ev.type === "progress") {
            setProgress((p) => (p ? { ...p, steps: { ...p.steps, [ev.tool]: p.steps[ev.tool] === "off" ? "off" : ev.state === "start" ? "running" : "done" } } : p));
          } else if (ev.type === "step" && ev.tool === "plagiarism") {
            setProgress((p) => (p ? { ...p, plagiarism: { done: ev.done, total: ev.total } } : p));
          } else if (ev.type === "result") {
            finished = ev.report;
          } else if (ev.type === "error") {
            throw new ApiError(ev.error, 500);
          }
        },
        c.signal,
      );
      if (c.signal.aborted) return;
      if (!finished) throw new ApiError("The check stopped before the report was ready. Try again, or with fewer checks at once.", 0);
      let done: PaperReport = finished;
      if (done.detector.status === "done") {
        // The neural model reads each paragraph here in the browser; the paper is not sent anywhere for it.
        setProgress((p) => (p ? { ...p, extra: { label: "AI writing, second opinion", state: "running", text: "Reading each paragraph with the neural model" } } : p));
        const { withNeuralOpinion } = await import("@/lib/ai-model/neural");
        const result = await withNeuralOpinion(done.detector.result, text, c.signal);
        if (c.signal.aborted) return;
        const line = detectorOverview(result);
        done = { ...done, detector: { ...done.detector, result }, overview: done.overview.map((o) => (o.tool === "detector" ? { ...o, ...line } : o)) };
        setProgress((p) => (p ? { ...p, extra: { label: "AI writing, second opinion", state: "done" } } : p));
      }
      if (checkImages && doc) {
        setProgress((p) => (p ? { ...p, extra: { label: "Pictures", state: "running", text: "Finding the pictures" } } : p));
        try {
          const { analyzeImages } = await import("@/lib/images/analyze");
          const sources =
            done.plagiarism.status === "done"
              ? reviewReport(done.plagiarism.result).primary.filter((s) => s.kind !== "self" && s.kind !== "library").map((s) => ({ id: s.id, title: s.title, ...(s.url ? { url: s.url } : {}), ...(s.doi ? { doi: s.doi } : {}) }))
              : [];
          const result = await analyzeImages(doc, {
            sources,
            external,
            web: settings.webSearch,
            signal: c.signal,
            onStep: (t) => setProgress((p) => (p ? { ...p, extra: { label: "Pictures", state: "running", text: t } } : p)),
          });
          if (c.signal.aborted) return;
          setImages(result.images.length ? result : null);
        } catch {
          // The text report still stands if the picture checks fail.
        }
      }
      setReport(done);
      setPhase("done");
      void saveCheck({
        tool: "plagiarism",
        title: titleFor(text, paper?.name),
        words: countWords(text),
        figures: [
          ...(done.plagiarism.status === "done" ? [{ label: "Similarity", value: `${done.plagiarism.result.similarity}%` }] : []),
          ...(done.detector.status === "done" && aiBreakdown(done.detector.result, text).judged
            ? [{ label: "AI writing", value: `${Math.round(aiBreakdown(done.detector.result, text).aiPercent)}%` }]
            : []),
        ],
        text,
        ...(fileOf(paper) ? { file: fileOf(paper)! } : {}),
        payload: { report: done },
      });
    } catch (err) {
      if (c.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("compose");
    }
  };

  const cancel = () => {
    ctrl.current?.abort();
    setPhase("compose");
  };

  if (phase === "running" && progress) {
    return (
      <ReportProgress
        order={ORDER}
        state={progress}
        words={countWords(checked)}
        onCancel={cancel}
        {...(paper ? { fileName: paper.name, kind: paper.kind, preview: paper.thumb ?? null } : {})}
      />
    );
  }

  if (phase === "done" && report) {
    return (
      <DocumentProvider doc={doc} images={images}>
        <ReportView report={report} text={checked} onNew={() => setPhase("compose")} />
      </DocumentProvider>
    );
  }

  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <p className="animate-fade-up text-sm font-semibold tracking-wide text-action uppercase">Complete paper check</p>
        <h1 className="animate-fade-up mt-2 font-display text-3xl font-bold tracking-tight sm:text-[2.6rem] sm:leading-[1.1]" style={{ ["--i" as string]: 1 }}>
          Plagiarism check
        </h1>
        <p className="animate-fade-up mt-3 text-lg text-ink-soft" style={{ ["--i" as string]: 2 }}>
          One check covers everything: copied and reworded passages, AI-written paragraphs, references and grammar. Every finding is underlined on
          your paper, in its own layout, with what to do about it.
        </p>
      </header>

      {opening === "missing" && (
        <Notice kind="warn" title="That saved check is no longer here">
          It may have been deleted from your history, or saved in another browser.
        </Notice>
      )}
      {paper && <SeenBefore tool="plagiarism" text={paper.text} />}
      {error && (
        <Notice kind="error" title="The check did not finish">
          {error}
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_23.5rem]">
        <section aria-label="Your paper" className="card animate-fade-up flex flex-col gap-4 p-4 sm:p-6" style={{ ["--i" as string]: 2 }}>
          <div className="flex flex-1 flex-col">
            <FileDrop paper={paper} onPaper={setPaper} sample={sampleDocx} fill {...(wantSample ? { initialFile: sampleDocx } : {})} />
          </div>
          <ul className="flex flex-wrap justify-center gap-x-6 gap-y-1.5 border-t border-rule pt-4 text-sm text-ink-soft">
            <li className="flex items-center gap-2">
              <ShieldIcon size={17} className="shrink-0 text-ok" />
              Never stored on our servers; history stays in this browser.
            </li>
            <li className="flex items-center gap-2">
              <CheckIcon size={17} className="shrink-0 text-ok" />
              Only short passages are searched, after you agree.
            </li>
          </ul>
        </section>

        <div className="animate-fade-up flex flex-col" style={{ ["--i" as string]: 3 }}>
          <section aria-label="Options" className="card flex-1 space-y-4 p-4 sm:p-5">
            <CheckOptions
              extras={extras}
              onExtras={setExtras}
              external={external}
              onExternal={setExternal}
              web={web}
              webOn={external && settings.webSearch && web.length > 0}
              onWeb={(v) => update({ webSearch: v })}
              sources={status?.plagiarismSources ?? ["OpenAlex", "Crossref", "Semantic Scholar", "arXiv", "Europe PMC", "Wikipedia"]}
            />

            <details className="group rounded-xl border border-rule">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 font-semibold">
                More options
                <span aria-hidden className="text-ink-faint transition-transform duration-200 group-open:rotate-45">
                  +
                </span>
              </summary>
              <div className="animate-fade-in space-y-4 border-t border-rule px-3 py-3">
                <label className={cx("block", !external && "opacity-60")}>
                  <span className="font-semibold">Your earlier papers</span>
                  <span className="block text-sm text-ink-faint">Optional. Checks for text reused from your own published work (self-plagiarism).</span>
                  <input
                    type="text"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    disabled={!external}
                    placeholder="ORCID iD or your full name"
                    autoComplete="name"
                    className="mt-1.5 w-full rounded-lg border border-[var(--neu-edge)] bg-desk px-3 py-2 text-sm transition-colors focus:border-action"
                  />
                </label>
                <fieldset className="space-y-3">
                  <legend className="font-semibold">Leave out of the score</legend>
                  <Checkbox checked={excludeQuotes} onChange={setExcludeQuotes} label="Quotations" hint="Quoted passages of 40 characters or more. They are still checked for a citation." />
                  <Checkbox checked={excludeReferences} onChange={setExcludeReferences} label="Reference list" />
                </fieldset>
                <Checkbox
                  checked={useLlm && hasLlm}
                  onChange={setUseLlm}
                  disabled={!hasLlm}
                  label={`Use the language model${status?.llmModel ? ` (${status.llmModel})` : ""}`}
                  hint={hasLlm ? "For better rewrite suggestions and a second opinion on AI writing." : "None configured; rewrites fall back to light rule-based edits."}
                />
                <LibraryPicker items={library} onChange={setLibrary} serverCount={status?.libraryDocuments ?? 0} />
              </div>
            </details>

            <Button className="h-12 w-full text-base" onClick={() => void go()} disabled={!text.trim()}>
              Check my paper <ArrowRightIcon />
            </Button>
            <p className="-mt-2 text-center text-sm text-ink-faint">
              {words ? `${words.toLocaleString("en")} words ready to check` : "Add your paper to start"}
            </p>
            {!external && library.length === 0 && (status?.libraryDocuments ?? 0) === 0 && (
              <Notice kind="warn">With no sources selected, only repetition inside your own text is checked for plagiarism.</Notice>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}
