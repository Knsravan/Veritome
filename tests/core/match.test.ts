import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBodyIndex, coverage, findRuns, findSelfRepeats } from "../../src/core/plagiarism/match.ts";
import { tokenize } from "../../src/core/text/tokens.ts";

const idx = (text: string) => buildBodyIndex(tokenize(text));
const words = (text: string) => tokenize(text).map((t) => t.word);

const BODY =
  "Climate change is altering the distribution of many marine species. In our experiments, juvenile cod showed reduced growth at elevated temperatures. We then repeated the assay with a second population.";

test("finds an exact copied run and reports token positions", () => {
  const source = "Previous work reports that juvenile cod showed reduced growth at elevated temperatures in laboratory tanks.";
  const runs = findRuns(idx(BODY), words(source));
  assert.equal(runs.length, 1);
  const run = runs[0];
  assert.equal(run?.matchedWords, 8);
  const t = tokenize(BODY);
  assert.equal(t.slice(run?.start, run?.end).map((x) => x.raw).join(" "), "juvenile cod showed reduced growth at elevated temperatures");
});

test("bridges small edits so light rewording still matches", () => {
  const source = "juvenile cod showed clearly reduced growth at the elevated temperatures tested";
  const strict = findRuns(idx(BODY), words(source), { maxGap: 0, minRun: 6 });
  const fuzzy = findRuns(idx(BODY), words(source), { maxGap: 2, minRun: 6 });
  assert.equal(strict.length, 0, "no exact run of 6 words exists");
  assert.equal(fuzzy.length, 1);
  assert.ok((fuzzy[0]?.matchedWords ?? 0) >= 6);
});

test("short coincidental overlaps and boilerplate are ignored", () => {
  const source = "in the case of the study we found nothing relevant at all";
  assert.equal(findRuns(idx("As in the case of the other work, nothing happened."), words(source)).length, 0);
  assert.equal(findRuns(idx(BODY), words("juvenile cod showed reduced")).length, 0, "four words is below the minimum run");
});

test("no overlap gives no runs; empty inputs are safe", () => {
  assert.deepEqual(findRuns(idx(BODY), words("Quantum chromodynamics describes the strong interaction between quarks and gluons.")), []);
  assert.deepEqual(findRuns(idx(""), words("anything at all here")), []);
  assert.deepEqual(findRuns(idx(BODY), []), []);
});

test("coverage is the union of runs over the text", () => {
  const body = idx(BODY);
  const total = body.words.length;
  const runs = [
    { start: 0, end: 10, sourceStart: 0, matchedWords: 10 },
    { start: 5, end: 15, sourceStart: 0, matchedWords: 10 },
  ];
  assert.equal(coverage(total, runs), 15 / total);
  assert.equal(coverage(0, runs), 0);
});

test("repeated long run within one source maps to a single run", () => {
  const source = `${"juvenile cod showed reduced growth at elevated temperatures"} and later ${"juvenile cod showed reduced growth at elevated temperatures"}`;
  const runs = findRuns(idx(BODY), words(source));
  assert.equal(runs.length, 1);
});

test("self repeats find copied passages inside one manuscript", () => {
  const text =
    "We measured growth rates across twelve tanks over eight weeks of continuous observation. Many other things happened in between those weeks and nobody noticed. " +
    "Later we wrote that we measured growth rates across twelve tanks over eight weeks of continuous observation again.";
  const repeats = findSelfRepeats(tokenize(text), 12);
  assert.equal(repeats.length, 1);
  assert.ok((repeats[0]?.first.matchedWords ?? 0) >= 12);
  assert.ok((repeats[0]?.second.start ?? 0) > (repeats[0]?.first.start ?? 0));
  assert.equal(findSelfRepeats(tokenize("A short text with nothing repeated in it at all."), 12).length, 0);
});
