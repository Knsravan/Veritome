import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  bandHalfWidth,
  combineSignals,
  detectAiText,
  findCliches,
  openingTransition,
  ramp,
  verdictFor,
  type DetectorSignal,
} from "../../src/core/detector/index.ts";
import type { LlmClient } from "../../src/core/llm/client.ts";
import { auroc, summarise } from "../../scripts/evaluate-detector.ts";

const STOCK =
  "In today's rapidly evolving digital landscape, artificial intelligence plays a pivotal role in transforming healthcare. " +
  "Moreover, machine learning models provide valuable insights into patient outcomes. " +
  "Furthermore, these tools help clinicians navigate the complexities of diagnosis. " +
  "Additionally, it is important to note that data quality remains a challenge. " +
  "Consequently, researchers must delve into robust validation strategies. " +
  "Overall, the integration of AI underscores the importance of interdisciplinary collaboration. " +
  "Notably, this transformative approach paves the way for personalized medicine. " +
  "In conclusion, AI stands as a testament to the power of innovation in the realm of healthcare. " +
  "Moreover, these systems foster a holistic approach to care that is both seamless and efficient for clinicians.";

const PLAIN =
  "We measured soil respiration at 14 sites over two summers. Most sites behaved as expected. " +
  "Two did not: the alder stands near the river kept respiring at almost the summer rate well into October, which we still cannot fully explain. " +
  "Temperature alone accounts for about half of the variance. Moisture helps, but only at the drier plots. " +
  "We had hoped the litter-bag data would close the gap; it didn't. " +
  "The bags at three plots were dug up by animals in the second year, so that comparison rests on fewer samples than we planned, and two of the remaining bags had torn mesh. " +
  "What we can say is narrower than the original hypothesis. Still, it is defensible. " +
  "A third summer of data, already funded, should tell us whether the alder effect is real or an artefact of the wet autumn of the first year.";

test("ramp maps and clamps", () => {
  assert.equal(ramp(0, 0, -1, 10, 1), -1);
  assert.equal(ramp(5, 0, -1, 10, 1), 0);
  assert.equal(ramp(50, 0, -1, 10, 1), 1);
  assert.equal(ramp(0.1, 0.22, 1, 0.62, -1), 1);
});

test("findCliches prefers the longest phrase and reports weights", () => {
  const hits = findCliches("This plays a pivotal role. We delve into it.");
  assert.deepEqual(
    hits.map((h) => h.phrase),
    ["plays a pivotal role", "delve into"],
  );
  assert.equal(hits[0]?.weight, 3);
  assert.equal(findCliches("A plain sentence about soil.").length, 0);
});

test("openingTransition reads the first connective only", () => {
  assert.equal(openingTransition("Moreover, the data show this."), "moreover");
  assert.equal(openingTransition("In conclusion, we stop."), "in conclusion");
  assert.equal(openingTransition("The data, moreover, show this."), null);
  assert.equal(openingTransition("Firstborn children differ."), null);
});

test("combineSignals is 50 for neutral signals and monotone in lean", () => {
  const sig = (lean: number): DetectorSignal => ({ id: "cliches", label: "", value: 0, unit: "", lean, weight: 1, explanation: "" });
  assert.equal(Math.round(combineSignals([sig(0), sig(0)])), 50);
  assert.ok(combineSignals([sig(1), sig(1)]) > 90);
  assert.ok(combineSignals([sig(-1), sig(-1)]) < 10);
  assert.equal(combineSignals([]), 50);
});

test("band narrows with length and verdicts need the whole band on one side", () => {
  assert.ok(bandHalfWidth(100, []) > bandHalfWidth(2000, []));
  assert.equal(verdictFor(50, { low: 90, high: 99 }), "insufficient_text");
  assert.equal(verdictFor(500, { low: 61, high: 90 }), "likely_ai");
  assert.equal(verdictFor(500, { low: 50, high: 90 }), "uncertain");
  assert.equal(verdictFor(500, { low: 5, high: 39 }), "likely_human");
});

