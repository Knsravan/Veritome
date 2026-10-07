"use client";

import { useId, useState } from "react";
import { PARAPHRASE_MODES } from "@/core/rewrite/prompts";
import type { RewriteMode, RewriteResult } from "@/core/rewrite/types";
import { postJson } from "@/lib/api";
import { useHasLlm, useSettings } from "@/lib/settings";
import { useRun } from "@/lib/useRun";
import { RewriteResultView } from "./RewriteResultView";
import { TextSource } from "./TextSource";
import { Button, Limits, Notice, ToolHeader, cx } from "./ui";

const MAX = 60_000;

export function RewriteTool({ kind }: { kind: "humanise" | "paraphrase" }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<RewriteMode>(kind === "humanise" ? "humanise" : "academic");
  const hasLlm = useHasLlm();
  const { llmFields } = useSettings();
  const { result, error, busy, run } = useRun<RewriteResult>();
  const groupId = useId();

  const go = () => run((signal) => postJson<RewriteResult>("/api/rewrite", { text, mode, ...llmFields() }, signal));

  return (
    <div className="space-y-8">
      {kind === "humanise" ? (
        <ToolHeader
          title="Humaniser"
          intro="Revises stiff, formulaic prose (stock phrases, “Moreover” openers, sentences of identical length) so it reads like careful human writing. Citations, maths and numbers are locked."
        >
          <div className="mt-4">
            <Notice kind="info" title="Use it on your own writing">
              Lowering a detector score does not change who wrote a text. Most publishers ask authors to disclose substantive AI
              assistance, and using a humaniser to hide it may break their rules.
            </Notice>
          </div>
        </ToolHeader>
      ) : (
        <ToolHeader
          title="Paraphraser"
          intro="Rewrites a passage in one of four ways. Citations, equations, links and numbers are replaced with locked placeholders before the text reaches the model, then checked on the way back."
        />
      )}
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="card min-w-0 space-y-4 p-4 sm:p-6">
          <TextSource value={text} onChange={setText} maxChars={MAX} rows={12} hint={`Up to ${MAX.toLocaleString("en")} characters. Nothing is stored.`} />
          {kind === "paraphrase" && (
            <fieldset>
              <legend id={groupId} className="font-semibold">
                Style
              </legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {PARAPHRASE_MODES.map((m) => (
                  <label
                    key={m.id}
                    className={cx(
                      "flex cursor-pointer gap-2 rounded border bg-page px-3 py-2",
                      mode === m.id ? "border-action ring-1 ring-action" : "border-rule",
                    )}
                  >
                    <input type="radio" name="mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} className="mt-1 accent-[var(--action)]" />
                    <span>
                      <span className="font-semibold">{m.label}</span>
                      <span className="block text-sm text-ink-soft">{m.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {!hasLlm && (
            <Notice kind="warn">
              No language model is configured, so only light rule-based edits are possible
              {mode === "expand" ? " and the Expand style will leave the text unchanged" : ""}. An operator can add one with LLM_BASE_URL and
              LLM_MODEL.
            </Notice>
          )}
          <Button onClick={go} busy={busy} disabled={!text.trim()}>
            {busy ? "Rewriting" : kind === "humanise" ? "Revise the text" : "Paraphrase"}
          </Button>
          {error && <Notice kind="error">{error}</Notice>}
          <Limits>
            <p>
              Every rewrite is checked for missing or invented citations, changed numbers and big length changes, and retried up to twice.
              Meaning can still drift in ways these checks cannot catch, so read the result against your original.
            </p>
          </Limits>
        </div>
        <div className="min-w-0">
          {result ? (
            <RewriteResultView result={result} />
          ) : (
            <p className="rounded border border-dashed border-rule px-4 py-10 text-center text-ink-faint">The rewritten text will appear here, with every change marked.</p>
          )}
        </div>
      </div>
    </div>
  );
}
