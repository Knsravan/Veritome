"use client";

import { useEffect, useState } from "react";
import { CheckIcon, XIcon } from "@/components/icons";
import { Button, Notice } from "@/components/ui";
import type { HumaniseTone } from "@/core/rewrite/humanise";
import type {
  MakeYoursQuestion,
  MakeYoursResult,
} from "@/core/rewrite/make-yours";
import { ApiError, postJson } from "@/lib/api";
import { useSettings } from "@/lib/settings";

/**
 * "Make it yours" for one paragraph: shows where it is generic, asks the author a few questions only they can
 * answer, and writes their answers into the paragraph in their own words.
 */
export function MakeYours({
  paragraph,
  tone,
  onDone,
  onClose,
}: {
  paragraph: string;
  tone: HumaniseTone;
  onDone: (text: string) => void;
  onClose: () => void;
}) {
  const { llmFields } = useSettings();
  const [phase, setPhase] = useState<"asking" | "answering" | "writing">(
    "asking",
  );
  const [questions, setQuestions] = useState<MakeYoursQuestion[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = new AbortController();
    postJson<{ questions: MakeYoursQuestion[] }>(
      "/api/make-yours",
      { action: "ask", text: paragraph, ...llmFields() },
      c.signal,
    )
      .then((r) => {
        setQuestions(r.questions);
        setAnswers(r.questions.map(() => ""));
        setPhase("answering");
      })
      .catch((err) => {
        if (c.signal.aborted) return;
        setError(
          err instanceof ApiError || err instanceof Error
            ? err.message
            : "The questions could not be made.",
        );
        setPhase("answering");
      });
    return () => c.abort();
  }, [paragraph, llmFields]);

  const write = async () => {
    setPhase("writing");
    setError(null);
    try {
      const r = await postJson<MakeYoursResult>("/api/make-yours", {
        action: "write",
        text: paragraph,
        tone,
        answers: questions.map((q, k) => ({
          question: q.question,
          answer: answers[k] ?? "",
        })),
        ...llmFields(),
      });
      if (r.status === "rewritten") onDone(r.text);
      else {
        setError(
          "Your answers could not be written in without changing other facts. Try wording them a little differently, or edit the paragraph yourself.",
        );
        setPhase("answering");
      }
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "Your answers could not be written in.",
      );
      setPhase("answering");
    }
  };

  const answered = answers.some((a) => a.trim());
  return (
    <section
      aria-label="Make this paragraph yours"
      className="space-y-4 border-t border-rule bg-action-soft/40 px-4 py-4 sm:px-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Make it yours</h3>
          <p className="text-sm text-ink-soft">
            Answer in your own words from your own work; skip any you like. Your
            answers go into the paragraph as you wrote them, and nothing else is
            added.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-ink-soft hover:bg-desk-deep"
        >
          <XIcon size={16} />
        </button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {phase === "asking" ? (
        <div className="space-y-2" aria-label="Finding the generic parts">
          {[70, 90, 60].map((w, k) => (
            <div
              key={k}
              className="h-4 animate-pulse rounded bg-desk-deep"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      ) : questions.length === 0 ? (
        !error && (
          <p className="text-sm">
            This paragraph is already specific; there is nothing generic to ask
            about.
          </p>
        )
      ) : (
        <ol className="space-y-4">
          {questions.map((q, k) => (
            <li key={k} className="space-y-1.5">
              {q.quote && (
                <p className="text-sm text-ink-soft">
                  About <q className="font-serif text-ink">{q.quote}</q>
                </p>
              )}
              <label className="block font-semibold" htmlFor={`my-${k}`}>
                {q.question}
              </label>
              {q.why && <p className="text-xs text-ink-faint">{q.why}</p>}
              <textarea
                id={`my-${k}`}
                value={answers[k] ?? ""}
                onChange={(e) =>
                  setAnswers((a) =>
                    a.map((x, j) => (j === k ? e.target.value : x)),
                  )
                }
                placeholder="Your answer"
                className="block h-20 w-full resize-y rounded-lg border border-rule bg-page px-3 py-2 text-sm"
              />
            </li>
          ))}
        </ol>
      )}
      {questions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!answered || phase === "writing"}
            busy={phase === "writing"}
            onClick={() => void write()}
          >
            <CheckIcon size={16} />{" "}
            {phase === "writing"
              ? "Writing your answers in"
              : "Write my answers in"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      )}
    </section>
  );
}