test("stock-phrase text scores well above plain human-style text", async () => {
  const a = await detectAiText(STOCK);
  const b = await detectAiText(PLAIN);
  assert.ok(a.score > 75, `stock score ${a.score}`);
  assert.ok(b.score < 35, `plain score ${b.score}`);
  assert.ok(a.band.low <= a.score && a.score <= a.band.high);
  assert.equal(a.disclaimer.length > 0, true);
  const flagged = a.sentences.filter((s) => s.level === "high");
  assert.ok(flagged.length >= 3);
  assert.ok(flagged[0]!.reasons.length > 0);
  for (const s of a.sentences) assert.equal(STOCK.slice(s.start, s.end), s.text);
  for (const h of a.sentences.flatMap((s) => s.highlights)) assert.equal(STOCK.slice(h.start, h.end).toLowerCase().replace("’", "'"), h.phrase);
});

test("short text is reported as insufficient", async () => {
  const r = await detectAiText("Moreover, this plays a pivotal role in the realm of healthcare.");
  assert.equal(r.verdict, "insufficient_text");
  assert.ok(r.warnings.some((w) => /words are needed/.test(w)));
});

test("citations and the reference list are ignored", async () => {
  const body = `${PLAIN} Similar results were reported elsewhere (Smith et al., 2020; Jones, 2019) [3].`;
  const withRefs = `${body}\n\nReferences\n\n1. Smith, J. (2020). Moreover furthermore additionally. Journal, 1, 1-2.`;
  const r = await detectAiText(withRefs);
  assert.ok(r.warnings.some((w) => /reference list/.test(w)));
  assert.ok(r.signals.find((s) => s.id === "cliches")!.value === 0);
});

const fakeLlm = (reply: string | Error): LlmClient => ({
  model: "fake",
  async chat() {
    if (reply instanceof Error) throw reply;
    return reply;
  },
});

test("LLM opinion is blended in and disagreement widens the band", async () => {
  const base = await detectAiText(PLAIN);
  const r = await detectAiText(PLAIN, { llm: fakeLlm('{"ai_probability": 0.9, "reasons": ["even tone"]}') });
  assert.equal(r.llm?.probability, 0.9);
  assert.deepEqual(r.llm?.reasons, ["even tone"]);
  assert.equal(r.statisticalScore, base.statisticalScore);
  assert.ok(r.score > base.score);
  assert.ok(r.band.high - r.band.low > base.band.high - base.band.low);
});

test("LLM failure falls back to statistics with a warning", async () => {
  const r = await detectAiText(PLAIN, { llm: fakeLlm(new Error("down")) });
  assert.equal(r.llm, undefined);
  assert.ok(r.warnings.some((w) => /unavailable/.test(w)));
  const bad = await detectAiText(PLAIN, { llm: fakeLlm("I think it is human.") });
  assert.equal(bad.llm, undefined);
});

test("evaluation helpers: AUROC and summary", () => {
  assert.equal(auroc([{ score: 9, positive: true }, { score: 1, positive: false }]), 1);
  assert.equal(auroc([{ score: 5, positive: true }, { score: 5, positive: false }]), 0.5);
  assert.equal(auroc([{ score: 5, positive: true }]), null);
  const out = summarise([
    { label: "human", source: "x", result: { score: 20, verdict: "likely_human", words: 300 } },
    { label: "ai", source: "y", result: { score: 80, verdict: "likely_ai", words: 300 } },
  ]);
  assert.match(out, /False-positive rate.*0\.0% of 1/);
  assert.match(out, /AUROC of the raw score: 1\.000/);
});

test("model-written fixture scores higher on average than the plain human sample", async () => {
  const lines = readFileSync(new URL("../fixtures/detector-ai-claude.jsonl", import.meta.url), "utf8").trim().split("\n");
  const scores = await Promise.all(lines.map(async (l) => (await detectAiText(JSON.parse(l).text)).score));
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  assert.ok(mean > (await detectAiText(PLAIN)).score);
});
