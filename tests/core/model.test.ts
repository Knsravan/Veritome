import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { detectAiText, modelVerdict } from "../../src/core/detector/detect.ts";
import { extractFeatures, hashFeature, HASH_SIZE, normaliseForDetection } from "../../src/core/detector/features.ts";
import { MODEL_INFO, modelProbability, scoreWindows, topContributors } from "../../src/core/detector/model.ts";

const sample = readFileSync(new URL("../fixtures/hape-acad-sample.jsonl", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as { label: string; text: string });

test("hashing is stable (the shipped weights depend on it)", () => {
  assert.equal(hashFeature("u:the"), hashFeature("u:the"));
  assert.ok(hashFeature("u:delve") < HASH_SIZE);
  assert.equal(hashFeature(""), 0x811c9dc5 & (HASH_SIZE - 1));
});

test("features are L2-normalised and the dense block has a fixed size", () => {
  const f = extractFeatures("This is a short test. It has two sentences.");
  const norm = Math.sqrt(f.values.reduce((s, v) => s + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9);
  assert.equal(f.dense.length, 20);
  assert.deepEqual(f.indices, [...f.indices].sort((a, b) => a - b));
});

test("lookalike letters and invisible characters are undone and counted", () => {
  const n = normaliseForDetection("The rеsults wеre​ clear. Ελληνικά stays.");
  assert.equal(n.text, "The results were clear. Ελληνικά stays.");
  assert.equal(n.homoglyphs, 2);
  assert.equal(n.invisible, 1);
});

test("homoglyph tricks do not change the model's estimate and are reported", async () => {
  const text = sample.find((r) => r.label === "ai")!.text;
  const tricked = text.replace(/e/g, "е").replace(/ /g, " ​");
  assert.ok(Math.abs(modelProbability(text) - modelProbability(tricked)) < 1e-9);
  const r = await detectAiText(tricked);
  assert.ok(r.evasion.homoglyphs > 10);
  assert.ok(r.warnings.some((w) => /lookalike letters/.test(w)));
  assert.ok(r.warnings.some((w) => /invisible character/.test(w)));
});

test("held-out GPT-4o academic text scores well above human academic text", () => {
  const mean = (label: string) => {
    const xs = sample.filter((r) => r.label === label).map((r) => modelProbability(r.text));
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  assert.ok(mean("ai") > 0.7, `ai mean ${mean("ai")}`);
  assert.ok(mean("human") < 0.3, `human mean ${mean("human")}`);
});

test("no human passage in the sample is labelled likely AI", async () => {
  for (const r of sample.filter((x) => x.label === "human")) {
    assert.notEqual((await detectAiText(r.text)).verdict, "likely_ai");
  }
});

test("verdict thresholds: short texts need a stronger signal", () => {
  const t = MODEL_INFO.thresholds;
  assert.equal(modelVerdict(50, 0.99), "insufficient_text");
  assert.equal(modelVerdict(300, t.likelyAi), "likely_ai");
  assert.equal(modelVerdict(100, t.likelyAi), t.likelyAi >= 0.93 ? "likely_ai" : "uncertain");
  assert.equal(modelVerdict(300, t.likelyHuman), "likely_human");
  assert.equal(modelVerdict(300, (t.likelyAi + t.likelyHuman) / 2), "uncertain");
});

test("long texts are scored in windows with offsets into the text", () => {
  const long = sample.map((r) => r.text).join("\n\n");
  const w = scoreWindows(long);
  assert.ok(w.length > 3);
  for (const x of w) assert.ok(x.end > x.start && x.probability >= 0 && x.probability <= 1);
  assert.equal(w[w.length - 1]!.end, long.trimEnd().length);
});

test("top contributors are phrases from the text with positive weight", () => {
  const text = sample.find((r) => r.label === "ai")!.text;
  const top = topContributors(text);
  assert.ok(top.length > 0);
  for (const t of top) {
    assert.ok(t.weight > 0);
    assert.ok(text.toLowerCase().includes(t.phrase.split(" ")[0]!));
  }
});
