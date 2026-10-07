"use client";

import { useEffect, useRef, useState } from "react";
import { useConsent } from "@/components/Consent";
import { DocumentProvider } from "@/components/DocumentContext";
import { ArrowRightIcon, CheckIcon, ShieldIcon } from "@/components/icons";
import { LibraryPicker, type LibraryItem } from "@/components/LibraryPicker";
import { ORDER } from "@/components/report/labels";
import { ReportProgress, type ProgressState, type StepState } from "@/components/report/ReportProgress";
import { ReportView } from "@/components/report/ReportView";
import { TextSource } from "@/components/TextSource";
import { Button, Checkbox, Notice, cx } from "@/components/ui";
import type { PaperReport, ReportEvent, ToolId } from "@/core/report/report";
import { ApiError, postNdjson } from "@/lib/api";
import { SAMPLE_PAPER } from "@/lib/sample";
import type { DocModel } from "@/lib/doc/model";
import type { ImageReport } from "@/lib/images/analyze";
import { reviewReport } from "@/core/plagiarism/review";
import { useHasLlm, useSettings } from "@/lib/settings";

type Phase = "compose" | "running" | "done";
type Extra = "detector" | "citations" | "grammar" | "rewrites";

const countWords = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;

const EXTRAS: Array<{ id: Extra; label: string; hint: string }> = [
  { id: "detector", label: "AI writing", hint: "How much of the text reads as AI-written, paragraph by paragraph." },
  { id: "citations", label: "References and citations", hint: "Looks up every reference, flags retractions and finds claims without a citation." },
  { id: "grammar", label: "Grammar and spelling", hint: "Grammar, spelling, academic style and readability." },
  { id: "rewrites", label: "Rewrite suggestions", hint: "Suggested rewrites for copied passages and formulaic paragraphs." },
];

function Toggle({ checked, onChange, label, hint, locked }: { checked: boolean; onChange?: (v: boolean) => void; label: string; hint: string; locked?: boolean }) {
  return (
    <label
      className={cx(
        "group flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-[background-color,border-color,transform] duration-200",
        locked ? "cursor-default" : "cursor-pointer hover:-translate-y-px",
        checked ? "border-action/50 bg-action-soft/60" : "border-rule hover:bg-desk",
      )}
    >
      <input
        type="checkbox"
        className="mt-1 size-4 shrink-0 accent-[var(--action)]"
        checked={checked}
        disabled={locked}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span>
        <span className="font-semibold">{label}</span>
        {locked && <span className="ml-2 rounded-full bg-action px-2 py-px text-[0.7rem] font-semibold text-action-ink">Always on</span>}
        <span className="block text-sm text-ink-soft">{hint}</span>
      </span>
    </label>
  );
}

/**
 * The plagiarism check is the full paper check: matching passages are always searched, and the AI-writing,
 * reference, grammar and rewrite checks run alongside by default, all in one report.
 */
export function PlagiarismTool() {
  const [phase, setPhase] = useState<Phase>("compose");
  const [text, setText] = useState("");
  const [checked, setChecked] = useState("");
  const [doc, setDoc] = useState<DocModel | null>(null);
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
  const ctrl = useRef<AbortController | null>(null);
  const { settings, update, status, llmFields } = useSettings();
  const hasLlm = useHasLlm();
  const consent = useConsent();
  const words = countWords(text);
  const web = status?.webSearch ?? [];

  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("sample") === "1") setText(SAMPLE_PAPER);
  }, []);
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
      const done: PaperReport = finished;
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
    return <ReportProgress order={ORDER} state={progress} words={countWords(checked)} onCancel={cancel} />;
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
          One check covers everything: copied and reworded passages, AI-written paragraphs, references and grammar. Every finding is marked in your
          text with what to do about it.
        </p>
      </header>

      {error && (
        <Notice kind="error" title="The check did not finish">
          {error}
        </Notice>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section aria-label="Your paper" className="card animate-fade-up p-4 sm:p-6" style={{ ["--i" as string]: 2 }}>
          <TextSource value={text} onChange={setText} onDocument={setDoc} rows={18} />
        </section>

        <div className="animate-fade-up space-y-4 lg:sticky lg:top-24" style={{ ["--i" as string]: 3 }}>
          <section aria-label="Options" className="card space-y-5 p-4 sm:p-6">
            <fieldset className="space-y-2">
              <legend className="mb-2 font-semibold">What to check</legend>
              <Toggle checked locked label="Plagiarism" hint="Copied and reworded passages in published papers, the web and your documents." />
              {EXTRAS.map((x) => (
                <Toggle key={x.id} checked={extras[x.id]} onChange={(v) => setExtras((e) => ({ ...e, [x.id]: v }))} label={x.label} hint={x.hint} />
              ))}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="font-semibold">Compare against</legend>
              <Checkbox
                checked={external}
                onChange={setExternal}
                label="Scholarly databases"
                hint={`${(status?.plagiarismSources ?? ["OpenAlex", "Crossref", "Semantic Scholar", "arXiv", "Europe PMC", "Wikipedia"]).join(", ")}. Asks before sending anything.`}
              />
              <Checkbox
                checked={external && settings.webSearch && web.length > 0}
                onChange={(v) => update({ webSearch: v })}
                disabled={!external || web.length === 0}
                label="The open web"
                hint={web.length ? `Searched with ${web.join(" and ")}.` : "Not enabled on this server."}
              />
              <label className={cx("block", !external && "opacity-60")}>
                <span className="font-medium">Your earlier papers</span>
                <span className="block text-sm text-ink-faint">Optional. Checks for text reused from your own published work (self-plagiarism).</span>
                <input
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  disabled={!external}
                  placeholder="ORCID iD or your full name"
                  autoComplete="name"
                  className="mt-1.5 w-full rounded-lg border border-rule bg-page px-3 py-2 text-sm transition-colors focus:border-action"
                />
              </label>
            </fieldset>

            <details className="group rounded-xl border border-rule">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 font-semibold">
                More options
                <span aria-hidden className="text-ink-faint transition-transform duration-200 group-open:rotate-45">
                  +
                </span>
              </summary>
              <div className="animate-fade-in space-y-4 border-t border-rule px-3 py-3">
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

          <ul className="space-y-1.5 px-1 text-sm text-ink-soft">
            <li className="flex items-start gap-2">
              <ShieldIcon size={18} className="mt-0.5 shrink-0 text-ok" />
              Your paper is processed in memory and never stored.
            </li>
            <li className="flex items-start gap-2">
              <CheckIcon size={18} className="mt-0.5 shrink-0 text-ok" />
              Only short passages are sent to search services, and only after you agree.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
