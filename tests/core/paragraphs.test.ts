import assert from "node:assert/strict";
import { test } from "node:test";
import { paragraphStats } from "../../src/core/report/paragraphs.ts";

test("paragraph stats measure matched text per paragraph and skip headings and references", () => {
  const p1 = "First paragraph has eight or more words in it and nothing copied at all.";
  const p2 = "Second paragraph also has more than eight words and this part is copied text.";
  const text = `Title line\n\n${p1}\n\n${p2}\n\nReferences\n\nSmith, J. (2020). A paper. Journal, 1, 2-3.`;
  const s2 = text.indexOf(p2);
  const copied = p2.indexOf("this part");
  const stats = paragraphStats(text, { spans: [{ start: s2 + copied, end: s2 + p2.length - 1 }], paraphrases: [] });
  assert.equal(stats.length, 2);
  assert.equal(stats[0]?.copied, 0);
  assert.ok((stats[1]?.copied ?? 0) > 0.2 && (stats[1]?.copied ?? 0) < 0.5);
  assert.equal(stats[1]?.index, 2);
});
