import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bibtexKey,
  formatBibtex,
  formatInText,
  formatReference,
  formatReferenceText,
  formatRis,
  initials,
  renderHtml,
  renderMarkdown,
} from "../../src/core/citations/format.ts";
import type { Work } from "../../src/core/citations/types.ts";
import { dice, normalizeTitle, titleContainedIn, titleSimilarity } from "../../src/core/text/similarity.ts";

const article: Work = {
  title: "Deep learning for protein folding",
  authors: [
    { family: "Smith", given: "John Andrew" },
    { family: "Lee", given: "Kate" },
  ],
  year: 2020,
  container: "Nature Methods",
  volume: "17",
  issue: "3",
  pages: "245-253",
  doi: "10.1038/s41592-019-0000-0",
  type: "journal-article",
  sources: ["crossref"],
};

test("APA 7 journal article", () => {
  assert.equal(
    formatReferenceText(article, "apa"),
    "Smith, J. A., & Lee, K. (2020). Deep learning for protein folding. Nature Methods, 17(3), 245–253. https://doi.org/10.1038/s41592-019-0000-0",
  );
  assert.equal(
    renderMarkdown(formatReference(article, "apa")),
    "Smith, J. A., & Lee, K. (2020). Deep learning for protein folding. *Nature Methods*, *17*(3), 245–253. https://doi.org/10.1038/s41592-019-0000-0",
  );
});

test("MLA 9 journal article", () => {
  assert.equal(
    formatReferenceText(article, "mla"),
    "Smith, John Andrew, and Kate Lee. “Deep learning for protein folding.” Nature Methods, vol. 17, no. 3, 2020, pp. 245–253. https://doi.org/10.1038/s41592-019-0000-0.",
  );
});

test("IEEE journal article with index", () => {
  assert.equal(
    formatReferenceText(article, "ieee", 4),
    "[4] J. A. Smith and K. Lee, “Deep learning for protein folding,” Nature Methods, vol. 17, no. 3, pp. 245–253, 2020, doi: 10.1038/s41592-019-0000-0.",
  );
});

test("Chicago author-date journal article", () => {
  assert.equal(
    formatReferenceText(article, "chicago"),
    "Smith, John Andrew, and Kate Lee. 2020. “Deep learning for protein folding.” Nature Methods 17 (3): 245–253. https://doi.org/10.1038/s41592-019-0000-0.",
  );
});

test("Harvard journal article", () => {
  assert.equal(
    formatReferenceText(article, "harvard"),
    "Smith, J.A. and Lee, K. (2020) ‘Deep learning for protein folding’, Nature Methods, 17(3), pp. 245–253. doi: 10.1038/s41592-019-0000-0.",
  );
});

test("Vancouver journal article", () => {
  assert.equal(
    formatReferenceText(article, "vancouver", 2),
    "2. Smith JA, Lee K. Deep learning for protein folding. Nature Methods. 2020;17(3):245-253. doi:10.1038/s41592-019-0000-0",
  );
});

test("author-count rules: APA 3 authors, IEEE and Vancouver et al., MLA et al.", () => {
  const many: Work = {
    ...article,
    authors: Array.from({ length: 8 }, (_, i) => ({ family: `Author${i + 1}`, given: "A" })),
  };
  assert.match(formatReferenceText(many, "ieee", 1), /^\[1\] A\. Author1 et al\., /);
  assert.match(formatReferenceText(many, "vancouver", 1), /Author6 A, et al\. /);
  assert.match(formatReferenceText(many, "mla"), /^Author1, A, et al\. /);
  assert.match(formatReferenceText(many, "harvard"), /^Author1, A\. et al\. \(2020\)/);
  const three: Work = { ...article, authors: many.authors.slice(0, 3) };
  assert.match(formatReferenceText(three, "apa"), /^Author1, A\., Author2, A\., & Author3, A\. \(2020\)/);
});

