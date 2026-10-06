import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttp } from "../../src/core/infra/http.ts";
import { dedupeWorks, mergeWorks, normalizeDoi, splitName, workKey } from "../../src/core/citations/sources/common.ts";
import { createCrossref, detectCrossrefRetraction, mapCrossrefItem } from "../../src/core/citations/sources/crossref.ts";
import { createOpenAlex, mapOpenAlexWork, rebuildAbstract } from "../../src/core/citations/sources/openalex.ts";
import { createSemanticScholar, mapS2Paper } from "../../src/core/citations/sources/semanticscholar.ts";
import { createDataCite, mapDataCite } from "../../src/core/citations/sources/datacite.ts";
import { createArxiv, parseArxivFeed } from "../../src/core/citations/sources/arxiv.ts";
import type { Work } from "../../src/core/citations/types.ts";
import { jsonResponse, mockFetch, noSleep, textResponse } from "./helpers.ts";

const http = (fetch: typeof globalThis.fetch) => createHttp({ fetch, sleep: noSleep, retries: 0 });

const crossrefItem = {
  DOI: "10.1038/S41592-019-0000-0",
  title: ["Deep learning for <i>protein</i> folding"],
  author: [
    { given: "John A.", family: "Smith", sequence: "first" },
    { given: "Kate", family: "Lee", sequence: "additional" },
    { name: "The Consortium" },
  ],
  issued: { "date-parts": [[2020, 3]] },
  "container-title": ["Nature Methods"],
  volume: "17",
  issue: "3",
  page: "245-253",
  type: "journal-article",
  URL: "http://dx.doi.org/10.1038/s41592-019-0000-0",
  publisher: "Springer Nature",
  abstract: "<jats:p>We study <jats:italic>folding</jats:italic>.</jats:p>",
  "is-referenced-by-count": 42,
};

test("splitName and normalizeDoi", () => {
  assert.deepEqual(splitName("Jane Q. Public"), { family: "Public", given: "Jane Q." });
  assert.deepEqual(splitName("Ludwig van Beethoven"), { family: "van Beethoven", given: "Ludwig" });
  assert.deepEqual(splitName("Martin Luther King Jr."), { family: "King", given: "Martin Luther" });
  assert.deepEqual(splitName("Public, Jane"), { family: "Public", given: "Jane" });
  assert.deepEqual(splitName("Plato"), { family: "Plato" });
  assert.equal(normalizeDoi("https://doi.org/10.1000/ABC.123."), "10.1000/abc.123");
  assert.equal(normalizeDoi("doi: 10.1000/xyz)"), "10.1000/xyz");
  assert.equal(normalizeDoi("not a doi"), undefined);
});

test("Crossref item mapping", () => {
  const w = mapCrossrefItem(crossrefItem);
  assert.equal(w.title, "Deep learning for protein folding");
  assert.equal(w.doi, "10.1038/s41592-019-0000-0");
  assert.equal(w.year, 2020);
  assert.equal(w.container, "Nature Methods");
  assert.equal(w.pages, "245-253");
  assert.deepEqual(w.authors[0], { family: "Smith", given: "John A." });
  assert.equal(w.authors[2]?.organization, true);
  assert.equal(w.abstract, "We study folding .");
  assert.equal(w.citationCount, 42);
  assert.equal(w.retraction, undefined);
});

test("Crossref retraction detection: updated-by, relation and title prefix", () => {
  const byUpdate = detectCrossrefRetraction({
    "updated-by": [{ DOI: "10.1/NOTICE", type: "retraction", source: "retraction-watch", updated: { "date-parts": [[2022, 5, 9]] } }],
  });
  assert.deepEqual(byUpdate, { status: "retracted", source: "Crossref / Retraction Watch", noticeDoi: "10.1/notice", date: "2022-05-09" });
  assert.equal(detectCrossrefRetraction({ "updated-by": [{ type: "expression_of_concern" }] })?.status, "expression_of_concern");
  assert.equal(detectCrossrefRetraction({ "updated-by": [{ type: "correction" }] }), undefined);
  assert.equal(detectCrossrefRetraction({ title: ["RETRACTED: A fine paper"] })?.status, "retracted");
  assert.equal(detectCrossrefRetraction({ title: ["Retracted patients were followed up"] }), undefined);
  assert.equal(detectCrossrefRetraction({ relation: { "is-retracted-by": [{ id: "10.1/x" }] } })?.status, "retracted");
});

