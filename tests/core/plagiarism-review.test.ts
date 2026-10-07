import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewReport } from "../../src/core/plagiarism/review.ts";
import type { PlagiarismReport } from "../../src/core/plagiarism/types.ts";

const source = (id: string, primaryWords: number, matchedWords = primaryWords) => ({
  id,
  title: id,
  kind: "scholarly" as const,
  provider: "Test",
  matchedWords,
  percent: matchedWords,
  primaryWords,
  primaryPercent: primaryWords,
});

const report: PlagiarismReport = {
  similarity: 30,
  verdict: "high",
  words: 100,
  matchedWords: 30,
  spans: [
    { start: 0, end: 100, words: 20, text: "long copied passage", sourceIds: ["a", "b"], cited: false },
    { start: 200, end: 240, words: 6, text: "short phrase", sourceIds: ["b"], cited: true, citation: "[2]" },
    { start: 300, end: 330, words: 4, text: "tiny", sourceIds: ["c"], cited: false },
  ],
  paraphrases: [{ start: 400, end: 450, text: "a reworded sentence with seven words", sourceId: "d", sourceText: "x", similarity: 0.7, cited: false }],
  paraphrasePercent: 7,
  sources: [source("a", 20), source("b", 6, 26), source("c", 4), source("d", 0)],
  quotes: [
    { start: 500, end: 560, text: "“a quotation without any citation at all”", cited: false },
    { start: 600, end: 660, text: "“a quotation that is cited”", cited: true },
  ],
  searched: [],
  providers: [],
  excluded: { references: true, quotes: true, referenceWords: 0 },
  warnings: [],
  disclaimer: "",
};

test("sorts findings into mistakes, most serious first", () => {
  const r = reviewReport(report);
  assert.deepEqual(
    r.issues.map((i) => i.kind),
    ["copied_uncited", "copied_uncited", "copied_cited", "reworded_uncited", "quote_uncited"],
  );
  assert.equal(r.breakdown.copied_uncited, 24);
  assert.equal(r.breakdown.copied_cited, 6);
  assert.equal(r.breakdown.quote_uncited, 1);
  assert.equal(r.similarity, 30);
  assert.deepEqual(r.primary.map((s) => s.id), ["a", "b", "c", "d"]);
});

test("hiding small matches and excluding a source recomputes the score and the credit", () => {
  const r = reviewReport(report, { minWords: 5, excludeSources: new Set(["a"]) });
  // The 20-word passage is now credited to b; the 4-word match is hidden.
  assert.equal(r.similarity, 26);
  assert.equal(r.primary[0]?.id, "b");
  assert.equal(r.primary[0]?.primaryWords, 26);
  assert.equal(r.hidden.smallMatches, 1);
  assert.ok(!r.primary.some((s) => s.id === "a") && !r.others.some((s) => s.id === "a"));
});

test("copies of a credited work found through other services are folded into it", () => {
  const dup = {
    ...report,
    sources: [
      { ...source("a", 20), title: "Deep Residual Learning for Image Recognition", provider: "arXiv" },
      { ...source("x", 0, 20), title: "[1512.03385] Deep Residual Learning for Image Recognition", provider: "Brave Search" },
      { ...source("y", 0, 20), title: "Deep residual learning for image recognition.", provider: "OpenAlex" },
      source("b", 6, 26),
      source("c", 4),
      source("d", 0),
    ],
    spans: [{ ...report.spans[0]!, sourceIds: ["a", "x", "y", "b"] }, ...report.spans.slice(1)],
  };
  const r = reviewReport(dup);
  assert.deepEqual(r.primary[0]?.alsoAt.sort(), ["Brave Search", "OpenAlex"]);
  assert.ok(!r.others.some((s) => s.id === "x" || s.id === "y"));
});
