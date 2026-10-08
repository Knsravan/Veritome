"use client";

import { useState } from "react";
import { DetectorResultView } from "@/components/DetectorResultView";
import { TextSource } from "@/components/TextSource";
import { Button, Checkbox, Notice, ToolHeader } from "@/components/ui";
import type { DetectorResult } from "@/core/detector/types";
import { postJson } from "@/lib/api";
import { useHasLlm, useSettings } from "@/lib/settings";
import { useRun } from "@/lib/useRun";

export function DetectorTool() {
  const [text, setText] = useState("");
  const [checked, setChecked] = useState("");
  const [useLlm, setUseLlm] = useState(false);
  const hasLlm = useHasLlm();
  const { llmFields } = useSettings();
  const { result, error, busy, run } = useRun<DetectorResult>();

  const go = () =>
    run(async (signal) => {
      const r = await postJson<DetectorResult>("/api/detect", { text, useLlm: useLlm && hasLlm, ...llmFields() }, signal);
      // Second opinion from the neural model, run here in the browser.
      const { withNeuralOpinion } = await import("@/lib/ai-model/neural");
      const merged = await withNeuralOpinion(r, text, signal);
      setChecked(text);
      return merged;
    });

  return (
    <div className="space-y-8">
      <ToolHeader
        title="AI writing patterns"
        intro="Measures how strongly a text shows patterns common in language-model output. It reports a range, not a verdict about who wrote it."
      />
      <div className="card animate-fade-up max-w-4xl space-y-4 p-4 sm:p-6 [--i:2]">
        <TextSource value={text} onChange={setText} />
        <Checkbox
          checked={useLlm && hasLlm}
          onChange={setUseLlm}
          disabled={!hasLlm}
          label="Also ask the language model for its opinion"
          hint={hasLlm ? "Sends the text to the configured model. Shown separately; it widens the range when it disagrees." : "No language model is configured on this server."}
        />
        <Button onClick={go} busy={busy} disabled={!text.trim()}>
          {busy ? "Checking" : "Check writing patterns"}
        </Button>
        {error && <Notice kind="error">{error}</Notice>}
      </div>
      {result && checked && (
        <div key={checked} className="animate-fade-up">
          <DetectorResultView text={checked} result={result} />
        </div>
      )}
    </div>
  );
}
