import assert from "node:assert/strict";
import { test } from "node:test";
import { findTorturedPhrases } from "../../src/core/integrity/tortured.ts";
import { cleanForSearch, findTricks } from "../../src/core/integrity/tricks.ts";
import { checkPlagiarism } from "../../src/core/plagiarism/check.ts";
import { reviewReport } from "../../src/core/plagiarism/review.ts";
import { tokenize } from "../../src/core/text/tokens.ts";

const SOURCE =
  "Soil respiration in riparian alder stands remained high well into October because waterlogged sediments kept microbial activity unusually elevated across the floodplain.";

test("look-alike Cyrillic letters inside English words are flagged and restored", () => {
  const disguised = "Soil rеspirаtion in riparian аlder stands"; // е, а are Cyrillic
  const flags = findTricks(disguised);
  assert.equal(flags.length, 1);
  assert.equal(flags[0]!.kind, "lookalike_letters");
  assert.ok(flags[0]!.text.startsWith("rеspirаtion"));
  assert.equal(cleanForSearch(disguised), "Soil respiration in riparian alder stands");
  assert.deepEqual(
    tokenize(disguised).map((t) => t.word),
    ["soil", "respiration", "in", "riparian", "alder", "stands"],
  );
});

test("genuine Greek and Russian words are not flagged", () => {
  assert.deepEqual(findTricks("The coefficient α was 0.4, as Иванов reported in Москва."), []);
});

test("zero-width characters inside words are flagged and do not split matching", () => {
  const t = "Soil res​piration in ripa‌rian alder stands";
  const flags = findTricks(t);
  assert.equal(flags.length, 1);
  assert.equal(flags[0]!.kind, "invisible_characters");
  assert.equal(flags[0]!.count, 2);
  assert.deepEqual(tokenize(t).map((x) => x.word).slice(0, 4), ["soil", "respiration", "in", "riparian"]);
});

test("runs of unusual space characters are flagged; a few are ignored", () => {
  assert.deepEqual(findTricks("a b c d"), []);
  const odd = "Soil respiration in riparian alder stands remained high well";
  assert.equal(findTricks(odd)[0]?.kind, "unusual_spaces");
});

test("tortured phrases are found with the term they replaced, including plurals and hyphens", () => {
  const found = findTorturedPhrases("We train a profound learning model and an irregular woodland, then compare counterfeit-consciousness systems on colossal information.");
  assert.deepEqual(
    found.map((f) => [f.text, f.expected]),
    [
      ["profound learning", "deep learning"],
      ["irregular woodland", "random forest"],
      ["counterfeit-consciousness", "artificial intelligence"],
      ["colossal information", "big data"],
    ],
  );
  assert.deepEqual(findTorturedPhrases("Deep learning and random forests are widely used; a profound effect on learning was seen."), []);
});

test("a disguised copy is still matched and reported as disguised text", async () => {
  const disguised = SOURCE.replace(/a/g, "а"); // every Latin a swapped for Cyrillic
  const report = await checkPlagiarism(disguised, { library: [{ id: "src", title: "Source", text: SOURCE }] });
  assert.ok(report.similarity > 90, `similarity ${report.similarity}`);
  assert.ok((report.disguises?.length ?? 0) > 0);
  const r = reviewReport(report);
  assert.ok(r.issues.some((i) => i.kind === "disguised"));
  assert.ok(r.issues.some((i) => i.kind === "copied_uncited"));
});

test("hidden text from the file is reported", async () => {
  const text = "Our own sentence about soil. HIDDEN WORDS HERE and more of our own text follows.";
  const start = text.indexOf("HIDDEN");
  const report = await checkPlagiarism(text, { hiddenText: [{ start, end: start + 17 }] });
  assert.deepEqual(report.disguises?.map((d) => [d.kind, d.text]), [["hidden_text", "HIDDEN WORDS HERE"]]);
});

test("figures are read from PubMed Central JATS with their image addresses", async () => {
  const { figuresFromJats } = await import("../../src/core/images/figures.ts");
  const xml =
    '<fig id="F1"><label>Fig. 1</label><caption><p>Respiration <italic>by</italic> site &amp; month</p></caption><graphic xlink:href="380_Fig1_HTML.jpg"/></fig>' +
    '<fig id="F2"><label>Figure 2</label><graphic xlink:href="nihms-12345-f0002"/></fig>' +
    '<fig id="F3"><label>Bad</label><graphic xlink:href="../../etc/passwd"/></fig>';
  assert.deepEqual(figuresFromJats(xml, "PMC6267405"), [
    { label: "Fig. 1", caption: "Respiration by site & month", url: "https://pmc.ncbi.nlm.nih.gov/articles/instance/6267405/bin/380_Fig1_HTML.jpg" },
    { label: "Figure 2", caption: "", url: "https://pmc.ncbi.nlm.nih.gov/articles/instance/6267405/bin/nihms-12345-f0002.jpg" },
  ]);
});
