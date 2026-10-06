import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAuthors, parseReference, parseReferenceList, splitReferenceList } from "../../src/core/citations/parse.ts";

const families = (s: string) => parseAuthors(s).authors.map((a) => a.family);

test("authors: APA / Chicago family-first lists", () => {
  const r = parseAuthors("Devlin, J., Chang, M.-W., Lee, K., & Toutanova, K.");
  assert.deepEqual(
    r.authors.map((a) => [a.family, a.given]),
    [
      ["Devlin", "J."],
      ["Chang", "M.-W."],
      ["Lee", "K."],
      ["Toutanova", "K."],
    ],
  );
  assert.deepEqual(families("Smith, J. A., & Lee, K."), ["Smith", "Lee"]);
  assert.deepEqual(families("Vaswani, A., Kaiser, Ł., & Polosukhin, I."), ["Vaswani", "Kaiser", "Polosukhin"]);
  assert.deepEqual(families("van der Berg, P., & de la Cruz, M."), ["van der Berg", "de la Cruz"]);
});

test("authors: IEEE initials-first, et al., MLA given-first, Vancouver and organisations", () => {
  assert.deepEqual(families("K. He, X. Zhang, S. Ren, and J. Sun"), ["He", "Zhang", "Ren", "Sun"]);
  const etal = parseAuthors("A. Vaswani et al.");
  assert.deepEqual(etal.authors.map((a) => a.family), ["Vaswani"]);
  assert.equal(etal.truncated, true);
  assert.deepEqual(families("Smith, John A., and Kate Lee"), ["Smith", "Lee"]);
  assert.deepEqual(families("Smith JA, Lee K, Wang X"), ["Smith", "Lee", "Wang"]);
  const org = parseAuthors("World Health Organization");
  assert.equal(org.authors[0]?.organization, true);
});

test("APA journal article", () => {
  const r = parseReference(
    "Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., Kaiser, Ł., & Polosukhin, I. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30, 5998–6008.",
    1,
  );
  assert.equal(r.authors.length, 8);
  assert.equal(r.authors[0]?.family, "Vaswani");
  assert.equal(r.year, 2017);
  assert.equal(r.title, "Attention is all you need");
  assert.equal(r.container, "Advances in Neural Information Processing Systems");
  assert.equal(r.volume, "30");
  assert.equal(r.pages, "5998–6008");
});

test("APA with issue, DOI and markdown italics", () => {
  const r = parseReference(
    "Smith, J. A., & Lee, K. (2020). Deep learning for protein folding. *Nature Methods*, *17*(3), 245–253. https://doi.org/10.1038/s41592-019-0000-0",
    2,
  );
  assert.equal(r.doi, "10.1038/s41592-019-0000-0");
  assert.equal(r.title, "Deep learning for protein folding");
  assert.equal(r.container, "Nature Methods");
  assert.equal(r.volume, "17");
  assert.equal(r.issue, "3");
  assert.equal(r.pages, "245–253");
  assert.ok(r.completeness >= 0.9);
});

test("APA conference paper keeps the title and container apart", () => {
  const r = parseReference(
    "Devlin, J., Chang, M.-W., Lee, K., & Toutanova, K. (2019). BERT: Pre-training of deep bidirectional transformers for language understanding. In Proceedings of NAACL-HLT (pp. 4171–4186). https://doi.org/10.18653/v1/N19-1423",
    3,
  );
  assert.equal(r.title, "BERT: Pre-training of deep bidirectional transformers for language understanding");
  assert.equal(r.container, "Proceedings of NAACL-HLT");
  assert.equal(r.pages, "4171–4186");
  assert.equal(r.doi, "10.18653/v1/n19-1423");
});

test("IEEE entries", () => {
  const r = parseReference(
    "[2] K. He, X. Zhang, S. Ren, and J. Sun, “Deep residual learning for image recognition,” in Proc. IEEE CVPR, 2016, pp. 770–778, doi: 10.1109/CVPR.2016.90.",
    2,
  );
  assert.deepEqual(r.authors.map((a) => a.family), ["He", "Zhang", "Ren", "Sun"]);
  assert.equal(r.title, "Deep residual learning for image recognition");
  assert.equal(r.year, 2016);
  assert.equal(r.pages, "770–778");
  assert.equal(r.doi, "10.1109/cvpr.2016.90");
  assert.match(r.container ?? "", /Proc\. IEEE CVPR/);
});

test("IEEE journal with volume and issue", () => {
  const r = parseReference(
    '[5] J. A. Smith and K. Lee, "Deep learning for protein folding," Nature Methods, vol. 17, no. 3, pp. 245–253, 2020.',
    5,
  );
  assert.equal(r.container, "Nature Methods");
  assert.equal(r.volume, "17");
  assert.equal(r.issue, "3");
  assert.equal(r.year, 2020);
});

