"use client";

import { useEffect, useRef, useState } from "react";
import { useConsent } from "@/components/Consent";
import { ArrowRightIcon, ShieldIcon } from "@/components/icons";
import { LibraryPicker, type LibraryItem } from "@/components/LibraryPicker";
import { ORDER, TOOL_HINT, TOOL_LABEL } from "@/components/report/labels";
import { ReportProgress, type ProgressState, type StepState } from "@/components/report/ReportProgress";
import { ReportView } from "@/components/report/ReportView";
import { TextSource } from "@/components/TextSource";
import { Button, Checkbox, Notice, cx } from "@/components/ui";
import type { PaperReport, ReportEvent, ToolId } from "@/core/report/report";
import { ApiError, postNdjson } from "@/lib/api";
import { SAMPLE_PAPER } from "@/lib/sample";
import { useHasLlm, useSettings } from "@/lib/settings";

type Phase = "compose" | "running" | "done";

const countWords = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className={cx("flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors", checked ? "border-action/50 bg-action-soft/50" : "border-rule hover:bg-desk")}>
      <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--action)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-semibold">{label}</span>
        <span className="block text-sm text-ink-soft">{hint}</span>
      </span>
    </label>
  );
}

export function ReportTool() {
  const [phase, setPhase] = useState<Phase>("compose");
  const [text, setText] = useState("");
  const [checked, setChecked] = useState("");
  const [tools, setTools] = useState<Record<ToolId, boolean>>({ plagiarism: true, detector: true, citations: true, grammar: true, paraphrase: true, humanise: true });
  const [external, setExternal] = useState(true);
  const [useLlm, setUseLlm] = useState(true);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [report, setReport] = useState<PaperReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const { settings, status, llmFields } = useSettings();
  const hasLlm = useHasLlm();
  const consent = useConsent();
  const words = countWords(text);

  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("sample") === "1") setText(SAMPLE_PAPER);
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [phase]);

  const go = async () => {
    if (external && !(await consent("report"))) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const steps = Object.fromEntries(ORDER.map((id) => [id, tools[id] ? "waiting" : "off"])) as Record<ToolId, StepState>;
    setProgress({ steps });
    setError(null);
    setChecked(text);
    setPhase("running");
    let finished: PaperReport | null = null;
    try {
      await postNdjson<ReportEvent>(
        "/api/report",
        { text, tools, external, consent: external, web: settings.webSearch, useLlm: useLlm && hasLlm, library, stream: true, ...llmFields() },
        (ev) => {
          if (ev.type === "progress") {
            setProgress((p) => (p ? { ...p, steps: { ...p.steps, [ev.tool]: ev.state === "start" ? (p.steps[ev.tool] === "off" ? "off" : "running") : p.steps[ev.tool] === "off" ? "off" : "done" } } : p));
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
      setReport(finished);
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
    return <ReportView report={report} text={checked} onNew={() => setPhase("compose")} />;
  }

  const selected = ORDER.filter((id) => tools[id]).length;
  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Check a paper</h1>
        <p className="mt-2 text-lg text-ink-soft">
          Upload your manuscript and get one report covering plagiarism, AI-writing patterns, references and grammar, with every finding shown in your text.
        </p>
      </header>

      {error && (
        <Notice kind="error" title="The check did not finish">
          {error}
        </Notice>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section aria-labelledby="step1" className="card p-4 sm:p-6">
          <h2 id="step1" className="mb-4 flex items-center gap-2.5 font-semibold">
            <span className="inline-flex size-6 items-center justify-center rounded-full bg-action text-xs text-action-ink">1</span>
            Add your paper
          </h2>
          <TextSource value={text} onChange={setText} rows={18} label="Your text" />
        </section>

        <div className="space-y-4 lg:sticky lg:top-24">
          <section aria-labelledby="step2" className="card p-4 sm:p-6">
            <h2 id="step2" className="mb-4 flex items-center gap-2.5 font-semibold">
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-action text-xs text-action-ink">2</span>
              Choose checks
              <span className="ml-auto text-sm font-normal text-ink-faint">
                {selected} of {ORDER.length}
              </span>
            </h2>
            <fieldset className="space-y-2">
              <legend className="sr-only">Checks to run</legend>
              {ORDER.map((id) => (
                <Toggle key={id} checked={tools[id]} onChange={(v) => setTools((t) => ({ ...t, [id]: v }))} label={TOOL_LABEL[id]} hint={TOOL_HINT[id]} />
              ))}
            </fieldset>

            <details className="mt-4 rounded-lg border border-rule">
              <summary className="cursor-pointer px-3 py-2.5 font-semibold">More options</summary>
              <div className="space-y-4 border-t border-rule px-3 py-3">
                <fieldset className="space-y-3">
                  <legend className="sr-only">Outside services</legend>
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
            </details>

            <Button className="mt-5 h-12 w-full text-base" onClick={() => void go()} disabled={!text.trim() || selected === 0}>
              Check paper <ArrowRightIcon />
            </Button>
            <p className="mt-2 text-center text-sm text-ink-faint">
              {words ? `${words.toLocaleString("en")} words ready to check` : "Add your paper to start"}
            </p>
          </section>

          <p className="flex items-start gap-2 px-1 text-sm text-ink-soft">
            <ShieldIcon size={18} className="mt-0.5 shrink-0 text-ok" />
            Your paper is processed in memory and never stored. Only short passages are sent to search services, and only after you agree.
          </p>
        </div>
      </div>
    </div>
  );
}
