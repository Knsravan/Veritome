import assert from "node:assert/strict";
import { test } from "node:test";
import { checkNumbersPreserved, numberTokens, protect, restore } from "../../src/core/text/protect.ts";

const SAMPLE =
  "Prior work (Smith & Lee, 2020; Wang et al., 2019) and Jones et al. (2021) found a 12.5% gain [1, 2] on $x^2 + y$ " +
  "(see Fig. 3 and Table 2), as described at https://example.org/a?b=1 and doi 10.1000/xyz123.";

test("protect masks citations, maths, urls, doi and figure references", () => {
  const { masked, spans } = protect(SAMPLE);
  const kinds = spans.map((s) => s.kind);
  assert.ok(kinds.includes("cite"));
  assert.ok(kinds.includes("math"));
  assert.ok(kinds.includes("url"));
  assert.ok(kinds.includes("doi"));
  assert.ok(kinds.includes("ref"));
  assert.ok(!masked.includes("Smith"));
  assert.ok(!masked.includes("[1, 2]"));
  assert.ok(!masked.includes("https://"));
  assert.ok(masked.includes("12.5%"), "plain numbers stay visible so the sentence reads naturally");
});

test("author-year pattern does not swallow ordinary parentheses", () => {
  const { spans } = protect("The method (in 2020 terms) works (as expected) well.");
  assert.equal(spans.length, 0);
});

test("restore round-trips exactly", () => {
  const { masked, spans } = protect(SAMPLE);
  const r = restore(masked, spans);
  assert.equal(r.text, SAMPLE);
  assert.ok(r.ok);
});

test("restore tolerates whitespace inside braces and reports problems", () => {
  const { spans } = protect("A [1] and B [2] and C [3].");
  const r = restore("Alpha {{ P1 }} and {{P1}} plus {{P99}}.", spans);
  assert.deepEqual(r.missing, [2, 3]);
  assert.deepEqual(r.duplicated, [1]);
  assert.deepEqual(r.unknown, [99]);
  assert.equal(r.ok, false);
});

test("quotes are protected only when asked", () => {
  const text = 'He wrote "this is a rather long quotation that must remain word for word intact" in 1990.';
  assert.equal(protect(text).spans.length, 0);
  const withQuotes = protect(text, { quotes: true });
  assert.equal(withQuotes.spans.length, 1);
  assert.equal(withQuotes.spans[0]?.kind, "quote");
});

test("numberTokens and checkNumbersPreserved detect changed data", () => {
  assert.deepEqual(numberTokens("n = 120, p < 0.05, 3.5e-3 and −4 in COVID-19"), ["120", "0.05", "3.5e-3", "-4", "19"]);
  assert.equal(checkNumbersPreserved("We used 120 samples and 3 groups.", "Three groups and 120 samples").ok, false);
  const reordered = checkNumbersPreserved("We used 120 samples and 3 groups.", "In 3 groups we used 120 samples.");
  assert.equal(reordered.ok, true);
  const changed = checkNumbersPreserved("The gain was 12.5%.", "The gain was 15.2%.");
  assert.deepEqual(changed.missing, ["12.5"]);
  assert.deepEqual(changed.added, ["15.2"]);
});