test("Crossref client: getWork, 404 and search with polite mailto", async () => {
  const { fetch, calls } = mockFetch((call) =>
    call.url.includes("/works/10.9999%2Fmissing")
      ? jsonResponse({}, 404)
      : call.url.includes("query.bibliographic")
        ? jsonResponse({ message: { items: [crossrefItem] } })
        : jsonResponse({ message: crossrefItem }),
  );
  const cr = createCrossref(http(fetch), { mailto: "me@example.org" });
  assert.equal((await cr.getWork("10.1038/s41592-019-0000-0"))?.title, "Deep learning for protein folding");
  assert.equal(await cr.getWork("10.9999/missing"), null);
  const results = await cr.search("Smith deep learning protein folding 2020", 3);
  assert.equal(results.length, 1);
  assert.match(calls[0]?.url ?? "", /10\.1038%2Fs41592-019-0000-0\?mailto=me%40example\.org/);
  assert.match(calls[2]?.url ?? "", /rows=3&mailto=me%40example\.org/);
});

const openAlexWork = {
  id: "https://openalex.org/W123",
  doi: "https://doi.org/10.1038/s41592-019-0000-0",
  title: "Deep learning for protein folding",
  publication_year: 2020,
  authorships: [{ author: { display_name: "John A. Smith" } }, { author: { display_name: "Kate Lee" } }],
  primary_location: { source: { display_name: "Nature Methods" }, landing_page_url: "https://nature.com/x" },
  biblio: { volume: "17", issue: "3", first_page: "245", last_page: "253" },
  cited_by_count: 40,
  abstract_inverted_index: { Proteins: [0], fold: [1], quickly: [2], "(really).": [3] },
  type: "article",
  is_retracted: true,
};

test("OpenAlex mapping, abstract rebuild and retraction flag", () => {
  const w = mapOpenAlexWork(openAlexWork);
  assert.equal(w.doi, "10.1038/s41592-019-0000-0");
  assert.deepEqual(w.authors[0], { family: "Smith", given: "John A." });
  assert.equal(w.pages, "245-253");
  assert.equal(w.type, "journal-article");
  assert.equal(w.abstract, "Proteins fold quickly (really).");
  assert.deepEqual(w.retraction, { status: "retracted", source: "OpenAlex" });
  assert.equal(rebuildAbstract(null), undefined);
});

test("OpenAlex client builds documented URLs", async () => {
  const { fetch, calls } = mockFetch((call) =>
    call.url.includes("/works/https://doi.org/10.1/none") ? jsonResponse({}, 404) : call.url.includes("/works?") ? jsonResponse({ results: [openAlexWork] }) : jsonResponse(openAlexWork),
  );
  const oa = createOpenAlex(http(fetch), { mailto: "me@example.org" });
  assert.equal((await oa.search("protein folding", 5)).length, 1);
  assert.equal((await oa.getByDoi("10.1038/s41592-019-0000-0"))?.retraction?.status, "retracted");
  assert.equal(await oa.getByDoi("10.1/none"), null);
  await oa.searchByTitle("Deep learning: for protein folding");
  assert.match(calls[0]?.url ?? "", /\/works\?search=protein%20folding&per-page=5&select=.*&mailto=/);
  assert.match(calls[1]?.url ?? "", /\/works\/https:\/\/doi\.org\/10\.1038\/s41592-019-0000-0\?select=/);
  assert.match(calls[3]?.url ?? "", /filter=title\.search:Deep%20learning%20%20for%20protein%20folding/);
});

test("Semantic Scholar mapping and key header", async () => {
  const paper = {
    title: "Attention is all you need",
    authors: [{ name: "Ashish Vaswani" }],
    year: 2017,
    venue: "NeurIPS",
    journal: { name: "Advances in NIPS", volume: "30", pages: "5998-6008" },
    externalIds: { DOI: "10.5555/ABC", ArXiv: "1706.03762" },
    abstract: "The dominant sequence transduction models...",
    citationCount: 100000,
    publicationTypes: ["JournalArticle"],
  };
  const w = mapS2Paper(paper);
  assert.equal(w.doi, "10.5555/abc");
  assert.equal(w.arxivId, "1706.03762");
  assert.equal(w.container, "Advances in NIPS");
  assert.equal(w.type, "journal-article");
  const { fetch, calls } = mockFetch(() => jsonResponse({ data: [paper] }));
  const s2 = createSemanticScholar(http(fetch), { apiKey: "KEY" });
  assert.equal((await s2.search("attention transformer", 3)).length, 1);
  assert.equal(calls[0]?.headers["x-api-key"], "KEY");
  assert.match(calls[0]?.url ?? "", /paper\/search\?query=attention%20transformer&limit=3&fields=/);
});