test("books use italic titles and the publisher", () => {
  const book: Work = {
    title: "The structure of scientific revolutions",
    authors: [{ family: "Kuhn", given: "Thomas S." }],
    year: 1962,
    publisher: "University of Chicago Press",
    type: "book",
    sources: ["crossref"],
  };
  assert.equal(
    renderMarkdown(formatReference(book, "apa")),
    "Kuhn, T. S. (1962). *The structure of scientific revolutions*. University of Chicago Press.",
  );
  assert.ok(renderHtml(formatReference(book, "apa")).includes("<i>The structure of scientific revolutions</i>"));
});

test("works with missing fields still format without stray punctuation", () => {
  const sparse: Work = { title: "Untitled note", authors: [], sources: ["parsed"] };
  for (const style of ["apa", "mla", "ieee", "chicago", "harvard", "vancouver"] as const) {
    const text = formatReferenceText(sparse, style, 1);
    assert.ok(text.includes("Untitled note"), style);
    assert.ok(!/undefined|null|\(\)/.test(text), `${style}: ${text}`);
    assert.ok(!/,\s*$/.test(text), `${style}: ${text}`);
  }
});

test("in-text forms per style", () => {
  assert.equal(formatInText(article, "apa"), "(Smith & Lee, 2020)");
  assert.equal(formatInText({ ...article, authors: [...article.authors, { family: "Wang", given: "X" }] }, "apa"), "(Smith et al., 2020)");
  assert.equal(formatInText(article, "mla"), "(Smith and Lee)");
  assert.equal(formatInText(article, "ieee", 7), "[7]");
  assert.equal(formatInText(article, "vancouver", 7), "(7)");
  assert.equal(formatInText(article, "chicago"), "(Smith and Lee 2020)");
  assert.equal(formatInText(article, "harvard"), "(Smith and Lee, 2020)");
});

test("initials handles hyphens, dots and lower case", () => {
  assert.equal(initials("Jean-Paul"), "J.-P.");
  assert.equal(initials("j.r.r."), "J. R. R.");
  assert.equal(initials("Mary Ann", false), "M.A.");
  assert.equal(initials(undefined), "");
});

test("BibTeX export escapes special characters and builds a stable key", () => {
  const bib = formatBibtex({ ...article, title: "Cost & benefit of deep_learning", authors: [{ family: "Müller", given: "Jürgen" }] });
  assert.match(bib, /^@article\{muller2020cost,/);
  assert.match(bib, /author = \{Müller, Jürgen\}/);
  assert.match(bib, /title = \{\{Cost \\& benefit of deep\\_learning\}\}/);
  assert.match(bib, /pages = \{245--253\}/);
  assert.equal(bibtexKey({ ...article, authors: [] }), "anon2020deep");
});

test("RIS export", () => {
  const ris = formatRis(article);
  assert.match(ris, /^TY {2}- JOUR/);
  assert.match(ris, /AU {2}- Smith, John Andrew/);
  assert.match(ris, /SP {2}- 245\nEP {2}- 253/);
  assert.match(ris, /DO {2}- 10\.1038\/s41592-019-0000-0/);
  assert.match(ris, /ER {2}- $/);
});

test("title similarity ignores case, punctuation and subtitles", () => {
  assert.equal(normalizeTitle("Hello, World! <i>Test</i>"), "hello world test");
  assert.ok(titleSimilarity("Deep Learning for Protein Folding", "deep learning for protein folding.") > 0.99);
  assert.ok(titleSimilarity("Attention is all you need", "Attention is all you need: a transformer approach") >= 0.9);
  assert.ok(titleSimilarity("Deep learning for protein folding", "A survey of graph databases") < 0.2);
  assert.equal(dice([], ["a"]), 0);
  assert.ok(titleContainedIn("Deep learning for protein folding", 'Smith J. "Deep learning for protein folding," Nature, 2020') > 0.99);
});
