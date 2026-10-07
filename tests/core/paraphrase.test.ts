import assert from "node:assert/strict";
import { test } from "node:test";
import { conceptSet, findParaphrases } from "../../src/core/plagiarism/paraphrase.ts";
import { checkPlagiarism } from "../../src/core/plagiarism/check.ts";
import { pickPhrases } from "../../src/core/plagiarism/passages.ts";
import { europePmcProvider, phrasesOf, stripMarkup, wikipediaProvider, coreProvider, arxivProvider } from "../../src/core/plagiarism/providers.ts";
import { createHttp } from "../../src/core/infra/http.ts";
import { jsonResponse, mockFetch, noSleep, textResponse } from "./helpers.ts";

const RESNET =
  "Deeper neural networks are more difficult to train. We present a residual learning framework to ease the training of networks that are substantially deeper than those used previously.";

test("conceptSet folds word forms and synonyms together", () => {
  assert.deepEqual([...conceptSet("We demonstrate substantial increases")], [...conceptSet("we showed considerable rises")]);
});

test("findParaphrases catches rewording and ignores unrelated sentences", () => {
  const mine =
    "We introduce a residual learning approach that makes it easier to train networks considerably deeper than earlier ones. " +
    "Soil samples were collected in spring and stored at four degrees before the laboratory analysis began.";
  const m = findParaphrases(mine, [{ id: "resnet", text: RESNET }]);
  assert.equal(m.length, 1);
  assert.match(m[0]!.text, /^We introduce a residual learning approach/);
  assert.match(m[0]!.sourceText, /^We present a residual learning framework/);
  assert.ok(m[0]!.similarity >= 0.6);
});

test("a same-topic sentence with different content is not a paraphrase", () => {
  const mine = "Residual networks with batch normalization were trained on satellite images of crop fields for twenty epochs.";
  assert.equal(findParaphrases(mine, [{ id: "resnet", text: RESNET }]).length, 0);
});

test("pickPhrases probes every sentence of a passage", () => {
  const phrases = pickPhrases("Our own models used twelve layers on one graphics card. Deeper networks are more difficult to train.");
  assert.equal(phrases.length, 2);
  assert.ok(phrases.some((p) => p.startsWith("Deeper networks are more difficult")));
});

test("checkPlagiarism reports reworded sentences separately from exact matches", async () => {
  const text =
    "Our field study ran for three seasons. We introduce a residual learning approach that makes it easier to train networks considerably deeper than earlier ones. The plots were weeded by hand every week.";
  const r = await checkPlagiarism(text, { library: [{ id: "r", title: "ResNet", text: RESNET }] });
  assert.equal(r.similarity, 0);
  assert.equal(r.paraphrases.length, 1);
  assert.ok(r.paraphrasePercent > 30);
  assert.equal(r.sources[0]?.title, "ResNet");
});

const http = (fetch: typeof globalThis.fetch) => createHttp({ fetch, sleep: noSleep, retries: 0 });
const passage = { start: 0, end: 10, text: "x", score: 1, phrase: "one two three four five six", phrases: ["alpha beta gamma delta epsilon zeta", "eta theta iota kappa lambda mu"], keywords: "k" };

test("phrasesOf drops probes that are too short to be distinctive", () => {
  assert.deepEqual(phrasesOf({ ...passage, phrases: ["too short", "alpha beta gamma delta epsilon"] }), ["alpha beta gamma delta epsilon"]);
});

test("Europe PMC provider searches each phrase and fetches open-access full text", async () => {
  const { fetch, calls } = mockFetch((c) => {
    if (c.url.includes("fullTextXML")) return textResponse("<article><body><p>Full <b>text</b> here.</p><ref-list>refs</ref-list></body></article>");
    if (c.url.includes("alpha")) return jsonResponse({ resultList: { result: [] } });
    return jsonResponse({ resultList: { result: [{ id: "1", source: "MED", pmcid: "PMC1", doi: "10.1/X", title: "T", isOpenAccess: "Y", inEPMC: "Y", pubYear: "2020" }] } });
  });
  const docs = await europePmcProvider(http(fetch)).search(passage);
  assert.equal(calls.length, 3);
  assert.match(decodeURIComponent(calls[1]!.url), /query="eta theta iota kappa lambda mu"/);
  assert.equal(docs[0]?.id, "doi:10.1/x");
  assert.match(docs[0]!.text, /Full text here\./);
  assert.ok(!docs[0]!.text.includes("refs"));
});

