import assert from "node:assert/strict";
import { test } from "node:test";
import type { Work } from "../../src/core/citations/types.ts";
import type { SourceProvider } from "../../src/core/plagiarism/providers.ts";
import { buildActionList, buildPaperReport, documentStats } from "../../src/core/report/index.ts";

const SOURCE_SENTENCE =
  "Riparian alder stands sustain unusually high autumn soil respiration because nitrogen fixation keeps root activity elevated late into the season";

const PAPER = [
  "Soil respiration in riparian alder stands",
  `We measured soil respiration at 14 sites over two summers (Smith & Lee, 2020). ${SOURCE_SENTENCE}. Temperature explained about half of the variance [1].`,
  "Moreover, it is important to note that this plays a pivotal role in carbon budgets. Furthermore, these findings delve into the complexities of riparian ecosystems. Additionally, they provide valuable insights into the realm of soil science. Overall, the results underscore the importance of long-term monitoring.",
  "Studies have shown that riparian zones account for 30% of regional soil carbon efflux in temperate catchments.",
  "References",
  "Smith, J., & Lee, K. (2020). Soil carbon fluxes in riparian zones. Ecology, 101(3), 1-12. https://doi.org/10.1000/eco.2020.1",
].join("\n\n");

const work: Work = {
  title: "Soil carbon fluxes in riparian zones",
  authors: [{ family: "Smith", given: "J." }, { family: "Lee", given: "K." }],
  year: 2020,
  container: "Ecology",
  volume: "101",
  issue: "3",
  pages: "1-12",
  doi: "10.1000/eco.2020.1",
  sources: ["crossref"],
};

const provider: SourceProvider = {
  name: "Fake",
  kind: "scholarly",
  coverage: "test",
  async search() {
    return [{ id: "doi:10.1/x", title: "Alder paper", text: `${SOURCE_SENTENCE}.`, provider: "Fake", kind: "scholarly" }];
  },
};

test("buildPaperReport runs every tool and builds an overview", async () => {
  const progress: string[] = [];
  const report = await buildPaperReport(
    PAPER,
    {
      providers: [provider],
      verifier: { crossref: { getWork: async () => work, search: async () => [work] } },
      finder: { crossref: { search: async () => [work] } },
    },
    { onProgress: (t, s) => progress.push(`${t}:${s}`) },
  );
  assert.ok(report.hasReferenceList);
  assert.equal(report.overview.length, 6);
  assert.ok(progress.includes("paraphrase:done"));

  assert.equal(report.plagiarism.status, "done");
  if (report.plagiarism.status === "done") assert.ok(report.plagiarism.result.similarity > 10);

  assert.equal(report.citations.status, "done");
  if (report.citations.status === "done") {
    const c = report.citations.result;
    assert.equal(c.references.length, 1);
    assert.equal(c.verification?.checks[0]?.status, "verified");
    assert.ok(c.claims.some((x) => /30%/.test(x.text)));
    assert.equal(c.suggestions.length >= 1, true);
  }

  assert.equal(report.paraphrase.status, "done");
  if (report.paraphrase.status === "done") {
    assert.equal(report.paraphrase.result.length, 1);
    assert.ok(report.paraphrase.result[0]!.result.original.includes("Riparian alder stands sustain"));
  }
  assert.equal(report.humanise.status, "done");
  if (report.humanise.status === "done") {
    assert.equal(report.humanise.result.length, 1);
    assert.equal(report.humanise.result[0]!.result.method, "rules");
    assert.ok(!/delve into/.test(report.humanise.result[0]!.result.text));
  }
  assert.equal(report.grammar.status, "done");
  assert.equal(report.detector.status, "done");
});

test("disabled tools are skipped and failures are contained", async () => {
  const report = await buildPaperReport(
    PAPER,
    { verifier: { crossref: { getWork: async () => Promise.reject(new Error("down")), search: async () => Promise.reject(new Error("down")) } } },
    { tools: { grammar: false, paraphrase: false } },
  );
  assert.equal(report.grammar.status, "skipped");
  assert.equal(report.overview.find((o) => o.tool === "grammar")?.status, "skipped");
  assert.equal(report.paraphrase.status, "skipped");
  assert.equal(report.citations.status, "done");
  if (report.citations.status === "done") assert.equal(report.citations.result.verification?.checks[0]?.status, "unchecked");
  const pl = report.overview.find((o) => o.tool === "plagiarism");
  assert.match(pl?.headline ?? "", /no external search configured/);
});

test("buildActionList ranks a copied passage and a missing reference above style notes", async () => {
  const notFound = PAPER.replace("References", "Ripley (2019) disagreed.\n\nReferences");
  const steps: number[] = [];
  const report = await buildPaperReport(
    notFound,
    {
      providers: [provider],
      verifier: { crossref: { getWork: async () => null, search: async () => [] } },
    },
    { tools: { paraphrase: false, humanise: false }, onStep: (tool, done) => tool === "plagiarism" && steps.push(done) },
  );
  assert.ok(steps.length > 0, "plagiarism reports passage progress");
  const actions = buildActionList(report);
  assert.ok(actions.length > 0);
  assert.equal(actions[0]!.level, "high");
  const copied = actions.find((a) => a.tool === "plagiarism");
  assert.ok(copied && /match “Alder paper”/.test(copied.title));
  assert.ok(actions.some((a) => a.tool === "citations" && /Ripley/.test(a.title)), "uncited in-text citation listed");
  assert.ok(actions.some((a) => /Reference 1 was not found/.test(a.title)));
  const levels = actions.map((a) => ["high", "medium", "low"].indexOf(a.level));
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b), "most important first");

  const stats = documentStats(report, notFound);
  assert.equal(stats.references, 1);
  assert.ok(stats.words > 50 && stats.readingMinutes >= 1);
});

test("buildActionList has nothing urgent for a clean text", async () => {
  const report = await buildPaperReport("A short note with nothing to flag in it at all.", {}, { tools: { citations: false, grammar: false } });
  assert.deepEqual(
    buildActionList(report).filter((a) => a.level === "high"),
    [],
  );
});

test("a long paper without a reference list is flagged for review", async () => {
  const long = Array.from({ length: 120 }, (_, i) => `Sentence ${i} describes the river sites and their soil in plain words.`).join(" ");
  const report = await buildPaperReport(long, {}, { tools: { plagiarism: false, detector: false, grammar: false, paraphrase: false, humanise: false } });
  const c = report.overview.find((o) => o.tool === "citations");
  assert.equal(c?.status, "review");
  assert.match(c?.headline ?? "", /No reference list/);
});
