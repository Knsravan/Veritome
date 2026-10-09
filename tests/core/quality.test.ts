import assert from "node:assert/strict";
import { test } from "node:test";
import { mostGeneric, specificity, writingQuality } from "../../src/core/rewrite/quality.ts";

const STIFF =
  "In recent years, the rapid advancement of quantum technologies has fundamentally transformed secure communication. It is important to note that quantum key distribution offers a promising avenue for achieving security, which plays a crucial role in safeguarding sensitive data across a wide range of applications. Moreover, the proposed framework leverages a comprehensive set of techniques to address the multifaceted challenges associated with noise and loss. Furthermore, these findings contribute significantly to the broader understanding of the field and offer valuable insights for practitioners.";
const PLAIN =
  "We built a QKD link over 25 km of standard fibre and ran it for 120 trials. The key rate held at 1.2 kbps (Lo et al., 2014), even when loss rose to 9 dB. That surprised us. Noise from the detectors, not the fibre, set the limit, so we swapped in cooled InGaAs units and the error rate fell from 4.1% to 2.3%.";

test("plain, specific writing scores well above padded, generic writing", () => {
  const stiff = writingQuality(STIFF);
  const plain = writingQuality(PLAIN);
  assert.ok(stiff.score < 50, `stiff scored ${stiff.score}`);
  assert.ok(plain.score > 85, `plain scored ${plain.score}`);
  const stiffPart = Object.fromEntries(stiff.parts.map((p) => [p.id, p.score]));
  assert.equal(stiffPart.plain, 0);
  assert.equal(stiffPart.specific, 0);
  assert.ok(stiff.phrases.some((p) => p.text === "leverages"));
  assert.ok(stiff.phrases.some((p) => p.text === "plays a crucial role"));
  assert.ok(stiff.phrases.some((p) => p.text === "moreover"));
  assert.deepEqual(plain.phrases, []);
});

test("specificity counts numbers, names and citations; mostGeneric picks long paragraphs without them", () => {
  assert.ok(specificity(PLAIN) > 8);
  assert.equal(specificity("This is a sentence with nothing concrete in it at all."), 0);
  assert.deepEqual(mostGeneric([PLAIN, STIFF, "Too short."]), [1]);
});

test("the passive voice and long sentences lower their parts of the score", () => {
  const passive = writingQuality(
    "The samples were collected. The data were analysed. The results were reported. The errors were corrected by the team.",
  );
  assert.ok(passive.parts.find((p) => p.id === "active")!.score < 20);
  const long = writingQuality(`${"word ".repeat(45).trim()}. ${"more ".repeat(42).trim()}.`);
  assert.ok(long.parts.find((p) => p.id === "length")!.score < 30);
});
