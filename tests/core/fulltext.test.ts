import assert from "node:assert/strict";
import { test } from "node:test";
import type { Http } from "../../src/core/infra/http.ts";
import { checkPlagiarism } from "../../src/core/plagiarism/check.ts";
import { fetchFullText } from "../../src/core/plagiarism/fulltext.ts";
import { findOwnWorks } from "../../src/core/plagiarism/ownwork.ts";
import type { SourceProvider } from "../../src/core/plagiarism/providers.ts";
import { reviewReport } from "../../src/core/plagiarism/review.ts";

const BODY =
  "We measured soil respiration at fourteen riparian sites over two summers. " +
  "Waterlogged sediments kept microbial activity unusually elevated across the floodplain well into October, long after upland plots had cooled. " +
  "Temperature alone explained about half of the variance in the late season measurements at every site we sampled.";
const FULL = "Introduction. ".repeat(200) + "Waterlogged sediments kept microbial activity unusually elevated across the floodplain well into October, long after upland plots had cooled.";

function fakeHttp(routes: Record<string, unknown>): Http & { calls: string[] } {
  const calls: string[] = [];
  const find = (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`no route for ${url}`);
    return routes[key];
  };
  return { calls, json: async (u: string) => find(u) as never, text: async (u: string) => find(u) as string };
}

test("full text comes from PubMed Central when the paper is open access there", async () => {
  const http = fakeHttp({ "search?query=DOI": { resultList: { result: [{ pmcid: "PMC1", isOpenAccess: "Y", inEPMC: "Y" }] } }, "PMC1/fullTextXML": `<article><body><p>${FULL}</p></body></article>` });
  const r = await fetchFullText({ id: "doi:10.1/x" }, { http, pdfText: async () => "" });
  assert.equal(r?.via, "PubMed Central");
  assert.ok(r!.text.includes("Waterlogged sediments"));
});

test("full text falls back to the open-access PDF OpenAlex knows of", async () => {
  const http = fakeHttp({ "search?query=DOI": { resultList: { result: [] } }, "works/doi:": { best_oa_location: { pdf_url: "https://repo.example/paper.pdf" } } });
  const asked: string[] = [];
  const r = await fetchFullText({ id: "doi:10.1/x" }, { http, pdfText: async (u) => (asked.push(u), FULL) });
  assert.deepEqual(asked, ["https://repo.example/paper.pdf"]);
  assert.equal(r?.via, "open-access PDF");
});

test("arXiv papers are read from their PDF", async () => {
  const asked: string[] = [];
  const r = await fetchFullText({ id: "x", url: "https://arxiv.org/abs/2101.00001v2" }, { http: fakeHttp({}), pdfText: async (u) => (asked.push(u), FULL) });
  assert.deepEqual(asked, ["https://arxiv.org/pdf/2101.00001"]);
  assert.equal(r?.via, "arXiv");
});

test("a paper found by its abstract is compared again in full, finding more copied text", async () => {
  const provider: SourceProvider = {
    name: "Test",
    kind: "scholarly",
    coverage: "",
    search: async () => [{ id: "doi:10.1/x", doi: "10.1/x", title: "Paper", text: "We measured soil respiration at fourteen riparian sites over two summers.", provider: "Test", kind: "scholarly" }],
  };
  const without = await checkPlagiarism(BODY, { providers: [provider], paraphrases: false });
  const withFull = await checkPlagiarism(BODY, { providers: [provider], paraphrases: false, fullText: async () => ({ text: `We measured soil respiration at fourteen riparian sites over two summers. ${FULL}`, via: "PubMed Central" }) });
  assert.ok(withFull.matchedWords > without.matchedWords, `${withFull.matchedWords} vs ${without.matchedWords}`);
  assert.equal(withFull.sources[0]?.fullText, "PubMed Central");
});

