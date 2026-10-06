import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPlagiarism } from "../../src/core/plagiarism/check.ts";
import type { SourceProvider } from "../../src/core/plagiarism/providers.ts";
import { selectPassages } from "../../src/core/plagiarism/passages.ts";

const COPIED = "juvenile cod showed reduced growth at elevated temperatures across all tested populations";
const PAPER = `Climate change is altering the distribution of many marine species around the world today. ${COPIED[0]?.toUpperCase()}${COPIED.slice(1)}, which suggests thermal limits. We then repeated the assay with a second population collected nearby in spring.

References

Smith, J. (2020). Juvenile cod showed reduced growth at elevated temperatures across all tested populations. Journal of Fish. 1(2), 3-4.`;

const fake = (docs: Array<{ id: string; text: string }>, fail = false): SourceProvider => ({
  name: "Fake",
  kind: "scholarly",
  coverage: "test",
  async search() {
    if (fail) throw new Error("boom");
    return docs.map((d) => ({ id: d.id, title: `Doc ${d.id}`, text: d.text, provider: "Fake", kind: "scholarly" as const, url: `https://x/${d.id}` }));
  },
});

test("finds a copied passage via a provider and excludes the reference list", async () => {
  const r = await checkPlagiarism(PAPER, { providers: [fake([{ id: "a", text: `Earlier ${COPIED} in tanks.` }])] });
  assert.equal(r.sources.length, 1);
  assert.equal(r.sources[0]?.id, "a");
  assert.ok(r.similarity > 20, String(r.similarity));
  assert.equal(r.spans.length, 1);
  assert.ok(r.spans[0]?.text.toLowerCase().includes("juvenile cod"));
  assert.equal(r.excluded.references, true);
  assert.ok(r.excluded.referenceWords > 0);
  assert.ok(r.disclaimer.length > 0);
});

test("unrelated sources give zero similarity", async () => {
  const r = await checkPlagiarism(PAPER, { providers: [fake([{ id: "b", text: "Quantum chromodynamics describes the strong interaction between quarks and gluons." }])] });
  assert.equal(r.similarity, 0);
  assert.equal(r.verdict, "low");
  assert.equal(r.sources.length, 0);
});

test("library documents are compared in full", async () => {
  const r = await checkPlagiarism(PAPER, { library: [{ id: "1", title: "My thesis", text: `Chapter two. ${COPIED}. More text.` }] });
  assert.equal(r.sources[0]?.kind, "library");
  assert.ok(r.providers.some((p) => p.name === "Your library"));
});

test("quoted text is excluded unless requested", async () => {
  const quoted = `The authors state that "${COPIED} in every experiment we ran" and we agree. Other text follows here for length and variety of words.`;
  const src = [{ id: "q", text: `${COPIED} in every experiment we ran` }];
  assert.equal((await checkPlagiarism(quoted, { providers: [fake(src)] })).similarity, 0);
  assert.ok((await checkPlagiarism(quoted, { providers: [fake(src)], excludeQuotes: false })).similarity > 0);
});

test("provider failures become warnings, not crashes", async () => {
  const r = await checkPlagiarism(PAPER, { providers: [fake([], true)] });
  assert.ok(r.warnings.some((w) => w.includes("Fake")));
  assert.ok((r.providers[0]?.failures ?? 0) > 0);
});

test("repetition within the manuscript is reported", async () => {
  const t =
    "We measured growth rates across twelve tanks over eight weeks of continuous observation. Many other things happened in between those weeks and nobody noticed. " +
    "Later we wrote that we measured growth rates across twelve tanks over eight weeks of continuous observation again.";
  const r = await checkPlagiarism(t);
  assert.equal(r.sources[0]?.kind, "self");
  assert.ok(r.warnings.some((w) => w.includes("No search providers")));
});

test("passage selection samples across the document", () => {
  const sentence = (n: number) => `Experiment ${n} measured extraordinarily heterogeneous physiological responses among juvenile populations under controlled laboratory conditions. `;
  const text = Array.from({ length: 30 }, (_, i) => sentence(i)).join("");
  const ps = selectPassages(text, 5);
  assert.ok(ps.length >= 4);
  assert.ok((ps[ps.length - 1]?.start ?? 0) > text.length / 2);
});
