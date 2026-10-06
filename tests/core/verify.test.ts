import assert from "node:assert/strict";
import { test } from "node:test";
import { crossCheckCitations, expandNumbers, findInTextCitations } from "../../src/core/citations/intext.ts";
import { parseReference, parseReferenceList } from "../../src/core/citations/parse.ts";
import { findDiscrepancies, markDuplicates, scoreMatch, verifyReference, verifyReferences, type VerifierDeps } from "../../src/core/citations/verify.ts";
import type { Work } from "../../src/core/citations/types.ts";
import { splitReferences } from "../../src/core/text/sections.ts";

const attention: Work = {
  title: "Attention is all you need",
  authors: [{ family: "Vaswani", given: "Ashish" }, { family: "Shazeer", given: "Noam" }],
  year: 2017,
  container: "Advances in Neural Information Processing Systems",
  volume: "30",
  pages: "5998-6008",
  doi: "10.5555/3295222.3295349",
  type: "proceedings-article",
  sources: ["crossref"],
};
const bert: Work = {
  title: "BERT: Pre-training of deep bidirectional transformers for language understanding",
  authors: [{ family: "Devlin", given: "Jacob" }],
  year: 2019,
  container: "Proceedings of NAACL-HLT",
  doi: "10.18653/v1/n19-1423",
  sources: ["crossref"],
};
const retractedPaper: Work = {
  title: "A miracle cure for everything",
  authors: [{ family: "Quack", given: "Ima" }],
  year: 2015,
  container: "Journal of Wonders",
  doi: "10.1111/wonder.1",
  sources: ["crossref"],
};

function fakeDeps(options: { byDoi?: Work[]; search?: Work[]; retractedDois?: string[]; crossrefThrows?: boolean } = {}): VerifierDeps {
  const byDoi = new Map((options.byDoi ?? []).map((w) => [w.doi as string, w]));
  return {
    crossref: {
      async getWork(doi) {
        if (options.crossrefThrows) throw new Error("ECONNREFUSED");
        return byDoi.get(doi) ?? null;
      },
      async search() {
        if (options.crossrefThrows) throw new Error("ECONNREFUSED");
        return options.search ?? [];
      },
    },
    openalex: {
      async getByDoi(doi) {
        return options.retractedDois?.includes(doi)
          ? { title: "x", authors: [], sources: ["openalex"], doi, retraction: { status: "retracted", source: "OpenAlex" } }
          : null;
      },
      async searchByTitle() {
        return [];
      },
    },
  };
}

test("scoreMatch rewards matching title, authors, year and tolerates abbreviated journals", () => {
  const ref = parseReference('A. Vaswani, N. Shazeer, "Attention is all you need," Adv. Neural Inf. Process. Syst., vol. 30, 2017.', 1);
  const good = scoreMatch(ref, attention);
  assert.ok(good.score > 0.85, JSON.stringify(good));
  const other = scoreMatch(ref, bert);
  assert.ok(other.score < 0.4, JSON.stringify(other));
});

test("verified: DOI resolves to the cited paper", async () => {
  const ref = parseReference(
    "Vaswani, A., Shazeer, N. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30, 5998–6008. https://doi.org/10.5555/3295222.3295349",
    1,
  );
  const r = await verifyReference(ref, fakeDeps({ byDoi: [attention] }));
  assert.equal(r.status, "verified");
  assert.deepEqual(r.discrepancies, []);
  assert.deepEqual(r.flags, []);
  assert.equal(r.match?.doi, attention.doi);
});

test("mismatch: DOI resolves to a different paper", async () => {
  const ref = parseReference(
    "Vaswani, A., Shazeer, N. (2017). Attention is all you need. Advances in NIPS, 30, 5998–6008. https://doi.org/10.18653/v1/N19-1423",
    1,
  );
  const r = await verifyReference(ref, fakeDeps({ byDoi: [bert], search: [attention] }));
  assert.equal(r.status, "mismatch");
  assert.ok(r.flags.includes("doi_points_elsewhere"));
  assert.equal(r.doiWork?.title, bert.title);
  assert.equal(r.match?.title, attention.title, "the entry itself still matches the real paper");

  const noAlt = await verifyReference(ref, fakeDeps({ byDoi: [bert], search: [] }));
  assert.equal(noAlt.status, "mismatch");
  assert.ok(noAlt.flags.includes("doi_points_elsewhere"));
});

