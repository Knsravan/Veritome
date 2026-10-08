import { test } from "node:test";
import assert from "node:assert/strict";
import { isProse, mergeNeural, neuralWindows, toClassifierScale, type NeuralMeta } from "../../src/core/detector/neural.ts";
import type { DetectorResult } from "../../src/core/detector/types.ts";

const qa = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99];
const meta: NeuralMeta = { version: "n1", maxTokens: 256, windowWords: 180, models: [{ file: "a.onnx", humanQuantiles: qa }, { file: "b.onnx", humanQuantiles: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9] }] };
const to = { likelyAi: 0.86, likelyHuman: 0.15 };

test("neuralWindows covers long paragraphs with overlapping windows", () => {
  const text = Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ");
  const w = neuralWindows(text, 180);
  assert.equal(w.length, 3);
  assert.ok(w[0]!.startsWith("w0 ") && w.at(-1)!.endsWith("w399"));
  assert.deepEqual(neuralWindows("a short paragraph", 180), ["a short paragraph"]);
});

test("isProse tells paragraphs from tables and equations", () => {
  assert.ok(isProse("The simulator reads each pulse and decides whether the eavesdropper keeps a photon, which lets us compare the honest link with the attacked one under the same conditions and noise. ".repeat(2)));
  assert.ok(!isProse("Pulses N Time (s) 250,000 0.036 ± 0.001 7.0 500,000 0.094 ± 0.002 5.3 1,000,000 0.18 0.21 0.33 4.1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34"));
});

test("toClassifierScale maps human percentiles onto the classifier's thresholds", () => {
  assert.equal(toClassifierScale(0.99, qa, to), 0.86);
  assert.ok(Math.abs(toClassifierScale(0.6, qa, to) - 0.15) < 1e-9);
  assert.ok(toClassifierScale(0.995, qa, to) > 0.86);
  assert.ok(toClassifierScale(0.3, qa, to) < 0.15);
  // The 90th human percentile stays well below "likely AI", and the mapping only rises.
  const p90 = toClassifierScale(0.7, qa, to);
  assert.ok(p90 > 0.15 && p90 < 0.4);
  let prev = -1;
  for (let p = 0; p <= 1; p += 0.01) {
    const v = toClassifierScale(p, qa, to);
    assert.ok(v >= prev - 1e-12);
    prev = v;
  }
});

test("mergeNeural keeps the highest estimate of the classifier and the models per segment", () => {
  const base = {
    words: 400,
    score: 10,
    band: { low: 2, high: 20 },
    verdict: "likely_human",
    sentences: [{ start: 10, end: 60, text: "x", score: 0.2, level: "low", reasons: [], highlights: [] }],
    model: {
      version: "1",
      probability: 0.1,
      windows: [],
      segments: [
        { start: 0, end: 100, words: 200, probability: 0.1 },
        { start: 100, end: 200, words: 200, probability: 0.1 },
      ],
      topPhrases: [],
      thresholds: to,
    },
  } as unknown as DetectorResult;
  const r = mergeNeural(base, [[[0.5, 0.4], [0.95]], null], meta);
  assert.ok(r.model.segments![0]!.probability > 0.86);
  assert.equal(r.model.segments![1]!.probability, 0.1);
  assert.equal(r.verdict, "uncertain");
  assert.ok(r.score > 10 && r.model.version === "1+n1");
  assert.notEqual(r.sentences[0]!.level, "low");
  assert.match(r.sentences[0]!.reasons.at(-1)!, /neural model/);
  // A neural opinion lower than the classifier's never lowers it.
  assert.equal(mergeNeural(base, [[[0.01], [0.01]], [[0.01], [0.01]]], meta).model.segments![0]!.probability, 0.1);
  // Mismatched input leaves the result alone.
  assert.equal(mergeNeural(base, [[[0.9]]], meta), base);
});
