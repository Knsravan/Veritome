"use client";

import { useMemo, useState } from "react";
import { AnnotatedText, focusMark, focusNote, type TextMark } from "@/components/AnnotatedText";
import { useConsent } from "@/components/Consent";
import { TextSource } from "@/components/TextSource";
import { Button, Checkbox, Limits, Notice, ProofLayout, Sheet, ToolHeader, Warnings, cx } from "@/components/ui";
import type { GrammarCheckResult } from "@/core/grammar/check";
import type { Issue } from "@/core/grammar/types";
import { postJson } from "@/lib/api";
import { applyIssueFix } from "@/lib/fixes";
import { CATEGORY_LABEL, SEVERITY_LABEL } from "@/lib/grammar-labels";
import { useSettings } from "@/lib/settings";
import { useRun } from "@/lib/useRun";

export function GrammarTool() {
  const [text, setText] = useState("");
  const [doc, setDoc] = useState<{ text: string; issues: Issue[] } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "error" | "warning" | "info">("all");
  const { status } = useSettings();
  const consent = useConsent();
  const [usePublic, setUsePublic] = useState(true);
  const { result, error, busy, run } = useRun<GrammarCheckResult>();
  const publicOn = Boolean(status?.publicLanguageTool && usePublic);

  const go = async () => {
    if (publicOn && !(await consent("grammar"))) return;
    await run(async (signal) => {
      const r = await postJson<GrammarCheckResult>("/api/grammar", { text, publicLanguageTool: publicOn, consent: publicOn }, signal);
      setDoc({ text, issues: r.issues });
      return r;
    });
  };

  const visible = useMemo(() => (doc ? doc.issues.filter((i) => filter === "all" || i.severity === filter) : []), [doc, filter]);
  const marks: TextMark[] = visible.map((i) => ({
    id: i.id,
    start: i.start,
    end: i.end,
    className: cx("mark-grammar", i.severity === "info" && "is-info"),
    label: `${CATEGORY_LABEL[i.category]}: ${i.message}`,
  }));

  const fix = (issue: Issue, replacement: string) => {
    if (!doc) return;
    const next = applyIssueFix(doc.text, doc.issues, issue, replacement);
    setDoc(next);
    setText(next.text);
  };
  const ignore = (issue: Issue) => doc && setDoc({ ...doc, issues: doc.issues.filter((i) => i.id !== issue.id) });

  return (
    <div className="space-y-8">
      <ToolHeader
        title="Grammar and style"
        intro={
          <>
            Built-in checks for common academic-writing problems, frequent misspellings and readability
            {status?.languageTool ? ", plus the LanguageTool server connected here." : ", optionally with the public LanguageTool service for full grammar and spelling coverage."}
          </>
        }
      />
      <div className="max-w-4xl space-y-4">
        <TextSource value={text} onChange={setText} />
        {status?.publicLanguageTool && (
          <Checkbox
            checked={usePublic}
            onChange={setUsePublic}
            label="Also check with LanguageTool (recommended)"
            hint="Full grammar and spelling checking from the public LanguageTool service. Sends your text to LanguageTool; asks first."
          />
        )}
        <Button onClick={() => void go()} busy={busy} disabled={!text.trim()}>
          {busy ? "Checking" : doc ? "Check again" : "Check grammar"}
        </Button>
        {error && <Notice kind="error">{error}</Notice>}
      </div>
      {result && doc && (
        <ProofLayout
          sheet={
            <Sheet label="Your text with marked issues">
              {doc.text !== text && <p className="mb-3 text-sm text-warn">The text was edited after the check. Run it again to refresh the marks.</p>}
              <AnnotatedText
                text={doc.text}
                marks={marks}
                activeId={active}
                onSelect={(id) => {
                  setActive(id);
                  focusNote(id);
                }}
              />
            </Sheet>
          }
          margin={
            <>
              <section aria-labelledby="g-sum" className="space-y-2">
                <h2 id="g-sum" className="font-serif text-2xl font-semibold">
                  {doc.issues.length === 0 ? "No issues left" : `${doc.issues.length} issue${doc.issues.length === 1 ? "" : "s"}`}
                </h2>
                <p className="text-sm text-ink-soft">
                  {result.summary.issuesPer1000Words} per 1,000 words when checked. Readability: {result.metrics.level}, Flesch {result.metrics.fleschReadingEase},
                  grade {result.metrics.fleschKincaidGrade}. Average sentence {result.metrics.avgSentenceLength} words; {Math.round(result.metrics.passiveSentenceRatio * 100)}%
                  of sentences passive.
                </p>
                <div role="group" aria-label="Filter issues" className="flex flex-wrap gap-1">
                  {(["all", "error", "warning", "info"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={filter === f}
                      onClick={() => setFilter(f)}
                      className={cx("rounded border px-2.5 py-1 text-sm", filter === f ? "border-action bg-action text-action-ink" : "border-rule bg-page")}
                    >
                      {f === "all" ? "All" : SEVERITY_LABEL[f]} ({f === "all" ? doc.issues.length : doc.issues.filter((i) => i.severity === f).length})
                    </button>
                  ))}
                </div>
              </section>
              <Warnings items={result.warnings} />
              <ol className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
                {visible.map((i) => (
                  <li
                    key={i.id}
                    id={`note-${i.id}`}
                    tabIndex={-1}
                    className={cx("rounded border-l-4 border-grammar bg-page px-3 py-2 text-sm", active === i.id && "ring-2 ring-[var(--focus)]")}
                  >
                    <p className="text-xs text-ink-faint">
                      {SEVERITY_LABEL[i.severity]}, {CATEGORY_LABEL[i.category]}
                      {i.source === "languagetool" ? ", from LanguageTool" : ""}
                    </p>
                    <p className="mt-0.5">{i.message}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => focusMark(i.id)} className="font-serif underline decoration-grammar underline-offset-4">
                        “{i.text}”
                      </button>
                      {i.suggestions.slice(0, 3).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => fix(i, s)}
                          className="rounded border border-ok/60 bg-ok-soft px-2 py-0.5"
                          aria-label={s === "" ? `Delete “${i.text}”` : `Replace “${i.text}” with “${s}”`}
                        >
                          {s === "" ? "Delete" : s}
                        </button>
                      ))}
                      <button type="button" onClick={() => ignore(i)} className="ml-auto text-ink-faint underline-offset-4 hover:underline">
                        Ignore
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
              <Limits>
                <p>
                  The built-in rules favour precision over coverage, so they miss many errors a human editor would catch. Readability formulas were
                  designed for general prose and rate most research writing as difficult; compare drafts rather than chasing a number.
                </p>
              </Limits>
            </>
          }
        />
      )}
    </div>
  );
}