test("DataCite mapping and 404", async () => {
  const record = {
    data: {
      attributes: {
        doi: "10.5281/ZENODO.1",
        titles: [{ title: "A dataset" }],
        creators: [{ givenName: "Ada", familyName: "Lovelace", name: "Lovelace, Ada" }, { name: "CERN", nameType: "Organizational" }],
        publicationYear: 2021,
        publisher: "Zenodo",
        types: { resourceTypeGeneral: "Dataset" },
        descriptions: [{ description: "About it", descriptionType: "Abstract" }],
      },
    },
  };
  const w = mapDataCite(record);
  assert.equal(w?.doi, "10.5281/zenodo.1");
  assert.equal(w?.authors[1]?.organization, true);
  assert.equal(w?.type, "dataset");
  const { fetch } = mockFetch((c) => (c.url.includes("missing") ? jsonResponse({}, 404) : jsonResponse(record)));
  const dc = createDataCite(http(fetch));
  assert.equal((await dc.getWork("10.5281/zenodo.1"))?.publisher, "Zenodo");
  assert.equal(await dc.getWork("10.5281/missing"), null);
});

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2005.14165v4</id>
    <published>2020-05-28T17:29:03Z</published>
    <title>Language Models are
      Few-Shot Learners</title>
    <summary>Recent work &amp; results   show gains.</summary>
    <author><name>Tom B. Brown</name></author>
    <author><name>Benjamin Mann</name></author>
    <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.48550/arXiv.2005.14165</arxiv:doi>
  </entry>
</feed>`;

test("arXiv feed parsing and client", async () => {
  const works = parseArxivFeed(ATOM);
  assert.equal(works.length, 1);
  assert.equal(works[0]?.title, "Language Models are Few-Shot Learners");
  assert.equal(works[0]?.arxivId, "2005.14165");
  assert.equal(works[0]?.year, 2020);
  assert.equal(works[0]?.abstract, "Recent work & results show gains.");
  assert.equal(works[0]?.authors.length, 2);
  assert.equal(works[0]?.doi, "10.48550/arxiv.2005.14165");
  assert.deepEqual(parseArxivFeed("<feed></feed>"), []);

  const { fetch, calls } = mockFetch(() => textResponse(ATOM, 200, "application/atom+xml"));
  const ax = createArxiv(http(fetch));
  assert.equal((await ax.getById("2005.14165"))?.title, "Language Models are Few-Shot Learners");
  await ax.search('few-shot "learners" (language)');
  assert.match(calls[1]?.url ?? "", /search_query=all%3Afew-shot%20AND%20all%3Alearners%20AND%20all%3Alanguage/);
});

test("dedupe and merge combine records for the same work", () => {
  const a: Work = { title: "Deep learning for protein folding", authors: [{ family: "Smith" }], year: 2020, doi: "10.1/x", sources: ["crossref"], citationCount: 5 };
  const b: Work = {
    title: "Deep learning for protein folding",
    authors: [{ family: "Smith", given: "John" }, { family: "Lee", given: "Kate" }],
    year: 2020,
    abstract: "An abstract.",
    sources: ["openalex"],
    citationCount: 9,
  };
  const merged = dedupeWorks([a, b]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0]?.sources.sort(), ["crossref", "openalex"]);
  assert.equal(merged[0]?.citationCount, 9);
  assert.equal(merged[0]?.abstract, "An abstract.");
  assert.equal(merged[0]?.authors.length, 2);
  assert.equal(merged[0]?.doi, "10.1/x");
  assert.equal(dedupeWorks([a, { ...a, doi: "10.1/other", title: "Another paper" }]).length, 2);
  assert.equal(workKey({ title: "T", authors: [], arxivId: "2005.14165v2", sources: [] }), "arxiv:2005.14165");
  assert.equal(mergeWorks(a, a).title, a.title);
});
