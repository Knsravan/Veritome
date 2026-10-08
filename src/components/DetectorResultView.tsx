"use client";

import { WholePaperNote } from "./PlagiarismResultView";
import { useState } from "react";
import type { DetectorResult, SentenceScore } from "@/core/detector/types";
import { AnnotatedText, focusMark, focusNote, type TextMark } from "./AnnotatedText";
import { BandBar } from "./BandBar";
import { Limits, ProofLayout, Sheet, Warnings, cx } from "./ui";

export const VERDICT_TEXT: Record<DetectorResult["verdict"], string> = {
  insufficient_text: "Not enough text to judge",
  likely_human: "Few patterns typical of model output",
  uncertain: "Inconclusive",
  likely_ai: "Many patterns typical of model output",
};

const leanWord = (lean: number) => (lean > 0.25 ? "model-like" : lean < -0.25 ? "human-like" : "neutral");

export function DetectorSummary({ result }: { result: DetectorResult }) {
  return (
    <div className="space-y-3">
      <p className="font-display text-2xl font-semibold">{VERDICT_TEXT[result.verdict]}</p>
      <BandBar
        score={result.score}
        low={result.band.low}
        high={result.band.high}
        leftLabel="Few patterns"
        rightLabel="Many patterns"
        caption={`Score ${result.score} out of 100 from ${result.model.version.includes("+") ? "a pattern classifier and two neural models that ran in your browser" : "the trained model"}, plausible range ${result.band.low} to ${result.band.high}, from ${result.words.toLocaleString("en")} words. “Many patterns” needs ${Math.ceil(result.model.thresholds.likelyAi * 100)} or more, a level only about 1 in 100 human texts reached in testing.`}
      />
      {result.model.document && <WholePaperNote doc={result.model.document} />}
    </div>
  );
}

export function DetectorResultView({ text, result }: { text: string; result: DetectorResult }) {
  const [active, setActive] = useState<string | null>(null);
  // Sentence offsets refer to the analysed text, which is the input without its reference list (a prefix of it).
  const flagged = result.sentences.filter((s) => s.level !== "low");
  const marks: TextMark[] = flagged.map((s, i) => ({
    id: `s${i}`,
    start: s.start,
    end: s.end,
    className: s.level === "high" ? "mark-ai" : "mark-ai-medium",
    label: s.level === "high" ? "Strong local patterns" : "Some local patterns",
  }));
  const select = (id: string) => {
    setActive(id);
    focusNote(id);
  };

  return (
    <ProofLayout
      sheet={
        <Sheet label="Your text with flagged sentences">
          <p className="mb-4 text-sm text-ink-faint">
            <span className="mark mark-ai px-1">Wavy underline</span>: several local cues.{" "}
            <span className="mark mark-ai-medium px-1">Dotted</span>: one or two. Sentence-level cues are much noisier than the overall score.
          </p>
          <AnnotatedText text={text} marks={marks} activeId={active} onSelect={select} />
        </Sheet>
      }
      margin={
        <>
          <DetectorSummary result={result} />
          <Warnings items={result.warnings} />
          {result.model.topPhrases.length > 0 && (
            <section aria-labelledby="phr-h" className="text-sm">
              <h2 id="phr-h" className="font-semibold">
                Wording that raised the score
              </h2>
              <p className="mt-1 flex flex-wrap gap-1.5">
                {result.model.topPhrases.map((p) => (
                  <span key={p.phrase} className="rounded bg-ai-soft px-1.5 py-0.5 font-serif">
                    {p.phrase}
                  </span>
                ))}
              </p>
              <p className="mt-1 text-ink-faint">Words and phrases the model learned are more common in machine-written text. Each one alone means little.</p>
            </section>
          )}
          {result.model.windows.length > 1 && (
            <section aria-labelledby="win-h" className="text-sm">
              <h2 id="win-h" className="font-semibold">
                Section by section
              </h2>
              <ol className="mt-2 space-y-1">
                {result.model.windows.map((w, i) => (
                  <li key={i} className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-2">
                    <span className="text-ink-faint">Part {i + 1}</span>
                    <span aria-hidden className="h-2 rounded-full bg-desk-deep">
                      <span className="block h-full rounded-full bg-ai" style={{ width: `${Math.max(2, w.probability * 100)}%` }} />
                    </span>
                    <span className="text-right tabular-nums">{Math.round(w.probability * 100)}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-1 text-ink-faint">Parts of about 300 words, overlapping. Very different scores can mean mixed authorship or heavy editing.</p>
            </section>
          )}
          <section aria-labelledby="signals-h">
            <h2 id="signals-h" className="font-semibold">
              Style measurements
            </h2>
            <p className="mt-1 text-sm text-ink-faint">Shown to explain the text, not to decide it. On their own they gave {result.statisticalScore} out of 100.</p>
            <ul className="mt-2 space-y-3">
              {result.signals.map((s) => (
                <li key={s.id} className="border-l-4 border-rule pl-3 text-sm">
                  <p>
                    <span className="font-semibold">{s.label}</span>: {s.value} <span className="text-ink-faint">({s.unit})</span>,{" "}
                    <span className={cx(s.lean > 0.25 && "text-ai", s.lean < -0.25 && "text-ok")}>{leanWord(s.lean)}</span>
                  </p>
                  <p className="mt-1 text-ink-soft">{s.explanation}</p>
                </li>
              ))}
            </ul>
          </section>
          {result.llm && (
            <section aria-labelledby="llm-h" className="text-sm">
              <h2 id="llm-h" className="font-semibold">
                Language-model opinion ({result.llm.model})
              </h2>
              <p className="mt-1">Estimates {Math.round(result.llm.probability * 100)} out of 100.</p>
              {result.llm.reasons.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-ink-soft">
                  {result.llm.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-ink-faint">Language models are poorly calibrated judges of authorship, so this opinion only widens the range when it disagrees; it never changes the verdict.</p>
            </section>
          )}
          {flagged.length > 0 && (
            <section aria-labelledby="sent-h">
              <h2 id="sent-h" className="font-semibold">
                Flagged sentences ({flagged.length})
              </h2>
              <ol className="mt-2 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {flagged.map((s: SentenceScore, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      id={`note-s${i}`}
                      onClick={() => {
                        setActive(`s${i}`);
                        focusMark(`s${i}`);
                      }}
                      className={cx(
                        "w-full rounded border-l-4 border-ai bg-page px-3 py-2 text-left text-sm",
                        active === `s${i}` && "ring-2 ring-[var(--focus)]",
                      )}
                    >
                      <span className="line-clamp-2 font-serif">{s.text}</span>
                      <span className="mt-1 block text-ink-soft">{s.reasons.join(". ") || "Matches the surrounding pattern."}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <Limits>
            <p>{result.disclaimer}</p>
            <p>
              In testing on text it had never seen, it wrongly flagged 3 of 1,387 human passages (0.2%) and caught about half of the
              machine-written ones. Paraphrased and lightly edited machine text is often rated inconclusive. See the Limits page.
            </p>
          </Limits>
        </>
      }
    />
  );
}
