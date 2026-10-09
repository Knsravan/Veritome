"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { DiffView } from "@/components/DiffView";
import { SeenBefore, useSavedCheck } from "@/components/HistoryBits";
import {
  ArrowRightIcon,
  BookIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  RepeatIcon,
  ShieldIcon,
  SparkIcon,
  XIcon,
} from "@/components/icons";
import { ParaphraseArt, SlidingChoice, StepSlider } from "@/components/motion-ui";
import { Button, Notice, Switch, cx } from "@/components/ui";
import {
  PARAPHRASE_STRENGTHS,
  PARAPHRASE_STYLES,
  type ParaphraseResult,
  type ParaphraseStrength,
  type ParaphraseStyle,
} from "@/core/rewrite/paraphrase";
import { splitParagraphs, splitSentences } from "@/core/text/sentences";
import { ApiError, postJson } from "@/lib/api";
import { saveCheck, titleFor } from "@/lib/history";
import { useSettings } from "@/lib/settings";
import { tidyPasted } from "../detector/tool";

const countWords = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;
const MAX_WORDS = 3_000;
const CONCURRENCY = 3;

interface Para {
  start: number;
  end: number;
  original: string;
  /** Too short to paraphrase (a heading, a label): kept as it is. */
  skip: boolean;
  state: "skip" | "waiting" | "working" | "done" | "failed";
  text: string;
  result?: ParaphraseResult;
  error?: string;
}

interface Run {
  input: string;
  style: ParaphraseStyle;
  strength: ParaphraseStrength;
  keep: string[];
  paras: Para[];
}

interface Pick {
  para: number;
  sentence: { start: number; end: number; text: string };
  word?: { start: number; end: number; text: string };
  x: number;
  y: number;
}

const outputOf = (run: Run) => {
  let out = "";
  let cursor = 0;
  for (const p of run.paras) {
    out += run.input.slice(cursor, p.start) + p.text;
    cursor = p.end;
  }
  return out + run.input.slice(cursor);
};

/** The word under the pointer, from the text node and offset the browser reports. */
function wordAt(e: MouseEvent, root: HTMLElement): { node: Text; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(e.clientX, e.clientY);
    if (p) {
      node = p.offsetNode;
      offset = p.offset;
    }
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null;
  return { node: node as Text, offset };
}

