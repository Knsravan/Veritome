/**
 * Measures the AI-text detector on labelled samples.
 *
 *   node scripts/evaluate-detector.ts data.jsonl [more.jsonl ...] [--llm] [--json]
 *
 * Each line of a JSONL file is {"text": "...", "label": "human" | "ai", "source"?: "..."}.
 * With --llm the configured model (LLM_BASE_URL, LLM_MODEL, LLM_API_KEY) also gives an opinion.
 * Texts are processed locally and nothing is written to disk.
 */
import { readFileSync } from "node:fs";
import { detectAiText, type DetectorResult } from "../src/core/detector/index.ts";
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

async function main(argv: string[]) {
  const files = argv.filter((a) => !a.startsWith("--"));
  if (files.length === 0) {
    console.error("Usage: node scripts/evaluate-detector.ts data.jsonl [more.jsonl ...] [--llm] [--json]");
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

  const rows: Row[] = [];
  for (const s of samples) {
    const r = await detectAiText(s.text, llm ? { llm } : {});
    rows.push({ label: s.label, source: s.source ?? "unspecified", result: { score: r.score, verdict: r.verdict, words: r.words } });
  }
  if (argv.includes("--json")) console.log(JSON.stringify(rows.map((r) => ({ label: r.label, source: r.source, ...r.result }))));
  else console.log(summarise(rows));
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
