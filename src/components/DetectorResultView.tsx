"use client";

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
      <p className="font-serif text-2xl font-semibold">{VERDICT_TEXT[result.verdict]}</p>
      <BandBar
        score={result.score}
        low={result.band.low}
        high={result.band.high}
        leftLabel="Few patterns"
        rightLabel="Many patterns"
        caption={`Pattern score ${result.score}, plausible range ${result.band.low} to ${result.band.high}, from ${result.words.toLocaleString("en")} words. A verdict is only given when the whole range is on one side.`}
      />
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
          <section aria-labelledby="signals-h">
            <h2 id="signals-h" className="font-semibold">
              Signals behind the score
            </h2>
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
              <p className="mt-1">
                Estimates {Math.round(result.llm.probability * 100)} out of 100. Statistical signals alone gave {result.statisticalScore}.
              </p>
              {result.llm.reasons.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-ink-soft">
                  {result.llm.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-ink-faint">Language models are poorly calibrated judges of authorship, so this counts for about a third.</p>
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
              On 750 human-written passages we tested, none was labelled &ldquo;many patterns&rdquo;, but plain model-written paragraphs were
              usually &ldquo;inconclusive&rdquo; too. See the accuracy notes on the Limits page.
            </p>
          </Limits>
        </>
      }
    />
  );
}