test("invented DOI is flagged even when the paper itself is found by search", async () => {
  const ref = parseReference("Vaswani, A., Shazeer, N. (2017). Attention is all you need. Advances in NIPS, 30. doi:10.9999/not-real", 1);
  const r = await verifyReference(ref, fakeDeps({ search: [attention] }));
  assert.ok(r.flags.includes("doi_not_found"));
  assert.ok(["verified", "likely"].includes(r.status), r.status);
  assert.equal(r.match?.doi, attention.doi);
});

test("not_found: nothing resembles the entry, with a cautious note", async () => {
  const ref = parseReference("Nobody, N. (2031). A paper that was never written about nothing at all. Journal of Fiction, 1, 1–2.", 1);
  const r = await verifyReference(ref, fakeDeps({ search: [attention, bert] }));
  assert.equal(r.status, "not_found");
  assert.equal(r.match, undefined);
  assert.match(r.notes.join(" "), /book, report, thesis or web page/);
});

test("unchecked, not not_found, when the lookup service is down", async () => {
  const ref = parseReference("Vaswani, A. (2017). Attention is all you need. Journal, 30. doi:10.5555/3295222.3295349", 1);
  const r = await verifyReference(ref, fakeDeps({ crossrefThrows: true }));
  assert.equal(r.status, "unchecked");
});

test("retraction is flagged from the source record or from OpenAlex", async () => {
  const ref = parseReference("Quack, I. (2015). A miracle cure for everything. Journal of Wonders, 3, 1–9. doi:10.1111/wonder.1", 1);
  const viaOpenAlex = await verifyReference(ref, fakeDeps({ byDoi: [retractedPaper], retractedDois: ["10.1111/wonder.1"] }));
  assert.ok(viaOpenAlex.flags.includes("retracted"));
  assert.match(viaOpenAlex.notes.join(" "), /retracted \(OpenAlex\)/);
  const viaCrossref = await verifyReference(
    ref,
    fakeDeps({ byDoi: [{ ...retractedPaper, retraction: { status: "expression_of_concern", source: "Crossref", date: "2020-01-02" } }] }),
  );
  assert.ok(viaCrossref.flags.includes("expression_of_concern"));
  assert.match(viaCrossref.notes.join(" "), /expression of concern \(Crossref, 2020-01-02\)/);
});

test("discrepancies: wrong year, wrong first author, wrong pages", () => {
  const ref = parseReference("Smith, J. (2018). Attention is all you need. Advances in Neural Information Processing Systems, 31, 100–110.", 1);
  const d = findDiscrepancies(ref, attention);
  const fields = d.map((x) => x.field).sort();
  assert.deepEqual(fields, ["authors", "pages", "volume", "year"]);
  assert.deepEqual(d.find((x) => x.field === "year"), { field: "year", cited: "2018", actual: "2017" });
});

test("duplicates are marked on the later entry", async () => {
  const list = parseReferenceList(
    "[1] Vaswani, A. (2017). Attention is all you need. NeurIPS, 30.\n[2] Devlin, J. (2019). BERT: Pre-training of deep bidirectional transformers. NAACL.\n[3] Vaswani, A. (2017). Attention is all you need. NeurIPS, 30.",
  );
  const { checks } = await verifyReferences(list, fakeDeps({ search: [] }));
  assert.ok(!checks[0]?.flags.includes("duplicate"));
  assert.ok(checks[2]?.flags.includes("duplicate"));
  assert.match(checks[2]?.notes.join(" ") ?? "", /Duplicates entry 1/);
  markDuplicates([]);
});

test("verifyReferences counts statuses", async () => {
  const list = parseReferenceList(
    "[1] Vaswani, A., Shazeer, N. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30, 5998–6008. doi:10.5555/3295222.3295349\n[2] Nobody, N. (2031). Something that does not exist anywhere in the world. Journal of Fiction, 1, 1–2.",
  );
  const result = await verifyReferences(list, fakeDeps({ byDoi: [attention] }));
  assert.equal(result.counts.verified, 1);
  assert.equal(result.counts.not_found, 1);
  assert.equal(result.counts.flagged, 0);
});

// ---------------------------------------------------------------------------
// In-text citations
// ---------------------------------------------------------------------------

test("expandNumbers handles lists and ranges", () => {
  assert.deepEqual(expandNumbers("1, 3"), [1, 3]);
  assert.deepEqual(expandNumbers("2–5"), [2, 3, 4, 5]);
  assert.deepEqual(expandNumbers("1,4-6;9"), [1, 4, 5, 6, 9]);
});