export function ParaphraserTool() {
  const [text, setText] = useState("");
  const [style, setStyle] = useState<ParaphraseStyle>("standard");
  const [strength, setStrength] = useState<ParaphraseStrength>("medium");
  const [keep, setKeep] = useState<string[]>([]);
  const [keepDraft, setKeepDraft] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [pick, setPick] = useState<Pick | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { status, llmFields } = useSettings();
  const ctrl = useRef<AbortController | null>(null);
  const out = useRef<HTMLDivElement>(null);
  const savedId = useRef<string | null>(null);
  const hasModel = Boolean(status?.llm);
  const words = countWords(text);

  useEffect(() => () => ctrl.current?.abort(), []);
  const opening = useSavedCheck("paraphraser", (entry) => {
    const p = entry.payload as Run | null;
    if (!p?.paras) return;
    savedId.current = entry.id;
    setText(p.input);
    setStyle(p.style);
    setStrength(p.strength);
    setKeep(p.keep ?? []);
    setRun(p);
  });

  // Finished results are saved to this browser's history, and kept up to date as words and sentences are swapped.
  useEffect(() => {
    if (!run || running) return;
    if (!run.paras.some((p) => p.state === "done")) return;
    const t = setTimeout(() => {
      void saveCheck({
        ...(savedId.current ? { id: savedId.current } : {}),
        tool: "paraphraser",
        title: titleFor(run.input),
        words: countWords(run.input),
        figures: [{ label: "Style", value: PARAPHRASE_STYLES.find((s) => s.id === run.style)?.label ?? run.style }],
        text: run.input,
        payload: run,
      }).then((id) => {
        if (id) savedId.current = id;
      });
    }, 800);
    return () => clearTimeout(t);
  }, [run, running]);

  const update = (i: number, patch: Partial<Para>) =>
    setRun((r) => (r ? { ...r, paras: r.paras.map((p, k) => (k === i ? { ...p, ...patch } : p)) } : r));

  const go = async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const input = text;
    setFatal(null);
    setNote(null);
    setPick(null);
    savedId.current = null;
    const paras: Para[] = splitParagraphs(input).map((p) => {
      const skip = countWords(p.text) < 4;
      return { start: p.start, end: p.end, original: p.text, skip, state: skip ? "skip" : "waiting", text: p.text };
    });
    const job: Run = { input, style, strength, keep, paras };
    setRun(job);
    setRunning(true);
    const queue = paras.map((p, i) => (p.skip ? -1 : i)).filter((i) => i >= 0);
    const worker = async () => {
      for (let i = queue.shift(); i !== undefined && !c.signal.aborted; i = queue.shift()) {
        update(i, { state: "working" });
        try {
          const result = await postJson<ParaphraseResult>(
            "/api/paraphrase",
            { action: "paraphrase", text: paras[i]!.original, style, strength, keep, ...llmFields() },
            c.signal,
          );
          update(i, { state: "done", result, text: result.text });
        } catch (err) {
          if (c.signal.aborted) return;
          const message = err instanceof Error ? err.message : "This paragraph could not be paraphrased.";
          update(i, { state: "failed", error: message });
          if (err instanceof ApiError && (err.status === 503 || err.status === 429)) {
            setFatal(message);
            c.abort();
          }
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (ctrl.current === c) setRunning(false);
  };

  const output = useMemo(() => (run ? outputOf(run) : ""), [run]);
  const changed = useMemo(() => {
    if (!run) return 0;
    const done = run.paras.filter((p) => p.state === "done");
    const total = done.reduce((t, p) => t + countWords(p.original), 0);
    return total ? done.reduce((t, p) => t + (p.result?.changed ?? 0) * countWords(p.original), 0) / total : 0;
  }, [run]);
  const todo = run?.paras.filter((p) => !p.skip).length ?? 0;
  const finished = run?.paras.filter((p) => p.state === "done" || p.state === "failed").length ?? 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setNote("The paraphrase is copied.");
    } catch {
      setNote("Copying is blocked in this browser.");
    }
  };
  const download = async () => {
    const { plainDocx } = await import("@/lib/doc/docx-revise");
    const blob = await plainDocx(output.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean));
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "paraphrase.docx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  /** Opens the word and sentence suggestions for what was clicked. */
  const open = (para: number, sentence: { start: number; end: number; text: string }, el: HTMLElement, e?: MouseEvent) => {
    const box = out.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    let word: Pick["word"];
    if (e && out.current) {
      const hit = wordAt(e, el);
      if (hit) {
        const s = hit.node.data;
        let a = hit.offset;
        let b = hit.offset;
        while (a > 0 && /[\p{L}\p{N}'’-]/u.test(s[a - 1]!)) a--;
        while (b < s.length && /[\p{L}\p{N}'’-]/u.test(s[b]!)) b++;
        // The text node holds the whole sentence; its offsets are the sentence's.
        if (b > a && /\p{L}/u.test(s.slice(a, b))) word = { start: a, end: b, text: s.slice(a, b) };
      }
    }
    const x = (e ? e.clientX : r.left) - (box?.left ?? 0);
    const y = (e ? Math.max(r.top, e.clientY - 10) : r.top) - (box?.top ?? 0) + (e ? 24 : r.height + 6);
    setPick({ para, sentence, ...(word ? { word } : {}), x, y });
  };

  const replaceIn = (i: number, start: number, end: number, by: string) => {
    if (!run) return;
    const p = run.paras[i]!;
    update(i, { text: p.text.slice(0, start) + by + p.text.slice(end) });
    setPick(null);
  };

  if (opening === "loading") return <p className="text-ink-soft">Opening your saved paraphrase…</p>;

  return (
    <div className="space-y-8">
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
        <header className="max-w-3xl">
          <p className="animate-fade-up text-sm font-semibold tracking-wide text-action uppercase">Paraphraser</p>
          <h1
            className="animate-fade-up mt-2 font-display text-3xl font-bold tracking-tight sm:text-[2.6rem] sm:leading-[1.1]"
            style={{ ["--i" as string]: 1 }}
          >
            Say it another way, and keep what it means
          </h1>
          <p className="animate-fade-up mt-3 text-lg text-ink-soft" style={{ ["--i" as string]: 2 }}>
            Rewords your text in the style you choose. Citations, numbers and the words you lock stay exactly as they are, and each
            paragraph is checked for a change in meaning. Click any word for synonyms, or any sentence for other ways to say it.
          </p>
        </header>
        <div className="hidden pr-6 lg:block">
          <ParaphraseArt />
        </div>
      </div>

      {opening === "missing" && (
        <Notice kind="warn" title="That saved paraphrase is no longer here">
          It may have been deleted from your history, or saved in another browser.
        </Notice>
      )}
      <SeenBefore tool="paraphraser" text={text} />
      {status && !hasModel && (
        <Notice kind="warn" title="The Paraphraser is not switched on yet">
          It needs a language model, and none is set up on this server.
        </Notice>
      )}

      <section aria-label="Settings" className="card animate-fade-up space-y-4 p-4 sm:p-5" style={{ ["--i" as string]: 3 }}>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <SlidingChoice
            kind="radios"
            label="Style"
            value={style}
            onChange={setStyle}
            options={PARAPHRASE_STYLES.map((s) => ({ id: s.id, label: s.label, title: s.description }))}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:items-center">
          <div>
            <p className="mb-1.5 text-sm font-semibold" id="pp-strength-label">
              Strength
            </p>
            <StepSlider
              id="pp-strength"
              label="Strength"
              value={strength}
              onChange={setStrength}
              options={PARAPHRASE_STRENGTHS.map((s) => ({ id: s.id, label: s.label }))}
            />
            <p key={strength} className="animate-swap mt-1.5 text-xs text-ink-soft">
              {PARAPHRASE_STRENGTHS.find((s) => s.id === strength)?.description}
            </p>
          </div>
          <div>
            <label htmlFor="pp-keep" className="text-sm font-semibold">
              Words to keep as they are <span className="font-normal text-ink-faint">(optional)</span>
            </label>
            <div className="neu-in mt-1.5 flex flex-wrap items-center gap-1.5 rounded-xl px-2 py-1.5 focus-within:ring-2 focus-within:ring-action/40">
              {keep.map((k) => (
                <span key={k} className="animate-pop inline-flex items-center gap-1 rounded-full bg-action-soft px-2.5 py-0.5 text-sm font-medium text-action">
                  {k}
                  <button type="button" aria-label={`Stop keeping ${k}`} onClick={() => setKeep((ks) => ks.filter((x) => x !== k))}>
                    <XIcon size={12} />
                  </button>
                </span>
              ))}
              <input
                id="pp-keep"
                value={keepDraft}
                onChange={(e) => setKeepDraft(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                  if ((e.key === "Enter" || e.key === ",") && keepDraft.trim()) {
                    e.preventDefault();
                    const t = keepDraft.trim().slice(0, 80);
                    setKeep((ks) => (ks.includes(t) || ks.length >= 30 ? ks : [...ks, t]));
                    setKeepDraft("");
                  } else if (e.key === "Backspace" && !keepDraft && keep.length) setKeep((ks) => ks.slice(0, -1));
                }}
                placeholder={keep.length ? "Add another" : "e.g. quantum key distribution, BB84 — press Enter"}
                className="min-w-[10rem] flex-1 bg-transparent px-1 py-0.5 text-sm shadow-none focus:outline-none"
              />
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Your text" className="card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3">
            <label htmlFor="pp-text" className="font-semibold">
              Your text
            </label>
            <div className="flex items-center gap-3 text-sm">
              <span className={cx("rounded-full px-2.5 py-0.5 font-semibold tabular-nums", words > MAX_WORDS ? "bg-danger-soft text-danger" : "bg-desk-deep text-ink-soft")}>
                {words.toLocaleString("en")} / {MAX_WORDS.toLocaleString("en")} words
              </span>
              <button type="button" onClick={() => setText("")} disabled={!text} className="font-semibold text-ink-soft hover:text-ink disabled:opacity-40">
                Clear
              </button>
            </div>
          </div>
          <textarea
            id="pp-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text/plain");
              if (!pasted || !/\n/.test(pasted)) return;
              e.preventDefault();
              const el = e.currentTarget;
              setText((text.slice(0, el.selectionStart) + tidyPasted(pasted) + text.slice(el.selectionEnd)).slice(0, 60_000));
            }}
            placeholder="Paste or type the text to paraphrase. Separate paragraphs with a blank line."
            spellCheck={false}
            className="block min-h-[22rem] w-full flex-1 resize-y bg-page px-5 py-4 font-serif text-[1.05rem] leading-[1.75] placeholder:font-sans placeholder:text-base placeholder:text-ink-faint focus:outline-none"
          />
          <div className="flex items-center justify-end gap-3 border-t border-rule bg-desk/40 px-5 py-3">
            {running && (
              <Button variant="secondary" onClick={() => { ctrl.current?.abort(); setRunning(false); }}>
                <XIcon size={16} /> Stop
              </Button>
            )}
            <Button
              className="btn-shine h-11 px-6"
              disabled={!hasModel || running || words < 4 || words > MAX_WORDS}
              busy={running}
              onClick={() => void go()}
            >
              <SparkIcon size={17} /> {run && !running ? "Paraphrase again" : "Paraphrase"} <ArrowRightIcon />
            </Button>
          </div>
        </section>

        <section aria-label="Paraphrase" className="card relative flex flex-col overflow-visible">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3">
            <h2 className="font-semibold">Paraphrase</h2>
            {run && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5 font-medium">
                  <Switch checked={showChanges} onChange={setShowChanges} label="Show changes" />
                  Show changes
                </label>
                <span className="rounded-full bg-action-soft px-2.5 py-0.5 font-semibold tabular-nums text-action" aria-live="polite">
                  {Math.round(changed * 100)}% reworded
                </span>
              </div>
            )}
          </div>
          {running && (
            <div className="h-1 bg-desk-deep" aria-hidden>
              <div className="progress-shimmer h-full bg-action transition-[width] duration-500" style={{ width: `${todo ? (finished / todo) * 100 : 0}%` }} />
            </div>
          )}
          <div ref={out} className="relative min-h-[22rem] flex-1 px-5 py-4">
            {!run ? (
              <div className="flex h-full min-h-[20rem] flex-col items-center justify-center gap-3 text-center text-ink-faint">
                <span className="grid size-14 place-items-center rounded-2xl bg-action-soft text-action">
                  <RepeatIcon size={26} />
                </span>
                <p className="max-w-xs text-sm">Your paraphrase appears here. Then click any word for synonyms, or any sentence for other ways to say it.</p>
              </div>
            ) : (
              <div className="space-y-4 font-serif text-[1.05rem] leading-[1.75]">
                {run.paras.map((p, i) =>
                  p.state === "skip" ? (
                    <p key={i} className="font-sans font-semibold">
                      {p.text}
                    </p>
                  ) : p.state === "waiting" || p.state === "working" ? (
                    <p key={i} className={cx("text-ink-faint", p.state === "working" && "animate-pulse")}>
                      {p.original}
                    </p>
                  ) : p.state === "failed" ? (
                    <div key={i}>
                      <p className="text-ink-soft">{p.original}</p>
                      <p className="font-sans text-xs text-danger">{p.error}</p>
                    </div>
                  ) : showChanges ? (
                    <div key={i} className="animate-reveal">
                      <DiffView before={p.original} after={p.text} />
                    </div>
                  ) : (
                    <p key={`${i}-${p.text.length}`} className="animate-reveal">
                      {splitSentences(p.text).map((s, k) => (
                        <span key={k}>
                          {k > 0 && " "}
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label={`Sentence ${k + 1}: other ways to say it`}
                            onClick={(e) => open(i, s, e.currentTarget, e)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                open(i, s, e.currentTarget);
                              }
                            }}
                            className={cx(
                              "cursor-pointer rounded-sm decoration-action/50 decoration-2 underline-offset-4 transition-colors hover:bg-action-soft/70 hover:underline focus-visible:bg-action-soft",
                              pick?.para === i && pick.sentence.start === s.start && "bg-action-soft",
                            )}
                          >
                            {s.text}
                          </span>
                        </span>
                      ))}
                      {p.result?.status === "kept_original" && (
                        <span className="mt-1 block font-sans text-xs text-ink-soft">
                          Kept as it was: every attempt changed the meaning or a number.
                        </span>
                      )}
                    </p>
                  ),
                )}
              </div>
            )}
            {pick && run && (
              <Suggestions
                key={`${pick.para}-${pick.sentence.start}-${pick.word?.start ?? -1}`}
                pick={pick}
                context={run.paras[pick.para]!.text}
                style={run.style}
                keep={run.keep}
                llmFields={llmFields}
                onClose={() => setPick(null)}
                onWord={(w) => pick.word && replaceIn(pick.para, pick.sentence.start + pick.word.start, pick.sentence.start + pick.word.end, w)}
                onSentence={(t) => replaceIn(pick.para, pick.sentence.start, pick.sentence.end, t)}
              />
            )}
          </div>
          {run && !running && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule bg-desk/40 px-5 py-3">
              <p className="text-sm text-ink-soft" role="status">
                {note ?? `${countWords(output).toLocaleString("en")} words`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="glow" onClick={() => void copy()}>
                  <CopyIcon size={16} /> Copy
                </Button>
                <Button variant="pillow" onClick={() => void download()}>
                  <DownloadIcon size={16} /> Word file
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>

      {fatal && (
        <Notice kind="error" title="The Paraphraser stopped">
          {fatal}
        </Notice>
      )}

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Good practice">
        {(
          [
            [BookIcon, "Cite the source", "If the ideas come from someone else's work, cite it. A paraphrase without a citation is still plagiarism."],
            [ShieldIcon, "Locked and checked", "Citations, numbers and your locked words never change, and a second pass checks each paragraph means the same."],
            [CheckIcon, "Read every line", "Paraphrasing can shift a meaning in ways a check cannot catch. Read the result before you use it."],
          ] as const
        ).map(([Icon, title, body], k) => (
          <div key={title} className="card animate-fade-up flex gap-3 p-4" style={{ ["--i" as string]: k + 4 }}>
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-action-soft text-action">
              <Icon size={18} />
            </span>
            <span>
              <span className="block font-semibold">{title}</span>
              <span className="text-sm text-ink-soft">{body}</span>
            </span>
          </div>
        ))}
      </section>
      <p className="text-sm text-ink-soft">
        Want to be sure it is your own wording now?{" "}
        <Link href="/plagiarism" className="font-semibold text-action underline">
          Run a plagiarism check
        </Link>
        .
      </p>
    </div>
  );
}

