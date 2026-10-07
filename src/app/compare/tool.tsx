"use client";

import { useMemo, useRef, useState, type DragEvent } from "react";
import { focusMark } from "@/components/AnnotatedText";
import { DocumentView } from "@/components/DocumentView";
import { ArrowRightIcon, FileIcon, ShieldIcon, UploadIcon, XIcon } from "@/components/icons";
import { Button, Limits, Notice, Sheet, ToolHeader, cx } from "@/components/ui";
import { comparePapers, type CompareResult, type PairResult } from "@/core/plagiarism/compare";
import { latexToText } from "@/core/text/latex";
import { readDocument } from "@/lib/doc";
import type { DocModel } from "@/lib/doc/model";

interface Paper {
  id: string;
  name: string;
  text: string;
  doc: DocModel | null;
}

const words = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;
const pct = (n: number) => `${Math.round(n)}%`;
/** Overlap at or above this share of either paper is worth a look. */
const FLAG = 10;

async function readFile(file: File): Promise<Paper> {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const id = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`;
  const name = file.name.replace(/\.[^.]+$/, "");
  if (ext === "docx" || ext === "pdf") {
    const doc = await readDocument(file);
    if (!doc || doc.text.replace(/\s/g, "").length < 50) throw new Error(`${file.name}: no readable text was found.`);
    return { id, name, text: doc.text, doc };
  }
  if (ext === "txt" || ext === "md" || ext === "tex") {
    const raw = await file.text();
    return { id, name, text: ext === "tex" ? latexToText(raw) : raw.replace(/\r\n?/g, "\n"), doc: null };
  }
  throw new Error(`${file.name}: use .docx, .pdf, .txt, .md or .tex files.`);
}

/** Cell shade for an overlap: one hue, darker for more shared text, so the grid reads at a glance. */
function shade(p: number): string {
  const k = Math.min(1, p / 50);
  // Capped at 70% so the number on top keeps at least 5:1 contrast in both themes.
  return `color-mix(in srgb, var(--chart-seq) ${Math.round(8 + k * 62)}%, var(--page))`;
}

function Matrix({ result, onPick, active }: { result: CompareResult; onPick: (p: PairResult) => void; active: PairResult | null }) {
  const byKey = new Map(result.pairs.map((p) => [`${p.a}|${p.b}`, p]));
  const pair = (a: string, b: string) => byKey.get(`${a}|${b}`) ?? byKey.get(`${b}|${a}`);
  const papers = result.papers;
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-sm">
        <caption className="sr-only">Share of text each pair of papers has in common. Select a cell to compare the two papers.</caption>
        <thead>
          <tr>
            <th scope="col" className="sr-only">
              Paper
            </th>
            {papers.map((p) => (
              <th key={p.id} scope="col" className="h-28 w-11 align-bottom font-medium text-ink-soft">
                <span className="block max-h-28 truncate [writing-mode:vertical-rl] rotate-180" title={p.name}>
                  {p.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {papers.map((row, i) => (
            <tr key={row.id}>
              <th scope="row" className="max-w-40 truncate pr-2 text-right font-medium text-ink-soft" title={row.name}>
                {row.name}
              </th>
              {papers.map((col, j) => {
                if (i === j) return <td key={col.id} aria-hidden className="size-11 rounded-md bg-desk-deep/60" />;
                const p = pair(row.id, col.id)!;
                const v = Math.max(p.aPercent, p.bPercent);
                const on = active === p;
                return (
                  <td key={col.id} className="p-0">
                    <button
                      type="button"
                      onClick={() => onPick(p)}
                      aria-label={`${row.name} and ${col.name}: ${pct(v)} shared`}
                      aria-pressed={on}
                      className={cx(
                        "animate-fade-in size-11 rounded-md text-xs font-semibold tabular-nums transition-transform duration-150 hover:scale-110 hover:shadow-md",
                        on && "ring-2 ring-ink ring-offset-2 ring-offset-page",
                      )}
                      style={{ background: v > 0 ? shade(v) : "var(--desk)", color: "var(--ink)", ["--i" as string]: i + j }}
                    >
                      {v >= 1 ? Math.round(v) : ""}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 flex items-center gap-2 text-xs text-ink-faint">
        <span>0%</span>
        <span aria-hidden className="h-2 w-32 rounded-full" style={{ background: `linear-gradient(to right, ${shade(0)}, ${shade(50)})` }} />
        <span>50% or more of a paper shared</span>
      </p>
    </div>
  );
}

function PairDetail({ pair, papers }: { pair: PairResult; papers: Map<string, Paper> }) {
  const A = papers.get(pair.a)!;
  const B = papers.get(pair.b)!;
  const left = pair.passages.map((p, k) => ({ id: `L${k}`, start: p.aStart, end: p.aEnd, className: "mark-match", label: `Shared passage ${k + 1}`, group: (k % 6) + 1 }));
  const right = pair.passages.map((p, k) => ({ id: `R${k}`, start: p.bStart, end: p.bEnd, className: "mark-match", label: `Shared passage ${k + 1}`, group: (k % 6) + 1 }));
  const [active, setActive] = useState<string | null>(null);
  const pick = (id: string) => {
    const k = id.slice(1);
    const other = id.startsWith("L") ? `R${k}` : `L${k}`;
    setActive(id);
    requestAnimationFrame(() => focusMark(other));
  };
  return (
    <section aria-label="Pair comparison" className="animate-fade-up space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="font-semibold">
          {A.name} and {B.name}: {pair.passages.length} shared passage{pair.passages.length === 1 ? "" : "s"}, {pair.sharedWords.toLocaleString("en")} words
        </p>
        <p className="text-sm text-ink-soft">
          {pct(pair.aPercent)} of {A.name}&rsquo;s paper · {pct(pair.bPercent)} of {B.name}&rsquo;s. Select a passage to find it in the other paper.
        </p>
      </div>
      {pair.passages.length === 0 ? (
        <Notice kind="ok">These two papers share no passages of the chosen length.</Notice>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {[
            [A, left],
            [B, right],
          ].map(([p, marks]) => (
            <Sheet key={(p as Paper).id} label={(p as Paper).name}>
              <p className="mb-3 font-display text-lg font-semibold">{(p as Paper).name}</p>
              <div className="max-h-[70vh] overflow-y-auto pr-2">
                <DocumentView doc={(p as Paper).doc} text={(p as Paper).text} marks={marks as typeof left} activeId={active} onSelect={pick} />
              </div>
            </Sheet>
          ))}
        </div>
      )}
    </section>
  );
}

/** Compares a set of papers (such as a class's submissions) with each other, in the browser. */
export function CompareTool() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [ignore, setIgnore] = useState("");
  const [minRun, setMinRun] = useState(8);
  const [reading, setReading] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [pair, setPair] = useState<PairResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);

  const add = async (files: FileList | File[]) => {
    const list = [...files];
    setReading((n) => n + list.length);
    const errs: string[] = [];
    for (const f of list) {
      try {
        const p = await readFile(f);
        setPapers((ps) => [...ps, p]);
      } catch (e) {
        errs.push(e instanceof Error ? e.message : `${f.name} could not be read.`);
      } finally {
        setReading((n) => n - 1);
      }
    }
    setErrors(errs);
    setResult(null);
    setPair(null);
  };

  const run = async () => {
    setProgress(0);
    setPair(null);
    const r = await comparePapers(
      papers.map((p) => ({ id: p.id, name: p.name, text: p.text })),
      { ignore, minRun, yieldEvery: 3, onProgress: (d, t) => setProgress(Math.round((d / t) * 100)) },
    );
    setResult(r);
    setProgress(null);
    const top = r.pairs[0];
    if (top && Math.max(top.aPercent, top.bPercent) >= FLAG) setPair(top);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) void add(e.dataTransfer.files);
  };
  const flagged = result?.pairs.filter((p) => Math.max(p.aPercent, p.bPercent) >= FLAG) ?? [];

  return (
    <div className="space-y-8">
      <ToolHeader
        title="Compare papers"
        intro="For teachers and supervisors: add a class's papers and see which ones share text with each other, and exactly where. Everything runs in your browser; no paper is uploaded."
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Papers to compare" className="card animate-fade-up space-y-4 p-4 sm:p-6 [--i:2]">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cx(
              "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
              dragging ? "border-action bg-action-soft" : "border-rule",
            )}
          >
            <span className="inline-flex size-12 items-center justify-center rounded-full bg-action-soft text-action">
              <UploadIcon size={22} />
            </span>
            <p className="font-semibold">Drop the papers here</p>
            <p className="text-sm text-ink-faint">Word (.docx), PDF, LaTeX, Markdown or plain text. Two or more.</p>
            <Button variant="secondary" onClick={() => input.current?.click()}>
              <FileIcon /> Choose files
            </Button>
            <input
              ref={input}
              type="file"
              multiple
              accept=".docx,.pdf,.txt,.md,.tex"
              className="sr-only"
              aria-label="Add papers"
              onChange={(e) => {
                if (e.target.files?.length) void add(e.target.files);
                e.target.value = "";
              }}
            />
            {reading > 0 && <p className="text-sm text-action">Reading {reading} file{reading === 1 ? "" : "s"}…</p>}
          </div>
          {errors.map((e) => (
            <Notice key={e} kind="error">
              {e}
            </Notice>
          ))}
          {papers.length > 0 && (
            <ul className="divide-y divide-rule rounded-xl border border-rule">
              {papers.map((p, i) => (
                <li key={p.id} className="animate-fade-in flex items-center gap-3 px-3 py-2 text-sm" style={{ ["--i" as string]: i }}>
                  <FileIcon size={16} className="shrink-0 text-ink-faint" />
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  <span className="text-ink-faint tabular-nums">{words(p.text).toLocaleString("en")} words</span>
                  <button
                    type="button"
                    aria-label={`Remove ${p.name}`}
                    className="rounded p-1 text-ink-faint hover:bg-desk hover:text-ink"
                    onClick={() => {
                      setPapers((ps) => ps.filter((x) => x.id !== p.id));
                      setResult(null);
                      setPair(null);
                    }}
                  >
                    <XIcon size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Options" className="card animate-fade-up space-y-4 p-4 sm:p-6 lg:sticky lg:top-24 [--i:3]">
          <label className="block">
            <span className="font-semibold">Text to leave out</span>
            <span className="block text-sm text-ink-faint">Optional. Paste the assignment&rsquo;s questions or any text every student was given.</span>
            <textarea value={ignore} onChange={(e) => setIgnore(e.target.value)} rows={4} className="mt-1.5 w-full rounded-lg border border-rule bg-page px-3 py-2 text-sm" />
          </label>
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="font-semibold">Shortest shared passage</span>
            <select value={minRun} onChange={(e) => setMinRun(Number(e.target.value))} className="rounded-md border border-rule bg-page px-2 py-1">
              <option value={6}>6 words</option>
              <option value={8}>8 words</option>
              <option value={12}>12 words</option>
              <option value={20}>20 words</option>
            </select>
          </label>
          <Button className="h-12 w-full text-base" disabled={papers.length < 2 || reading > 0 || progress !== null} onClick={() => void run()}>
            {progress !== null ? `Comparing… ${progress}%` : `Compare ${papers.length || ""} papers`} <ArrowRightIcon />
          </Button>
          {progress !== null && (
            <div role="progressbar" aria-label="Comparing papers" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-desk-deep">
              <div className="progress-shimmer h-full rounded-full bg-action transition-[width] duration-300" style={{ width: `${Math.max(3, progress)}%` }} />
            </div>
          )}
          <p className="flex items-start gap-2 text-sm text-ink-soft">
            <ShieldIcon size={18} className="mt-0.5 shrink-0 text-ok" /> Papers stay on this computer. Nothing is sent or stored.
          </p>
        </section>
      </div>

      {result && (
        <div className="space-y-8">
          <section aria-labelledby="cmp-sum" className="card animate-fade-up p-5 sm:p-6">
            <h2 id="cmp-sum" className="font-display text-2xl font-semibold">
              {flagged.length === 0
                ? `No pair shares more than ${FLAG}% of its text`
                : `${flagged.length} pair${flagged.length === 1 ? "" : "s"} share${flagged.length === 1 ? "s" : ""} ${FLAG}% or more of their text`}
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              {result.papers.length} papers, {result.pairs.length} pairs compared word for word ({minRun}+ words in a row, reference lists left out). Shared text can be
              legitimate (a quotation both cite, a shared dataset description), so read each pair before deciding anything.
            </p>
          </section>

          <div className="grid items-start gap-6 xl:grid-cols-[auto_minmax(0,1fr)]">
            {result.papers.length <= 40 && (
              <section aria-labelledby="cmp-grid" className="card animate-fade-up p-5">
                <h2 id="cmp-grid" className="mb-3 font-semibold">
                  Who shares text with whom
                </h2>
                <Matrix result={result} onPick={setPair} active={pair} />
              </section>
            )}
            <section aria-labelledby="cmp-list" className="card animate-fade-up p-5">
              <h2 id="cmp-list" className="mb-3 font-semibold">
                Pairs with the most shared text
              </h2>
              <ol className="space-y-2">
                {result.pairs
                  .filter((p) => p.sharedWords > 0)
                  .slice(0, 15)
                  .map((p) => {
                    const v = Math.max(p.aPercent, p.bPercent);
                    return (
                      <li key={`${p.a}|${p.b}`}>
                        <button
                          type="button"
                          onClick={() => setPair(p)}
                          aria-pressed={pair === p}
                          className={cx("w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-desk", pair === p && "bg-action-soft")}
                        >
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="min-w-0 truncate font-semibold">
                              {byId.get(p.a)?.name} &amp; {byId.get(p.b)?.name}
                            </span>
                            <span className="font-semibold tabular-nums">{pct(v)}</span>
                          </span>
                          <span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded-full bg-desk-deep">
                            <span className="animate-grow-x block h-full rounded-full" style={{ width: `${Math.min(100, v * 2)}%`, background: "var(--chart-seq)" }} />
                          </span>
                          <span className="mt-1 block text-xs text-ink-faint">
                            {p.passages.length} passage{p.passages.length === 1 ? "" : "s"}, {p.sharedWords} words
                          </span>
                        </button>
                      </li>
                    );
                  })}
                {result.pairs.every((p) => p.sharedWords === 0) && <li className="text-sm text-ink-soft">No two papers share a passage of {minRun} words or more.</li>}
              </ol>
            </section>
          </div>

          {pair && <PairDetail key={`${pair.a}|${pair.b}`} pair={pair} papers={byId} />}

          <Limits>
            <p>
              This compares the papers you add with each other only. To check each one against published sources and the web, use the Plagiarism check on it.
            </p>
            <p>Text that was reworded or translated between papers is not found here; only passages shared word for word (with small edits) are.</p>
          </Limits>
        </div>
      )}
    </div>
  );
}