test("Vancouver entries", () => {
  const r = parseReference("1. Smith JA, Lee K, Wang X. Deep learning for protein folding. Nat Methods. 2020;17(3):245-53. doi:10.1038/s41592-019-0000-0", 1);
  assert.deepEqual(r.authors.map((a) => a.family), ["Smith", "Lee", "Wang"]);
  assert.equal(r.title, "Deep learning for protein folding");
  assert.equal(r.container, "Nat Methods");
  assert.equal(r.year, 2020);
  assert.equal(r.volume, "17");
  assert.equal(r.issue, "3");
  assert.equal(r.pages, "245-53");
});

test("MLA entries", () => {
  const r = parseReference(
    'Smith, John A., and Kate Lee. "Deep Learning for Protein Folding." Nature Methods, vol. 17, no. 3, 2020, pp. 245-53.',
    1,
  );
  assert.deepEqual(r.authors.map((a) => a.family), ["Smith", "Lee"]);
  assert.equal(r.title, "Deep Learning for Protein Folding");
  assert.equal(r.container, "Nature Methods");
  assert.equal(r.year, 2020);
});

test("Harvard entries with single-quoted titles", () => {
  const r = parseReference(
    "Smith, J.A. and Lee, K. (2020) ‘Deep learning for protein folding’, Nature Methods, 17(3), pp. 245–253. doi: 10.1038/s41592-019-0000-0.",
    1,
  );
  assert.equal(r.title, "Deep learning for protein folding");
  assert.equal(r.container, "Nature Methods");
  assert.equal(r.volume, "17");
  assert.equal(r.pages, "245–253");
});

test("organisation author, year suffix, arXiv id and bare URL", () => {
  const org = parseReference("World Health Organization. (2021). Global report on health. WHO Press.", 1);
  assert.equal(org.authors[0]?.organization, true);
  assert.equal(org.year, 2021);
  assert.equal(org.title, "Global report on health");

  const suffix = parseReference("Lee, K. (2020a). A note on scaling. Journal of Notes, 4, 1–9.", 2);
  assert.equal(suffix.yearSuffix, "a");

  const arxiv = parseReference("Brown, T., et al. (2020). Language models are few-shot learners. arXiv:2005.14165", 3);
  assert.equal(arxiv.arxivId, "2005.14165");
  assert.equal(arxiv.title, "Language models are few-shot learners");

  const url = parseReference("Smith, J. (2019). Open data portal. Retrieved from https://data.example.org/portal", 4);
  assert.equal(url.url, "https://data.example.org/portal");
});

test("titles keep abbreviations such as 'U.S.' and 'vs.' intact", () => {
  const r = parseReference("Doe, J. (2018). Wages in the U.S. vs. Europe: A comparison. Economic Review, 12(1), 1–20.", 1);
  assert.equal(r.title, "Wages in the U.S. vs. Europe: A comparison");
  assert.equal(r.container, "Economic Review");
});

test("splitReferenceList: bracket numbers, dotted numbers, blank lines and hanging lines", () => {
  assert.equal(splitReferenceList("[1] First ref\ncontinued here.\n[2] Second ref.\n[3] Third ref.").length, 3);
  assert.deepEqual(splitReferenceList("[1] First ref\ncontinued here.\n[2] Second ref."), ["First ref continued here.", "Second ref."]);
  assert.equal(splitReferenceList("1. One ref.\n2. Two ref.\n3. Three ref.").length, 3);
  assert.equal(splitReferenceList("Smith, J. (2020). A. B.\n\nLee, K. (2019). C. D.").length, 2);
  const hanging = splitReferenceList(
    "Smith, J. (2020). A long title that wraps\nonto the next line. Journal, 1, 1–2.\nLee, K. (2019). Another title. Journal, 2, 3–4.",
  );
  assert.equal(hanging.length, 2);
  assert.match(hanging[0] ?? "", /wraps onto the next line/);
  assert.deepEqual(splitReferenceList(""), []);
});

test("parseReferenceList numbers entries from 1", () => {
  const list = parseReferenceList("[1] A. Author, \"First paper title,\" Journal A, 2019.\n[2] B. Writer, \"Second paper title,\" Journal B, 2020.");
  assert.deepEqual(list.map((r) => r.index), [1, 2]);
  assert.equal(list[1]?.title, "Second paper title");
});

test("hyphenated line breaks are rejoined", () => {
  const list = splitReferenceList("[1] Smith, J. (2020). Informa-\ntion retrieval methods. Journal, 1, 1–2.\n[2] Lee, K. (2019). Other. J, 1, 2–3.");
  assert.match(list[0] ?? "", /Information retrieval/);
});