/** The pop-up for a clicked word and its sentence: synonyms for the word, and other ways to say the sentence. */
function Suggestions({
  pick,
  context,
  style,
  keep,
  llmFields,
  onClose,
  onWord,
  onSentence,
}: {
  pick: Pick;
  context: string;
  style: ParaphraseStyle;
  keep: string[];
  llmFields: () => Record<string, unknown>;
  onClose: () => void;
  onWord: (w: string) => void;
  onSentence: (t: string) => void;
}) {
  const [synonyms, setSynonyms] = useState<string[] | null>(pick.word ? null : []);
  const [alternatives, setAlternatives] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = new AbortController();
    if (pick.word)
      postJson<{ options: string[] }>("/api/paraphrase", { action: "synonyms", word: pick.word.text, sentence: pick.sentence.text, ...llmFields() }, c.signal)
        .then((r) => setSynonyms(r.options))
        .catch(() => !c.signal.aborted && setSynonyms([]));
    postJson<{ options: string[] }>(
      "/api/paraphrase",
      { action: "alternatives", sentence: pick.sentence.text, context, style, keep, ...llmFields() },
      c.signal,
    )
      .then((r) => setAlternatives(r.options))
      .catch((err) => {
        if (c.signal.aborted) return;
        setAlternatives([]);
        setError(err instanceof Error ? err.message : "Suggestions could not be made.");
      });
    return () => c.abort();
    // Fetched once per pick (the component is keyed by it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[role="button"]')) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  const loading = (n: number) => (
    <div className="space-y-1.5" aria-label="Loading">
      {Array.from({ length: n }, (_, k) => (
        <div key={k} className="h-3.5 animate-pulse rounded bg-desk-deep" style={{ width: `${90 - k * 15}%` }} />
      ))}
    </div>
  );

  return (
    <div
      ref={box}
      role="dialog"
      aria-label="Suggestions"
      className="animate-pop absolute z-30 w-[min(24rem,calc(100%-1.5rem))] space-y-3 rounded-2xl border border-[var(--neu-edge)] bg-page p-4 font-sans text-sm shadow-[var(--shadow-lift)]"
      style={{ left: `clamp(0.75rem, ${pick.x - 160}px, calc(100% - min(24rem, 100% - 1.5rem) - 0.75rem))`, top: pick.y }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">{pick.word ? <>Instead of “{pick.word.text}”</> : "Other ways to say this sentence"}</p>
        <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-0.5 text-ink-soft hover:bg-desk-deep">
          <XIcon size={15} />
        </button>
      </div>
      {pick.word && (
        <div>
          {synonyms === null ? (
            loading(1)
          ) : synonyms.length ? (
            <div className="flex flex-wrap gap-1.5">
              {synonyms.map((w) => (
                <button key={w} type="button" onClick={() => onWord(w)} className="neu-sm rounded-full px-2.5 py-1 font-medium transition-[box-shadow,color] hover:text-action active:shadow-[var(--neu-in)]">
                  {w}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-ink-soft">No good replacements for this word here.</p>
          )}
        </div>
      )}
      <div>
        {pick.word && <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-faint uppercase">Rephrase the sentence</p>}
        {alternatives === null ? (
          loading(3)
        ) : alternatives.length ? (
          <ul className="space-y-1.5">
            {alternatives.map((t) => (
              <li key={t}>
                <button type="button" onClick={() => onSentence(t)} className="w-full rounded-lg border border-rule px-3 py-2 text-left font-serif leading-snug hover:border-action hover:bg-action-soft/60">
                  {t}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-soft">{error ?? "No other versions passed the checks this time."}</p>
        )}
      </div>
    </div>
  );
}
