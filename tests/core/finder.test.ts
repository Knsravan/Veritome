import assert from "node:assert/strict";
import { test } from "node:test";
import { buildQuery, extractKeyphrases, findClaimsNeedingCitations, rankWorks, suggestCitations } from "../../src/core/citations/finder.ts";
import type { Work } from "../../src/core/citations/types.ts";

const TEXT = [
  "Several studies have shown that sleep deprivation significantly impairs working memory in adults.",
  "We trained the model for ten epochs on a single GPU.",
  "Smartphone use among teenagers has increased by 40% over the last decade (Jones, 2021).",
  "Table 2 shows the distribution of participants across the three conditions.",
  "Obesity is strongly associated with an increased risk of type 2 diabetes in middle-aged populations.",
  "Is this a question about something that needs a citation?",
  "Short claim here.",
].join(" ");

test("claims needing citations: flags unsupported general claims, skips own work, cited and short sentences", () => {
  const found = findClaimsNeedingCitations(TEXT);
  const texts = found.map((f) => f.text);
  assert.equal(found.length, 2, JSON.stringify(texts));
  assert.match(texts[0] ?? "", /sleep deprivation/);
  assert.match(texts[1] ?? "", /Obesity/);
  assert.ok(found[0]?.reasons.includes("refers to prior studies"));
  for (const f of found) assert.equal(TEXT.slice(f.start, f.end), f.text);
});

test("claims: a lower threshold finds weaker claims", () => {
  const text = "Smartphone use among teenagers has increased by 40% over the last decade overall.";
  assert.equal(findClaimsNeedingCitations(text).length, 0);
  assert.equal(findClaimsNeedingCitations(text, { minScore: 2 }).length, 1);
});

test("keyphrases pick distinctive words in order and drop generic ones", () => {
  const k = extractKeyphrases("Several studies have shown that sleep deprivation significantly impairs working memory in adults.");
  assert.deepEqual(k, ["sleep", "deprivation", "impairs", "working", "memory", "adults"]);
  assert.equal(buildQuery("It is what it is."), "");
  assert.ok(extractKeyphrases("The CNN architecture improves MRI segmentation accuracy.").includes("cnn"));
  assert.ok(extractKeyphrases("a ".repeat(30) + "Transformer-based language models excel at translation tasks across languages worldwide today").length <= 7);
});

const works: Work[] = [
  {
    title: "Sleep deprivation and working memory in healthy adults: a meta-analysis",
    authors: [{ family: "Lim", given: "Julian" }],
    year: 2010,
    doi: "10.1/sleep",
    abstract: "Working memory performance declines after sleep deprivation in adults.",
    citationCount: 900,
    sources: ["openalex"],
  },
  {
    title: "Sleep patterns in newborn infants",
    authors: [{ family: "Roe", given: "Rita" }],
    year: 2015,
    doi: "10.1/infants",
    citationCount: 5,
    sources: ["openalex"],
  },
  {
    title: "A completely unrelated study of soil microbes",
    authors: [{ family: "Fern", given: "Flo" }],
    year: 2018,
    doi: "10.1/soil",
    citationCount: 100000,
    sources: ["crossref"],
  },
  {
    title: "Retracted: Sleep deprivation improves working memory in adults",
    authors: [{ family: "Fake", given: "Fay" }],
    year: 2012,
    doi: "10.1/fake",
    retraction: { status: "retracted", source: "Crossref" },
    sources: ["crossref"],
  },
];

test("rankWorks puts the topical paper first, drops unrelated work and demotes retracted papers", () => {
  const claim = "Several studies have shown that sleep deprivation significantly impairs working memory in adults.";
  const ranked = rankWorks(claim, works);
  assert.equal(ranked[0]?.work.doi, "10.1/sleep");
  assert.ok(!ranked.some((r) => r.work.doi === "10.1/soil"), "a hugely cited but unrelated paper must not appear");
  const fake = ranked.find((r) => r.work.doi === "10.1/fake");
  if (fake) {
    assert.ok(fake.relevance < (ranked[0]?.relevance ?? 0));
    assert.match(fake.reason, /do not cite without checking/);
  }
  assert.ok(ranked[0]?.matchedTerms.includes("memory"));
});

test("suggestCitations merges providers, dedupes by DOI, and survives provider failures", async () => {
  const claim = "Several studies have shown that sleep deprivation significantly impairs working memory in adults.";
  const calls: string[] = [];
  const result = await suggestCitations(
    claim,
    {
      openalex: { search: async (q) => (calls.push(`oa:${q}`), [works[0] as Work, works[1] as Work]) },
      crossref: { search: async () => [{ ...(works[0] as Work), sources: ["crossref"], abstract: undefined, citationCount: 100 }] },
      semanticscholar: {
        search: async () => {
          throw new Error("HTTP 429");
        },
      },
    },
    { limit: 3 },
  );
  assert.equal(calls[0], "oa:sleep deprivation impairs working memory adults");
  assert.equal(result.suggestions[0]?.work.doi, "10.1/sleep");
  assert.deepEqual(result.suggestions[0]?.work.sources.sort(), ["crossref", "openalex"]);
  assert.equal(result.suggestions.filter((s) => s.work.doi === "10.1/sleep").length, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? "", /Semantic Scholar could not be searched \(HTTP 429\)/);
});

test("suggestCitations: year filter, empty query and no matches", async () => {
  const claim = "Several studies have shown that sleep deprivation significantly impairs working memory in adults.";
  const deps = { openalex: { search: async () => works } };
  const recent = await suggestCitations(claim, deps, { yearFrom: 2014 });
  assert.ok(recent.suggestions.every((s) => (s.work.year ?? 0) >= 2014));
  const empty = await suggestCitations("It is what it is.", deps);
  assert.equal(empty.suggestions.length, 0);
  assert.match(empty.warnings[0] ?? "", /too few distinctive words/);
  const none = await suggestCitations(claim, { openalex: { search: async () => [works[2] as Work] } });
  assert.equal(none.suggestions.length, 0);
  assert.match(none.warnings.join(" "), /No close matches/);
});
