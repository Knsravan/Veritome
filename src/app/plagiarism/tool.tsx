"use client";

import { useEffect, useRef, useState } from "react";
import { useConsent } from "@/components/Consent";
import { ArrowLeftIcon, ArrowRightIcon, ShieldIcon } from "@/components/icons";
import { LibraryPicker, type LibraryItem } from "@/components/LibraryPicker";
import { PlagiarismResultView } from "@/components/PlagiarismResultView";
import { TextSource } from "@/components/TextSource";
import { Button, Checkbox, Notice } from "@/components/ui";
import type { DetectorResult } from "@/core/detector/types";
import type { PlagiarismReport } from "@/core/plagiarism/types";
import { ApiError, postJson, postNdjson } from "@/lib/api";
import { useSettings } from "@/lib/settings";

type Event = { type: "step"; done: number; total: number } | { type: "result"; report: PlagiarismReport } | { type: "error"; error: string };

function Progress({ done, total, onCancel }: { done: number; total: number; onCancel: () => void }) {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <section aria-labelledby="pl-progress" className="card mx-auto max-w-xl p-6 sm:p-8">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="pl-progress" className="font-display text-2xl font-semibold">
          Searching for matching text
        </h2>
        <span className="text-sm text-ink-faint tabular-nums">{s}s</span>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        {total ? `${done} of ${total} searches done.` : "Choosing distinctive passages to search for…"} Every source found is then compared with all of your text.
      </p>
      <div role="progressbar" aria-label="Search progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="mt-5 h-2 overflow-hidden rounded-full bg-desk-deep">
        <div className="h-full rounded-full bg-action transition-[width] duration-500" style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
      <div className="mt-6 flex items-center justify-between gap-4 border-t border-rule pt-4">
        <p className="text-sm text-ink-faint">Usually under two minutes. Your text is not stored.</p>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

export function PlagiarismTool() {
  const [text, setText] = useState("");
  const [checked, setChecked] = useState("");
  const [external, setExternal] = useState(true);
  const [excludeQuotes, setExcludeQuotes] = useState(true);
  const [excludeReferences, setExcludeReferences] = useState(true);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [result, setResult] = useState<PlagiarismReport | null>(null);
  const [checkAi, setCheckAi] = useState(true);
  const [ai, setAi] = useState<DetectorResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<{ done: number; total: number } | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const { settings, update, status } = useSettings();
  const consent = useConsent();
  const web = status?.webSearch ?? [];

  useEffect(() => () => ctrl.current?.abort(), []);
  const phase = step ? "running" : result ? "done" : "compose";
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [phase]);

  const go = async () => {
    if (external && !(await consent("plagiarism"))) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setError(null);
    setResult(null);
    setAi(null);
    setStep({ done: 0, total: 0 });
    // The AI check runs on this server only (no language model), alongside the search; it does not need consent.
    const aiCheck = checkAi ? postJson<DetectorResult>("/api/detect", { text, useLlm: false }, c.signal).catch(() => null) : Promise.resolve(null);
    setChecked(text);
    let report: PlagiarismReport | null = null;
    try {
      await postNdjson<Event>(
        "/api/plagiarism",
        { text, external, consent: external, web: settings.webSearch, excludeQuotes, excludeReferences, library, stream: true },
        (ev) => {
          if (ev.type === "step") setStep({ done: ev.done, total: ev.total });
          else if (ev.type === "result") report = ev.report;
          else throw new ApiError(ev.error, 500);
        },
        c.signal,
      );
      if (c.signal.aborted) return;
      if (!report) throw new ApiError("The check stopped before it finished. Try again.", 0);
      setAi(await aiCheck);
      setResult(report);
    } catch (err) {
      if (!c.signal.aborted) setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      if (ctrl.current === c) setStep(null);
    }
  };

  if (step) {
    return (
      <Progress
        done={step.done}
        total={step.total}
        onCancel={() => {
          ctrl.current?.abort();
          setStep(null);
        }}
      />
    );
  }

  if (result && checked) {
    return (
      <article aria-labelledby="pl-result" className="space-y-6">
        <header className="flex flex-col gap-4 border-b border-rule pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <button type="button" onClick={() => setResult(null)} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-action hover:underline print:hidden">
              <ArrowLeftIcon size={16} /> New check
            </button>
            <p className="text-sm font-semibold tracking-wide text-ink-faint uppercase">Veritome plagiarism report</p>
            <h1 id="pl-result" className="mt-1 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Similarity report
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              {result.words.toLocaleString("en")} words checked · {new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
        </header>
        <PlagiarismResultView text={checked} report={result} ai={ai} />
      </article>
    );
  }

  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Plagiarism check</h1>
        <p className="mt-2 text-lg text-ink-soft">
          Finds passages that match published papers, the web or your own documents, checks how much reads as AI-written, and shows you exactly what to fix.
        </p>
      </header>
      {error && (
        <Notice kind="error" title="The check did not finish">
          {error}
        </Notice>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="card p-4 sm:p-6" aria-label="Your paper">
          <TextSource value={text} onChange={setText} rows={16} />
        </section>
        <div className="space-y-4 lg:sticky lg:top-24">
          <section className="card space-y-5 p-4 sm:p-6" aria-label="Options">
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
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="font-semibold">Also check</legend>
              <Checkbox
                checked={checkAi}
                onChange={setCheckAi}
                label="AI writing"
                hint="Shows how much of the text reads as AI-written. Runs on this server; nothing extra is sent anywhere."
              />
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="font-semibold">Leave out of the score</legend>
              <Checkbox checked={excludeQuotes} onChange={setExcludeQuotes} label="Quotations" hint="Quoted passages of 40 characters or more. They are still checked for a citation." />
              <Checkbox checked={excludeReferences} onChange={setExcludeReferences} label="Reference list" />
            </fieldset>
            <LibraryPicker items={library} onChange={setLibrary} serverCount={status?.libraryDocuments ?? 0} />
            <Button className="h-12 w-full text-base" onClick={() => void go()} disabled={!text.trim()}>
              Check for overlap <ArrowRightIcon />
            </Button>
            {!external && library.length === 0 && (status?.libraryDocuments ?? 0) === 0 && (
              <Notice kind="warn">With no sources selected, only repetition inside your own text is checked.</Notice>
            )}
          </section>
          <p className="flex items-start gap-2 px-1 text-sm text-ink-soft">
            <ShieldIcon size={18} className="mt-0.5 shrink-0 text-ok" />
            Only short passages are sent to search services, and only after you agree. Nothing is stored.
          </p>
        </div>
      </div>
    </div>
  );
}