test("own earlier papers are found by ORCID and reported as reused text", async () => {
  const http = fakeHttp({
    "authors/orcid:0000-0002-1825-0097": { id: "https://openalex.org/A1", display_name: "Ada Lovelace", orcid: "https://orcid.org/0000-0002-1825-0097", last_known_institutions: [{ display_name: "Uni" }] },
    "works?filter=author.id:A1": {
      results: [{ id: "W1", doi: "https://doi.org/10.9/old", title: "Earlier paper", publication_year: 2021, abstract_inverted_index: Object.fromEntries("Waterlogged sediments kept microbial activity unusually elevated across the floodplain well into October, long after upland plots had cooled.".split(" ").map((w, i) => [w, [i]])) }],
    },
  });
  const own = await findOwnWorks("https://orcid.org/0000-0002-1825-0097", { http });
  assert.equal(own?.author.name, "Ada Lovelace");
  assert.equal(own?.author.orcid, "0000-0002-1825-0097");
  assert.equal(own?.docs[0]?.kind, "own");
  const report = await checkPlagiarism(BODY, { own: own!, paraphrases: false });
  assert.equal(report.ownAuthor?.name, "Ada Lovelace");
  const r = reviewReport(report);
  assert.ok(r.issues.some((i) => i.kind === "own_work"), JSON.stringify(r.issues.map((i) => i.kind)));
});

test("a paper in Spanish is translated and matched against English sources", async () => {
  const { detectLanguage } = await import("../../src/core/text/language.ts");
  const spanish =
    "Medimos la respiración del suelo en catorce sitios ribereños durante dos veranos. " +
    "Los sedimentos anegados mantuvieron la actividad microbiana inusualmente elevada en toda la llanura aluvial hasta bien entrado octubre. " +
    "Nuestros resultados propios muestran además un patrón nuevo que no se había descrito antes en la literatura de la región.";
  assert.equal(detectLanguage(spanish).name, "Spanish");
  const english: Record<string, string> = {
    "Medimos la respiración del suelo en catorce sitios ribereños durante dos veranos.": "We measured soil respiration at fourteen riparian sites over two summers.",
    "Los sedimentos anegados mantuvieron la actividad microbiana inusualmente elevada en toda la llanura aluvial hasta bien entrado octubre.":
      "Waterlogged sediments kept microbial activity unusually elevated across the floodplain well into October.",
    "Nuestros resultados propios muestran además un patrón nuevo que no se había descrito antes en la literatura de la región.": "Our own results also show a new pattern not described before in the regional literature.",
  };
  const provider: SourceProvider = {
    name: "Test",
    kind: "scholarly",
    coverage: "",
    search: async (p) =>
      /waterlogged|microbial/i.test(`${p.text} ${p.phrase}`)
        ? [{ id: "doi:10.1/en", title: "English paper", text: "Waterlogged sediments kept microbial activity unusually elevated across the floodplain well into October, long after upland plots cooled.", provider: "Test", kind: "scholarly" }]
        : [],
  };
  const report = await checkPlagiarism(spanish, { providers: [provider], translate: async (s) => s.map((x) => english[x] ?? "") });
  assert.equal(report.language?.name, "Spanish");
  assert.equal(report.translated?.length, 1);
  assert.match(report.translated![0]!.text, /^Los sedimentos anegados/);
  const r = reviewReport(report);
  assert.ok(r.issues.some((i) => i.kind === "translated" && i.sourceId === "doi:10.1/en"));
  assert.ok(r.primary.some((s) => s.id === "doi:10.1/en"));

  const noModel = await checkPlagiarism(spanish, { providers: [provider] });
  assert.ok(noModel.warnings.some((w) => w.includes("needs a language model")));
});

test("an older matched paper by the same author counts as their own work", async () => {
  const provider: SourceProvider = {
    name: "Test",
    kind: "scholarly",
    coverage: "",
    search: async () => [{ id: "doi:10.9/older", doi: "10.9/older", title: "Older paper", text: BODY, provider: "Test", kind: "scholarly" }],
  };
  const own = { author: { name: "Ada Lovelace", works: 0, fullTexts: 0 }, docs: [], whichAreOwn: async (dois: string[]) => new Set(dois.filter((d) => d === "10.9/older")) };
  const report = await checkPlagiarism(BODY, { providers: [provider], own, paraphrases: false });
  assert.equal(report.sources[0]?.kind, "own");
  assert.ok(reviewReport(report).issues.every((i) => i.kind === "own_work"));
});
