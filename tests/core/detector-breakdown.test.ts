import assert from "node:assert/strict";
import { test } from "node:test";
import { aiBreakdown } from "../../src/core/detector/breakdown.ts";
import type { DetectorResult } from "../../src/core/detector/types.ts";

const words = (n: number, w = "word") => Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ");

function result(verdict: DetectorResult["verdict"], windows: Array<{ start: number; end: number; probability: number }>): DetectorResult {
  return {
    words: 600,
    score: 50,
    band: { low: 40, high: 60 },
    verdict,
    signals: [],
    sentences: [],
    statisticalScore: 50,
    model: { version: "t", probability: 0.5, windows, topPhrases: [], thresholds: { likelyAi: 0.86, likelyHuman: 0.15 } },
    evasion: { homoglyphs: 0, invisible: 0 },
    warnings: [],
    disclaimer: "",
  };
}

test("splits a long text into AI, uncertain and human shares by section", () => {
  const a = words(200, "a");
  const b = words(200, "b");
  const c = words(200, "c");
  const text = `${a} ${b} ${c}`;
  const r = aiBreakdown(
    result("uncertain", [
      { start: 0, end: a.length, probability: 0.97 },
      { start: a.length + 1, end: a.length + 1 + b.length, probability: 0.5 },
      { start: a.length + b.length + 2, end: text.length, probability: 0.05 },
    ]),
    text,
  );
  assert.equal(r.judged, true);
  assert.equal(r.aiPercent, 33.3);
  assert.equal(r.humanPercent, 33.3);
  assert.equal(r.uncertainPercent, 33.4);
  assert.deepEqual(r.regions.map((x) => x.kind), ["ai", "uncertain", "human"]);
  assert.equal(r.regions[0]?.start, 0);
});

test("a single section follows the overall verdict, and short texts are not judged", () => {
  const text = words(120);
  const one = aiBreakdown(result("likely_ai", [{ start: 0, end: text.length, probability: 0.9 }]), text);
  assert.equal(one.aiPercent, 100);
  const unsure = aiBreakdown(result("uncertain", [{ start: 0, end: text.length, probability: 0.9 }]), text);
  assert.equal(unsure.uncertainPercent, 100);
  assert.equal(aiBreakdown(result("insufficient_text", []), text).judged, false);
});

const HUMAN = 'We trained several image classifiers on a small agricultural dataset of leaf photographs collected on four farms in Andhra Pradesh. Deeper neural networks are more difficult to train. We present a residual learning framework to ease the training of networks that are substantially deeper than those used previously. Our own models used twelve layers and were trained for forty epochs on a single graphics card.\n\nAttention-based models changed the field: the dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder (Vaswani et al., 2017). We did not use attention because our images are small.\n\nAs one survey put it, "transfer learning from large natural-image datasets remains the most reliable starting point for small agricultural datasets". Our results agree with this view.\n\nWe collected the leaves ourselves over two wet seasons, which turned out to matter more than we expected. Farmers in the second village sprayed copper fungicide in early August, so half of our "late blight" photographs from that site show treated plants with odd purple margins. We kept them, but labelled them separately. Two of us disagreed about roughly one image in twelve; when we could not agree, the leaf went into a "doubtful" folder and was not used for training. Our phones were cheap, the light was bad, and some photographs are frankly blurry, which is closer to what a farmer would actually upload than the clean studio images in public datasets.';
const AI = 'Overall, this study underscores the pivotal role of deep learning in transforming modern agriculture. Furthermore, it is important to note that the integration of convolutional neural networks into disease detection pipelines offers valuable insights into the complex dynamics of plant health. Additionally, these findings highlight the transformative potential of artificial intelligence in fostering sustainable agricultural practices. Moreover, the proposed approach demonstrates remarkable robustness and scalability, paving the way for future research in this rapidly evolving field. In conclusion, by leveraging cutting-edge technologies, researchers and practitioners can unlock new opportunities to enhance crop productivity, mitigate the impact of plant diseases, and ensure global food security in an increasingly interconnected world. It is worth noting that further investigation is essential to fully harness the immense potential of these innovative solutions. Ultimately, this comprehensive framework serves as a testament to the power of interdisciplinary collaboration in addressing the multifaceted challenges facing the agricultural sector today. Furthermore, the seamless integration of these tools into existing workflows can empower stakeholders at every level, from smallholder farmers to policymakers, to make informed decisions. In summary, this research not only advances our understanding of automated disease detection but also lays a solid foundation for the development of intelligent, data-driven agricultural systems that can adapt to the dynamic needs of a rapidly changing world.\n';

test("a machine-written paragraph is scored on its own, not averaged with human ones", async () => {
  const { detectAiText } = await import("../../src/core/detector/detect.ts");
  const text = HUMAN + "\n\n" + AI;
  const r = await detectAiText(text);
  const segs = r.model.segments ?? [];
  assert.ok(segs.length >= 2, "split into segments");
  assert.ok((segs[segs.length - 1]?.probability ?? 0) > 0.9, "the machine-written paragraph scores high");
  assert.ok((segs[0]?.probability ?? 1) < 0.5, "the human paragraphs score low");
  const b = aiBreakdown(r, text);
  assert.ok(b.aiPercent > 30 && b.aiPercent < 70, String(b.aiPercent));
  assert.equal(b.regions[b.regions.length - 1]?.kind, "ai");
});

test("only prose paragraphs count: title, author lines, headings and references are left out", async () => {
  const { proseRanges } = await import("../../src/core/detector/breakdown.ts");
  const para = "Quantum computers process many states at once, which makes some problems far easier to solve than before.";
  const text = [
    "Interactive Quantum Computing Simulator: Visualization and\nExploration of Qubit States",
    "Macharla Shashidhar 1* , K. Sony 1 , K. Thirupathi Reddy 2 Research student, KITS warangal, Telangana",
    "Abstract",
    para,
    "Introduction",
    para,
    "References",
    "1. Kandadi, T. (2025). Drawbacks of Random Forest algorithm to examine extensive datasets. SSRN. https://doi.org/10.2139/ssrn.5236759",
  ].join("\n\n");
  const ranges = proseRanges(text).map((r) => text.slice(r.start, r.end));
  assert.deepEqual(ranges, [para, para]);
});
