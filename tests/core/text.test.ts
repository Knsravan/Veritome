import assert from "node:assert/strict";
import { test } from "node:test";
import { splitParagraphs, splitSentences } from "../../src/core/text/sentences.ts";
import { blankQuotedText, splitReferences } from "../../src/core/text/sections.ts";
import { countSyllables, countWords, ngrams, tokenize } from "../../src/core/text/tokens.ts";
import { cv, entropy, mean, median, stdev } from "../../src/core/text/stats.ts";

test("splitSentences keeps offsets that point back into the source", () => {
  const text = "First sentence here. Second one follows! Is this the third? Yes it is.";
  const s = splitSentences(text);
  assert.equal(s.length, 4);
  for (const sentence of s) assert.equal(text.slice(sentence.start, sentence.end), sentence.text);
  assert.equal(s[2]?.text, "Is this the third?");
});

test("splitSentences does not break on abbreviations, initials, decimals or citations", () => {
  const text =
    "We followed J. Smith et al. (2020) closely, e.g. by using Fig. 3 and p. 4. The mean was 3.14 overall. Dr. Lee agreed.";
  const s = splitSentences(text).map((x) => x.text);
  assert.deepEqual(s, [
    "We followed J. Smith et al. (2020) closely, e.g. by using Fig. 3 and p. 4.",
    "The mean was 3.14 overall.",
    "Dr. Lee agreed.",
  ]);
});

test("splitSentences treats 'et al.' followed by a capital as a sentence end", () => {
  const s = splitSentences("This was shown by Wang et al. The next result differs.").map((x) => x.text);
  assert.equal(s.length, 2);
});

test("splitSentences treats blank lines as hard boundaries", () => {
  const s = splitSentences("A heading without a period\n\nThe body starts here.");
  assert.equal(s.length, 2);
  assert.equal(s[0]?.text, "A heading without a period");
});

test("splitParagraphs returns trimmed paragraphs with offsets", () => {
  const text = "One.\nStill one.\n\n  Two.  \n\n\nThree.";
  const p = splitParagraphs(text);
  assert.equal(p.length, 3);
  for (const para of p) assert.equal(text.slice(para.start, para.end), para.text);
});

test("tokenize keeps apostrophes and hyphens inside words and normalises case", () => {
  const t = tokenize("Don’t over-think the Well-Known results, 42 times.");
  assert.deepEqual(
    t.map((x) => x.word),
    ["don't", "over-think", "the", "well-known", "results", "42", "times"],
  );
  assert.equal(countWords("one two  three"), 3);
});

test("ngrams returns index of first token", () => {
  const g = ngrams(["a", "b", "c", "d"], 3);
  assert.deepEqual(g, [
    { gram: "a b c", index: 0 },
    { gram: "b c d", index: 1 },
  ]);
});

test("countSyllables is sensible on common words", () => {
  assert.equal(countSyllables("cat"), 1);
  assert.equal(countSyllables("research"), 2);
  assert.equal(countSyllables("beautiful"), 3);
  assert.equal(countSyllables("education"), 4);
});

test("stats helpers", () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.ok(Math.abs(stdev([2, 4, 4, 4, 5, 5, 7, 9]) - 2.138) < 0.01);
  assert.equal(cv([0, 0]), 0);
  assert.equal(entropy([1, 1]), 1);
});

test("splitReferences finds the last heading in the second half", () => {
  const body = "Introduction text. ".repeat(40);
  const text = `References\n(table of contents entry)\n${body}\nReferences\n[1] A. Author, "Title", 2020.`;
  const r = splitReferences(text);
  assert.ok(r.referencesStart > text.length / 2);
  assert.match(r.references, /A\. Author/);
  assert.ok(!r.body.includes("A. Author"));
});

test("splitReferences handles documents without a reference list", () => {
  const r = splitReferences("Just a body of text.");
  assert.equal(r.referencesStart, -1);
  assert.equal(r.references, "");
});

test("splitReferences finds a heading run into its first entry, and IEEE small caps", () => {
  const body = "Body sentence about methods [1]. ".repeat(40);
  for (const heading of ["REFERENCES", "R EFERENCES"]) {
    const text = `${body}\n\n${heading} [1] A. Author, "Title," 2020. [2] B. Author, "Other," 2021.`;
    const r = splitReferences(text);
    assert.ok(r.referencesStart > 0, heading);
    assert.match(r.references, /^\[1\] A\. Author/);
    assert.ok(!r.body.includes("A. Author"));
  }
  const own = splitReferences(`${body}\nR EFERENCES\n[1] A. Author, 2020.`);
  assert.match(own.references, /A\. Author/);
});

test("splitReferences finds a numbered list without a heading at the end", () => {
  const body = "Prior work [1], [2] shows this. Recent studies [3] agree. ".repeat(30);
  const refs = Array.from({ length: 8 }, (_, i) => `[${i + 1}] A. Writer${i}, "A study of things," in Proc. Conf., 2020.`).join(" ");
  const text = `${body}\n\n${refs}`;
  const r = splitReferences(text);
  assert.equal(r.referencesStart, text.indexOf("[1] A. Writer0"));
  assert.ok(!r.body.includes("Writer0"));
  // In-text citations alone are not a reference list.
  assert.equal(splitReferences(body).referencesStart, -1);
});

test("blankQuotedText preserves offsets", () => {
  const text = 'He said "this is a long quotation that should be blanked out of the text" and left.';
  const blanked = blankQuotedText(text);
  assert.equal(blanked.length, text.length);
  assert.ok(!blanked.includes("quotation"));
  assert.ok(blanked.includes("and left."));
});
