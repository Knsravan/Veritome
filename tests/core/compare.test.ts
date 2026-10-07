import assert from "node:assert/strict";
import { test } from "node:test";
import { comparePapers } from "../../src/core/plagiarism/compare.ts";

const SHARED = "Waterlogged sediments kept microbial activity unusually elevated across the floodplain well into October, long after upland plots had cooled.";
const TEMPLATE = "Question one asks you to describe the seasonal pattern of soil respiration in your own words and explain it.";

test("finds the pair that shares a passage and where it is in each paper", async () => {
  const r = await comparePapers([
    { id: "a", name: "Ana", text: `My own opening sentence about forests and rivers. ${SHARED} Then my own ending.` },
    { id: "b", name: "Ben", text: `${SHARED} Ben wrote this differently about grasslands entirely.` },
    { id: "c", name: "Cat", text: "Cat studied coastal dunes and wrote about sand movement over three winters in detail." },
  ]);
  const top = r.pairs[0]!;
  assert.deepEqual([top.a, top.b], ["a", "b"]);
  assert.equal(top.passages.length, 1);
  assert.ok(top.aPercent > 50 && top.bPercent > 60, `${top.aPercent} ${top.bPercent}`);
  const ana = `My own opening sentence about forests and rivers. ${SHARED} Then my own ending.`;
  assert.equal(ana.slice(top.passages[0]!.aStart, top.passages[0]!.aEnd), SHARED.replace(/\.$/, ""));
  assert.equal(r.pairs.find((p) => p.b === "c")?.sharedWords, 0);
});

test("text everyone was given (the assignment questions) is ignored", async () => {
  const papers = [
    { id: "a", name: "Ana", text: `${TEMPLATE} Ana answers about alder stands near the river in her own way.` },
    { id: "b", name: "Ben", text: `${TEMPLATE} Ben answers about upland pine plots with completely different words.` },
  ];
  assert.ok((await comparePapers(papers)).pairs[0]!.sharedWords > 0);
  assert.equal((await comparePapers(papers, { ignore: TEMPLATE })).pairs[0]!.sharedWords, 0);
});