test("findInTextCitations: numeric, parenthetical and narrative", () => {
  const text =
    "Deep models work [1, 3] and scale [5–7]. This was shown (Smith & Lee, 2020; Wang et al., 2019a) and by Jones et al. (2021). " +
    "In (2020) nothing happened. See also (see Brown 2018, p. 4). The ratio (n = 5) is fine.";
  const found = findInTextCitations(text);
  const numeric = found.filter((f) => f.kind === "numeric");
  assert.deepEqual(numeric.map((n) => n.numbers), [[1, 3], [5, 6, 7]]);
  const ay = found.filter((f) => f.kind === "author-year").map((f) => [f.surname, f.year, f.yearSuffix ?? ""]);
  assert.deepEqual(ay, [
    ["Smith", 2020, ""],
    ["Wang", 2019, "a"],
    ["Jones", 2021, ""],
    ["Brown", 2018, ""],
  ]);
  for (const f of found) assert.equal(text.slice(f.start, f.end).includes(f.raw.split(" ")[0] ?? "?"), true);
});

const REFS = parseReferenceList(
  "[1] Vaswani, A. (2017). Attention is all you need. NeurIPS, 30.\n[2] Devlin, J. (2019). BERT: Pre-training of deep bidirectional transformers. NAACL.\n[3] Lee, K. (2020). Unused work. Journal, 1.",
);

test("crossCheck numeric: missing numbers and uncited references", () => {
  const body = "Transformers [1] and BERT [2] are popular, as are others [7].";
  const r = crossCheckCitations(body, REFS);
  assert.equal(r.style, "numeric");
  assert.equal(r.citedButMissing.length, 1);
  assert.match(r.citedButMissing[0]?.reason ?? "", /Reference 7 does not exist/);
  assert.deepEqual(r.uncitedReferences.map((x) => x.index), [3]);
});

test("crossCheck author-year: matches by first author and year, explains near misses", () => {
  const refs = parseReferenceList(
    "Devlin, J., Chang, M. (2019). BERT: Pre-training of deep bidirectional transformers. NAACL.\n\nVaswani, A., Shazeer, N. (2017). Attention is all you need. NeurIPS, 30.\n\nLee, K. (2020). Unused work. Journal, 1.",
  );
  const body = "BERT (Devlin et al., 2019) and Vaswani and Shazeer (2018) and Garcia (2021) were cited.";
  const r = crossCheckCitations(body, refs);
  assert.equal(r.style, "author-year");
  assert.equal(r.citedButMissing.length, 2);
  assert.match(r.citedButMissing[0]?.reason ?? "", /Vaswani \(2018\) is cited, but the reference list has Vaswani for 2017/);
  assert.match(r.citedButMissing[1]?.reason ?? "", /No reference by Garcia/);
  assert.deepEqual(r.uncitedReferences.map((x) => x.authors[0]?.family), ["Vaswani", "Lee"]);
});

test("crossCheck warns about out-of-order numbers, mixed styles and unreadable lists", () => {
  const body = "A [3]. B [1]. C [2]. D [4]. E [5]. F [6].";
  const r = crossCheckCitations(body, REFS);
  assert.equal(r.numbersOutOfOrder, true);
  assert.ok(r.warnings.some((w) => /order/.test(w)));
  const mixed = crossCheckCitations("A [1] and (Devlin, 2019).", REFS);
  assert.equal(mixed.style, "mixed");
  assert.ok(mixed.warnings.some((w) => /Both numbered and author-year/.test(w)));
  assert.ok(crossCheckCitations("A [1].", []).warnings.some((w) => /no reference list/.test(w)));
  assert.equal(crossCheckCitations("No citations here.", []).style, "none");
});

test("end to end: split a manuscript, cross-check against its own reference list", () => {
  const manuscript = `Introduction\n\n${"Background text. ".repeat(30)}Prior work [1] and [2] motivates this study.\n\nReferences\n[1] Vaswani, A. (2017). Attention is all you need. NeurIPS, 30.\n[2] Devlin, J. (2019). BERT: Pre-training of deep bidirectional transformers. NAACL.`;
  const { body, references } = splitReferences(manuscript);
  const refs = parseReferenceList(references);
  assert.equal(refs.length, 2);
  const r = crossCheckCitations(body, refs);
  assert.equal(r.citedButMissing.length, 0);
  assert.equal(r.uncitedReferences.length, 0);
});
