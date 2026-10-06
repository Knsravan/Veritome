/**
 * Turns labelled JSONL ({"text", "label": "human"|"ai"}) into svmlight rows using
 * the same feature code the app runs, so training and inference cannot drift.
 *
 *   node scripts/train/featurize.ts in.jsonl out.svm
 *
 * Label 1 = AI-written, 0 = human. Dense style features follow the hashed ones,
 * starting at index HASH_SIZE.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { extractFeatures, HASH_SIZE, normaliseForDetection } from "../../src/core/detector/features.ts";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: node scripts/train/featurize.ts in.jsonl out.svm");
  process.exit(2);
}
const out = createWriteStream(output);
let n = 0;
for await (const line of createInterface({ input: createReadStream(input) })) {
  if (!line.trim()) continue;
  const row = JSON.parse(line) as { text: string; label: string };
  const f = extractFeatures(normaliseForDetection(row.text).text);
  const parts = f.indices.map((i, k) => `${i + 1}:${(f.values[k] as number).toFixed(5)}`);
  f.dense.forEach((v, k) => parts.push(`${HASH_SIZE + k + 1}:${v.toFixed(5)}`));
  out.write(`${row.label === "ai" ? 1 : 0} ${parts.join(" ")}\n`);
  n++;
}
out.end();
console.error(`${n} rows -> ${output}`);
