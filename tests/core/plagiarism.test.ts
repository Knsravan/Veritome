import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPlagiarism, failureReason } from "../../src/core/plagiarism/check.ts";
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

test("a provider that runs out of its request allowance is reported as partly searched, not failed", async () => {
  const { RequestBudgetExceeded } = await import("../../src/core/infra/http.ts");
  const { checkPlagiarism } = await import("../../src/core/plagiarism/check.ts");
  let calls = 0;
  const limited = {
    name: "Limited",
    kind: "scholarly" as const,
    coverage: "test",
    async search() {
      if (++calls > 1) throw new RequestBudgetExceeded("Limited");
      return [];
    },
  };
  const text = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} discusses riparian alder respiration, mycorrhizal nitrogen fixation and autumn carbon efflux in floodplain soils near station ${i}.`).join("\n\n");
  const r = await checkPlagiarism(text, { providers: [limited], maxPassages: 4 });
  const s = r.providers.find((p) => p.name === "Limited");
  assert.equal(s?.failures, 0);
  assert.equal(s?.queries, 1);
  assert.ok((s?.skipped ?? 0) >= 1);
  assert.ok(r.warnings.some((w) => /only part of the text/.test(w)));
  assert.ok(!r.warnings.some((w) => /contributed nothing/.test(w)));
});

test("failed searches are explained without URLs or status codes", async () => {
  const busy: SourceProvider = {
    name: "Busy",
    kind: "scholarly",
    coverage: "test",
    async search() {
      throw new Error("HTTP 429 for https://api.example.org/search");
    },
  };
  const r = await checkPlagiarism("Deeper networks are more difficult to train and we present a residual learning framework for very deep models.", { providers: [busy] });
  const note = r.warnings.find((w) => w.startsWith("Busy"));
  assert.equal(note, "Busy could not be searched this time (the service was busy and asked us to slow down), so it contributed nothing.");
  assert.equal(failureReason(new Error("The operation timed out")), "the service did not answer in time");
  assert.equal(failureReason(new Error("HTTP 503 for x")), "the service had a server error");
});

const ORIGINAL = "Deeper neural networks are more difficult to train and we present a residual learning framework to ease the training of networks";
const multi = (docs: Array<{ id: string; text: string; year?: number }>): SourceProvider => ({
  name: "Multi",
  kind: "scholarly",
  coverage: "test",
  async search() {
    return docs.map((d) => ({ id: d.id, title: `Doc ${d.id}`, text: d.text, provider: "Multi", kind: "scholarly" as const, ...(d.year ? { year: d.year } : {}) }));
  },
});

test("each passage is credited to one source, the oldest on a tie, and credits add up to the similarity", async () => {
  const text = `Our image classifiers were trained on leaf photographs from four farms. ${ORIGINAL}. We used twelve layers in the end.`;
  const r = await checkPlagiarism(text, {
    providers: [
      multi([
        { id: "quoter", text: `As noted before, ${ORIGINAL}, which we follow.`, year: 2020 },
        { id: "original", text: `Abstract. ${ORIGINAL} that are substantially deeper.`, year: 2015 },
      ]),
    ],
  });
  assert.equal(r.spans.length, 1);
  assert.deepEqual(r.spans[0]?.sourceIds, ["original", "quoter"]);
  assert.equal(r.sources[0]?.id, "original");
  assert.equal(r.sources[1]?.primaryWords, 0);
  const credited = r.sources.reduce((n, s) => n + s.primaryPercent, 0);
  assert.ok(Math.abs(credited - r.similarity) < 0.2, `${credited} vs ${r.similarity}`);
  const ex = r.spans[0]?.sourceExcerpt;
  assert.ok(ex, "has a source excerpt");
  assert.match(ex!.text.slice(ex!.matchStart, ex!.matchEnd).toLowerCase(), /^deeper neural networks.*training of networks$/);
  assert.ok(r.searched.length > 0);
});

test("matches are marked cited or uncited, and quotations without a citation are listed", async () => {
  const cited = `Our classifiers were trained on leaf photographs. ${ORIGINAL} (He et al., 2016). We used twelve layers.`;
  const r1 = await checkPlagiarism(cited, { providers: [multi([{ id: "o", text: ORIGINAL }])] });
  assert.equal(r1.spans[0]?.cited, true);
  assert.equal(r1.spans[0]?.citation, "He et al., 2016");
  const uncited = `Our classifiers were trained on leaf photographs. ${ORIGINAL}. We used twelve layers.`;
  const r2 = await checkPlagiarism(uncited, { providers: [multi([{ id: "o", text: ORIGINAL }])] });
  assert.equal(r2.spans[0]?.cited, false);

  const quoted = `Our classifiers were trained on leaf photographs. As one paper put it, "residual connections make very deep networks trainable in practice". We used twelve layers.`;
  const r3 = await checkPlagiarism(quoted, { providers: [] });
  assert.equal(r3.quotes.length, 1);
  assert.equal(r3.quotes[0]?.cited, false);
});

test("short texts have every sentence searched, with short sentences joined", () => {
  const sentences = [
    "Leaf photographs were collected from four farms in the coastal district during two monsoon seasons.",
    "Short note here.",
    "Residual connections allow very deep convolutional networks to be optimised without degradation of accuracy.",
    "Our own classifier used twelve layers and was trained for forty epochs on one graphics card.",
  ];
  const text = sentences.join(" ");
  const ps = selectPassages(text, 40);
  for (const s of sentences) {
    const at = text.indexOf(s);
    assert.ok(ps.some((p) => p.start <= at && p.end >= at + s.length), `not searched: ${s}`);
  }
  assert.ok(ps.every((a, i) => ps.every((b, j) => i === j || a.end <= b.start || b.end <= a.start)), "passages do not overlap");
});
