/**
 * Measures the AI-text detector on labelled samples.
 *
 *   node scripts/evaluate-detector.ts data.jsonl [more.jsonl ...] [--neural] [--llm] [--json]
 *
 * Each line of a JSONL file is {"text": "...", "label": "human" | "ai", "source"?: "..."}.
 * With --neural the neural models in public/models/ai-writing also read the text, as they do in the browser, so the
 * figures are those of the live site. Without it only the lighter classifier judges.
 * With --llm the configured model (LLM_BASE_URL, LLM_MODEL, LLM_API_KEY) also gives an opinion.
 * Texts are processed locally and nothing is written to disk.
 */
import { readFileSync } from "node:fs";
import { detectAiText, type DetectorResult } from "../src/core/detector/index.ts";
import { isProse, mergeNeural, neuralWindows, type NeuralMeta } from "../src/core/detector/neural.ts";
import { wordPiece } from "../src/lib/ai-model/wordpiece.ts";
import { createLlmClient } from "../src/core/llm/client.ts";
import { resolveLlmConfig } from "../src/core/llm/config.ts";

interface Sample {
  text: string;
  label: "human" | "ai";
  source?: string;
}

export interface Row {
  label: "human" | "ai";
  source: string;
  result: Pick<DetectorResult, "score" | "verdict" | "words">;
}

/** Area under the ROC curve via the rank-sum statistic; ties count half. */
export function auroc(scores: ReadonlyArray<{ score: number; positive: boolean }>): number | null {
  const pos = scores.filter((s) => s.positive).map((s) => s.score);
  const neg = scores.filter((s) => !s.positive).map((s) => s.score);
  if (pos.length === 0 || neg.length === 0) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);

export function summarise(rows: readonly Row[]): string {
  const lines: string[] = [];
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.label} / ${r.source}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  lines.push("| Label / source | n | mean score | likely AI | inconclusive | likely human | too short |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const [key, g] of [...groups.entries()].sort()) {
    const count = (v: string) => g.filter((r) => r.result.verdict === v).length;
    const meanScore = g.reduce((n, r) => n + r.result.score, 0) / g.length;
    lines.push(
      `| ${key} | ${g.length} | ${meanScore.toFixed(1)} | ${pct(count("likely_ai"), g.length)} | ${pct(count("uncertain"), g.length)} | ${pct(count("likely_human"), g.length)} | ${pct(count("insufficient_text"), g.length)} |`,
    );
  }
  const human = rows.filter((r) => r.label === "human" && r.result.verdict !== "insufficient_text");
  const ai = rows.filter((r) => r.label === "ai" && r.result.verdict !== "insufficient_text");
  lines.push("");
  lines.push(`False-positive rate (human text labelled "likely AI"): ${pct(human.filter((r) => r.result.verdict === "likely_ai").length, human.length)} of ${human.length}`);
  lines.push(`Detection rate (AI text labelled "likely AI"): ${pct(ai.filter((r) => r.result.verdict === "likely_ai").length, ai.length)} of ${ai.length}`);
  const auc = auroc(rows.map((r) => ({ score: r.result.score, positive: r.label === "ai" })));
  lines.push(`AUROC of the raw score: ${auc === null ? "n/a (needs both labels)" : auc.toFixed(3)}`);
  return lines.join("\n");
}

/**
 * The neural opinion exactly as the browser forms it (src/lib/ai-model/neural.ts): prose segments only, the same
 * windows, tokenizer and merging, with the models read from public/ instead of fetched.
 */
async function loadNeural(): Promise<(result: DetectorResult, text: string) => Promise<DetectorResult>> {
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = 1;
  const dir = new URL("../public/models/ai-writing/", import.meta.url);
  const meta = JSON.parse(readFileSync(new URL("meta.json", dir), "utf8")) as NeuralMeta;
  const tok = wordPiece(readFileSync(new URL("vocab.txt", dir), "utf8"));
  const sessions = await Promise.all(
    meta.models.map((m) => ort.InferenceSession.create(new Uint8Array(readFileSync(new URL(m.file, dir))), { executionProviders: ["wasm"] })),
  );
  const score = async (session: (typeof sessions)[number], text: string) => {
    const ids = tok.encode(text, meta.maxTokens);
    const tensor = (v: number[]) => new ort.Tensor("int64", BigInt64Array.from(v.map((x) => BigInt(x))), [1, v.length]);
    const feeds: Record<string, InstanceType<typeof ort.Tensor>> = { input_ids: tensor(ids), attention_mask: tensor(ids.map(() => 1)) };
    if (session.inputNames.includes("token_type_ids")) feeds.token_type_ids = tensor(ids.map(() => 0));
    const out = await session.run(feeds);
    const [human, ai] = Array.from(out[session.outputNames[0]!]!.data as Float32Array);
    return 1 / (1 + Math.exp(human! - ai!));
  };
  return async (result, text) => {
    const segments = result.model.segments;
    if (!segments?.length || result.verdict === "insufficient_text") return result;
    const scores: Array<number[][] | null> = [];
    for (const s of segments) {
      const part = text.slice(s.start, s.end);
      if (!isProse(part)) {
        scores.push(null);
        continue;
      }
      const windows = neuralWindows(part, meta.windowWords);
      const perModel: number[][] = [];
      for (const session of sessions) {
        const ws: number[] = [];
        for (const w of windows) ws.push(await score(session, w));
        perModel.push(ws);
      }
      scores.push(perModel);
    }
    const merged = mergeNeural(result, scores, meta);
    return { ...merged, model: { ...merged.model, neural: "used" } };
  };
}

async function main(argv: string[]) {
  const files = argv.filter((a) => !a.startsWith("--"));
  if (files.length === 0) {
    console.error("Usage: node scripts/evaluate-detector.ts data.jsonl [more.jsonl ...] [--neural] [--llm] [--json]");
    process.exit(2);
  }
  const samples: Sample[] = files.flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Sample),
  );
  const config = argv.includes("--llm") ? await resolveLlmConfig({ env: process.env, allowClientConfig: false, allowPrivate: true }) : null;
  if (argv.includes("--llm") && !config) console.error("--llm given but LLM_BASE_URL / LLM_MODEL are not set; continuing without it.");
  const llm = config ? createLlmClient(config) : undefined;
  const neural = argv.includes("--neural") ? await loadNeural() : undefined;

  const rows: Row[] = [];
  for (const s of samples) {
    const first = await detectAiText(s.text, llm ? { llm } : {});
    const r = neural ? await neural(first, s.text) : first;
    rows.push({ label: s.label, source: s.source ?? "unspecified", result: { score: r.score, verdict: r.verdict, words: r.words } });
  }
  if (argv.includes("--json")) console.log(JSON.stringify(rows.map((r) => ({ label: r.label, source: r.source, ...r.result }))));
  else console.log(summarise(rows));
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