test("Wikipedia provider fetches the matching article text", async () => {
  const { fetch } = mockFetch((c) =>
    c.url.includes("list=search")
      ? jsonResponse({ query: { search: [{ pageid: 7, title: "Soil" }] } })
      : jsonResponse({ query: { pages: { "7": { extract: "Soil is a mixture.", fullurl: "https://en.wikipedia.org/wiki/Soil" } } } }),
  );
  const docs = await wikipediaProvider(http(fetch)).search(passage);
  assert.deepEqual(docs.map((d) => [d.title, d.url, d.kind]), [["Soil (Wikipedia)", "https://en.wikipedia.org/wiki/Soil", "web"]]);
});

test("CORE provider sends the key as a header and uses full text", async () => {
  const { fetch, calls } = mockFetch(() => jsonResponse({ results: [{ id: 5, title: "Paper", fullText: "Body text." }] }));
  const docs = await coreProvider(http(fetch), "core-key").search(passage);
  assert.equal(calls[0]?.headers.authorization, "Bearer core-key");
  assert.match(docs[0]!.text, /Body text/);
});

test("arXiv provider tries exact phrases before keywords", async () => {
  const asked: string[] = [];
  const p = arxivProvider({
    search: async (q) => (asked.push(`kw:${q}`), []),
    searchAbstractPhrase: async (q) => (asked.push(`ph:${q}`), []),
  });
  await p.search(passage);
  assert.deepEqual(asked, ["ph:alpha beta gamma delta epsilon zeta", "ph:eta theta iota kappa lambda mu", "kw:k"]);
});

test("stripMarkup keeps paragraphs and drops reference lists and formulas", () => {
  assert.equal(stripMarkup("<p>A <i>b</i>.</p><disp-formula>x=1</disp-formula><p>C.</p>"), "A b . C.");
});

test("cleanPhrase strips query syntax so a phrase cannot break a search", async () => {
  const { cleanPhrase } = await import("../../src/core/citations/sources/openalex.ts");
  assert.equal(cleanPhrase('cells (n = 12), "treated" AND washed: twice'), "cells n 12 treated and washed twice");
});

test("OpenAlex provider tries exact phrases first and keeps the confirmed phrase in the text", async () => {
  const { openAlexProvider } = await import("../../src/core/plagiarism/providers.ts");
  const asked: string[] = [];
  const work = { title: "Deep residual learning", authors: [], doi: "10.1/resnet", sources: ["openalex" as const] };
  const p = openAlexProvider({
    search: async (q) => (asked.push(`kw:${q}`), []),
    searchPhrase: async (q) => (asked.push(`ph:${q}`), q.startsWith("eta") ? [work] : []),
  });
  const docs = await p.search(passage);
  assert.deepEqual(asked, ["ph:alpha beta gamma delta epsilon zeta", "ph:eta theta iota kappa lambda mu"]);
  assert.equal(docs[0]?.id, "doi:10.1/resnet");
  assert.match(docs[0]!.text, /… eta theta iota kappa lambda mu$/);
});

test("OpenAlex phrase search sends a quoted, cleaned phrase", async () => {
  const { createOpenAlex } = await import("../../src/core/citations/sources/openalex.ts");
  const { fetch, calls } = mockFetch(() => jsonResponse({ results: [] }));
  await createOpenAlex(http(fetch), { apiKey: "k" }).searchPhrase?.("residual (learning) framework to ease");
  assert.match(decodeURIComponent(calls[0]!.url), /works\?search="residual learning framework to ease"&/);
  assert.equal(calls[0]?.headers.authorization, "Bearer k");
});
