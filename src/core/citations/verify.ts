import { mapLimit } from "../infra/http.ts";
import { dice, normalizeTitle, titleContainedIn, titleSimilarity, titleTokens } from "../text/similarity.ts";
import type { ArxivClient } from "./sources/arxiv.ts";
import type { CrossrefClient } from "./sources/crossref.ts";
import type { DataCiteClient } from "./sources/datacite.ts";
import type { OpenAlexClient } from "./sources/openalex.ts";
import type { Author, ParsedReference, Work } from "./types.ts";

export type VerifyStatus =
  /** The reference matches a real record closely. */
  | "verified"
  /** A similar record exists but some details are off. */
  | "likely"
  /** The DOI resolves, but to a different paper than the one cited. */
  | "mismatch"
  /** Nothing in the databases resembles this entry. It may still be a book, report or web page. */
  | "not_found"
  /** A lookup service failed, so nothing can be said about this entry. */
  | "unchecked";

export type ReferenceFlag =
  | "retracted"
  | "withdrawn"
  | "removed"
  | "expression_of_concern"
  | "doi_not_found"
  | "doi_points_elsewhere"
  | "duplicate"
  | "incomplete_reference";

export interface Discrepancy {
  field: "year" | "authors" | "title" | "container" | "volume" | "pages";
  cited?: string;
  actual?: string;
}

export interface ReferenceCheck {
  index: number;
  raw: string;
  ref: ParsedReference;
  status: VerifyStatus;
  /** 0 to 1 agreement between the entry and the matched record. */
  score: number;
  /** The record this entry most likely refers to. */
  match?: Work;
  /** What the cited DOI actually resolves to, when that differs from the entry. */
  doiWork?: Work;
  discrepancies: Discrepancy[];
  flags: ReferenceFlag[];
  notes: string[];
}

export interface VerifierDeps {
  crossref: Pick<CrossrefClient, "getWork" | "search">;
  openalex?: Pick<OpenAlexClient, "getByDoi" | "searchByTitle">;
  datacite?: Pick<DataCiteClient, "getWork">;
  arxiv?: Pick<ArxivClient, "getById" | "searchByTitle">;
}

function ascii(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function familyMatches(a: Author, b: Author): boolean {
  const x = ascii(a.family);
  const y = ascii(b.family);
  if (!x || !y) return false;
  if (x === y || x.endsWith(` ${y}`) || y.endsWith(` ${x}`) || (a.organization === true && (x.startsWith(y) || y.startsWith(x))))
    return true;
  // Many South and East Asian names are written in either order ("Kandadi, T. R." for Thirupathi Reddy Kandadi,
  // or a database recording Kandadi as a given name), so a surname found among the other's names matches too.
  const words = (s: string | undefined) => ascii(s ?? "").split(" ").filter((w) => w.length > 2);
  return words(b.given).includes(x) || words(a.given).includes(y);
}

/** A record "author" that is really an address or affiliation, as some deposited metadata has. */
const notAPerson = (a: Author) => /\d{4,}|,.*,|\b(university|institute|college|department)\b.*,/i.test(`${a.given ?? ""} ${a.family}`);

const CONTAINER_STOP = new Set(["of", "the", "and", "on", "for", "in", "a", "an", "&", "annual", "volume", "vol", "long", "short", "papers", "proceedings", "conference", "meeting"]);

/** True when an acronym in one name ("NAACL-HLT") spells initials of the other name's words, in order. */
function acronymMatch(short: string, long: string): boolean {
  const acronyms = short.match(/\b[A-Z][A-Z0-9]{2,}\b/g) ?? [];
  if (acronyms.length === 0) return false;
  const initials = long
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w && !CONTAINER_STOP.has(w.toLowerCase()))
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
  const isSubsequence = (needle: string) => {
    let i = 0;
    for (const ch of initials) if (ch === needle.charAt(i)) i++;
    return i === needle.length;
  };
  return acronyms.every((a) => isSubsequence(a.replace(/\d/g, "")));
}

function containerSimilarity(a: string, b: string): number {
  if (acronymMatch(a, b) || acronymMatch(b, a)) return 0.9;
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const base = dice(ta, tb);
  // Abbreviations such as "Nat Methods" for "Nature Methods": every short token is a prefix of a long one.
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const prefixHits = short.filter((s) => long.some((l) => l.startsWith(s) || (s.length >= 3 && l.startsWith(s.slice(0, 3)) && s.length < l.length))).length;
  const prefixScore = (prefixHits / short.length) * 0.9;
  return Math.max(base, prefixScore);
}

export interface MatchParts {
  title: number;
  authors: number | null;
  year: number | null;
  container: number | null;
}

export interface MatchScore {
  score: number;
  parts: MatchParts;
}

/** How well a parsed entry agrees with a candidate record. Missing fields do not count against it. */
export function scoreMatch(ref: ParsedReference, work: Work): MatchScore {
  // Containment in the raw entry rescues badly parsed titles, but a short title such as
  // "Deep learning" is contained in many unrelated entries, so it only counts when long.
  const workTokens = titleTokens(work.title).length;
  const containment = titleContainedIn(work.title, ref.raw) * (workTokens >= 5 ? 0.9 : workTokens >= 3 ? 0.6 : 0.4);
  const titleSim = ref.title ? Math.max(titleSimilarity(ref.title, work.title), containment) : containment / 0.9;

  let authors: number | null = null;
  if (ref.authors.length > 0 && work.authors.length > 0) {
    const check = ref.authors.slice(0, 3);
    authors = check.filter((a) => work.authors.some((w) => familyMatches(a, w))).length / check.length;
  }
  let year: number | null = null;
  if (ref.year !== undefined && work.year !== undefined) {
    const diff = Math.abs(ref.year - work.year);
    year = diff === 0 ? 1 : diff === 1 ? 0.6 : 0;
  }
  const container = ref.container && work.container ? containerSimilarity(ref.container, work.container) : null;

  const weighted: Array<[number, number]> = [[titleSim, 0.55]];
  if (authors !== null) weighted.push([authors, 0.15]);
  if (year !== null) weighted.push([year, 0.15]);
  if (container !== null) weighted.push([container, 0.15]);
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  const score = weighted.reduce((s, [v, w]) => s + v * w, 0) / total;
  return { score: Math.round(score * 1000) / 1000, parts: { title: Math.round(titleSim * 1000) / 1000, authors, year, container } };
}

function firstPage(p: string | undefined): string {
  return (p ?? "").split(/[-–—]/)[0]?.replace(/\D/g, "") ?? "";
}

export function findDiscrepancies(ref: ParsedReference, work: Work): Discrepancy[] {
  const out: Discrepancy[] = [];
  if (ref.year !== undefined && work.year !== undefined && ref.year !== work.year) {
    out.push({ field: "year", cited: String(ref.year), actual: String(work.year) });
  }
  const firstCited = ref.authors[0];
  const people = work.authors.filter((a) => !notAPerson(a));
  if (firstCited && people.length > 0 && !people.slice(0, 1).some((a) => familyMatches(firstCited, a))) {
    const present = people.some((a) => familyMatches(firstCited, a));
    out.push({
      field: "authors",
      cited: firstCited.family,
      actual: people.slice(0, 3).map((a) => a.family).join(", ") + (present ? " (cited author is not first)" : ""),
    });
  }
  // A title the parser missed (an entry in an unusual style) is not a wrong title when the real one is in the entry.
  if (ref.title && titleSimilarity(ref.title, work.title) < 0.85 && titleContainedIn(work.title, ref.raw) < 0.9)
    out.push({ field: "title", cited: ref.title, actual: work.title });
  if (ref.container && work.container && containerSimilarity(ref.container, work.container) < 0.5) {
    out.push({ field: "container", cited: ref.container, actual: work.container });
  }
  if (ref.volume && work.volume && ref.volume.replace(/\D/g, "") !== work.volume.replace(/\D/g, "")) {
    out.push({ field: "volume", cited: ref.volume, actual: work.volume });
  }
  const cp = firstPage(ref.pages);
  const wp = firstPage(work.pages);
  if (cp && wp && cp !== wp) out.push({ field: "pages", cited: ref.pages, actual: work.pages });
  return out;
}

const VERIFIED_SCORE = 0.82;
const LIKELY_SCORE = 0.62;

function searchQuery(ref: ParsedReference): string {
  if (ref.title) {
    const family = ref.authors.slice(0, 2).map((a) => a.family).join(" ");
    return [family, ref.title, ref.year ?? ""].filter(Boolean).join(" ");
  }
  return ref.raw
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b10\.\d{4,9}\/\S+/g, " ")
    .slice(0, 300);
}

function bestCandidate(ref: ParsedReference, candidates: readonly Work[]): { work: Work; score: MatchScore } | null {
  let best: { work: Work; score: MatchScore } | null = null;
  for (const work of candidates) {
    const score = scoreMatch(ref, work);
    if (!best || score.score > best.score.score) best = { work, score };
  }
  return best;
}

function statusFromScore(score: MatchScore): VerifyStatus {
  if (score.score >= VERIFIED_SCORE && score.parts.title >= 0.75) return "verified";
  if (score.score >= LIKELY_SCORE && score.parts.title >= 0.55) return "likely";
  return "not_found";
}

const RETRACTION_FLAG: Record<string, ReferenceFlag> = {
  retracted: "retracted",
  withdrawn: "withdrawn",
  removed: "removed",
  expression_of_concern: "expression_of_concern",
};

async function enrichRetraction(work: Work, deps: VerifierDeps): Promise<Work> {
  if (work.retraction || !work.doi || !deps.openalex) return work;
  try {
    const oa = await deps.openalex.getByDoi(work.doi);
    if (oa?.retraction) return { ...work, retraction: oa.retraction, sources: [...new Set([...work.sources, ...oa.sources])] };
  } catch {
    // The retraction cross-check is best effort.
  }
  return work;
}

/** Checks one reference-list entry against Crossref, DataCite, arXiv and OpenAlex. */
export async function verifyReference(ref: ParsedReference, deps: VerifierDeps): Promise<ReferenceCheck> {
  const check: ReferenceCheck = { index: ref.index, raw: ref.raw, ref, status: "not_found", score: 0, discrepancies: [], flags: [], notes: [] };
  if (ref.completeness < 0.3 && !ref.doi && !ref.arxivId) {
    check.flags.push("incomplete_reference");
    check.notes.push("This entry is too incomplete to read reliably (no recognisable title, author or year).");
  }

  let lookupFailed = false;
  let match: { work: Work; score: MatchScore } | null = null;
  let doiWork: Work | null = null;

  try {
    if (ref.doi) {
      doiWork = (await deps.crossref.getWork(ref.doi)) ?? (deps.datacite ? await deps.datacite.getWork(ref.doi) : null);
      if (!doiWork) {
        check.flags.push("doi_not_found");
        check.notes.push(`The DOI ${ref.doi} is not registered with Crossref or DataCite. A mistyped or invented DOI is a common sign of a faulty reference.`);
      }
    }
    if (!doiWork && ref.arxivId && deps.arxiv) doiWork = await deps.arxiv.getById(ref.arxivId);

    if (doiWork) {
      const s = scoreMatch(ref, doiWork);
      if (s.parts.title >= 0.75) match = { work: doiWork, score: s };
      else if (s.parts.title >= 0.45) match = { work: doiWork, score: s };
      else {
        check.flags.push("doi_points_elsewhere");
        check.doiWork = doiWork;
        check.notes.push(`The cited DOI resolves to "${doiWork.title}", which does not match the title of this entry.`);
      }
    }

    if (!match || statusFromScore(match.score) !== "verified") {
      const candidates: Work[] = [];
      try {
        candidates.push(...(await deps.crossref.search(searchQuery(ref), 5)));
      } catch {
        lookupFailed = true;
      }
      if (ref.title && deps.openalex && (bestCandidate(ref, candidates)?.score.score ?? 0) < VERIFIED_SCORE) {
        try {
          candidates.push(...(await deps.openalex.searchByTitle(ref.title, 5)));
        } catch {
          lookupFailed = lookupFailed || candidates.length === 0;
        }
      }
      // Conference papers (NeurIPS, ICLR) often have no DOI record; their arXiv version does.
      const sofar = bestCandidate(ref, candidates);
      if (ref.title && deps.arxiv?.searchByTitle && (!sofar || sofar.score.score < VERIFIED_SCORE || sofar.score.parts.year === 0)) {
        try {
          candidates.push(...(await deps.arxiv.searchByTitle(ref.title, 3)));
        } catch {
          // arXiv is a fallback; its failure alone does not make the entry unchecked.
        }
      }
      const best = bestCandidate(ref, candidates);
      if (best && (!match || best.score.score > match.score.score + 0.05)) match = best;
    }
  } catch (err) {
    lookupFailed = true;
    check.notes.push(`Lookup failed: ${err instanceof Error ? err.message : "unknown error"}.`);
  }

  if (!match) {
    if (check.flags.includes("doi_points_elsewhere") && !lookupFailed) {
      check.status = "mismatch";
      return check;
    }
    check.status = lookupFailed ? "unchecked" : "not_found";
    if (lookupFailed) check.notes.push("A lookup service could not be reached, so this entry was not checked.");
    else check.notes.push("No close match in Crossref or OpenAlex. It may be a book, report, thesis or web page, or the entry may contain errors. Check it by hand.");
    return check;
  }

  const work = await enrichRetraction(match.work, deps);
  check.match = work;
  check.score = match.score.score;
  check.discrepancies = findDiscrepancies(ref, work);

  let status = statusFromScore(match.score);
  if (status === "not_found") status = check.flags.includes("doi_points_elsewhere") ? "mismatch" : "not_found";
  if (check.flags.includes("doi_points_elsewhere") && status !== "not_found") {
    // The DOI was wrong but a different record fits the rest of the entry.
    check.notes.push("The entry itself matches a different record than its DOI, so the DOI is probably wrong.");
    status = "mismatch";
  }
  if (status === "verified" && check.discrepancies.some((d) => d.field !== "container")) {
    // The record is right but the entry has a wrong detail, which a reader should fix.
    status = "likely";
  }
  if (status === "not_found") {
    check.match = undefined;
    check.score = 0;
    check.discrepancies = [];
    check.notes.push("No close match in Crossref or OpenAlex. It may be a book, report, thesis or web page, or the entry may contain errors. Check it by hand.");
  }
  check.status = status;

  if (work.retraction && check.match) {
    const flag = RETRACTION_FLAG[work.retraction.status];
    if (flag) check.flags.push(flag);
    check.notes.push(
      `This work is marked as ${work.retraction.status.replace(/_/g, " ")} (${work.retraction.source}${work.retraction.date ? `, ${work.retraction.date}` : ""}).`,
    );
  }
  if (status === "likely" && check.discrepancies.length === 0) check.notes.push("A similar record exists; the details are close but not exact.");
  return check;
}

/** Marks entries that repeat an earlier entry. */
export function markDuplicates(checks: ReferenceCheck[]): void {
  const seen: ReferenceCheck[] = [];
  for (const c of checks) {
    const dup = seen.find((s) => {
      const doiTrusted = (x: ReferenceCheck) => x.ref.doi && !x.flags.includes("doi_points_elsewhere") && !x.flags.includes("doi_not_found");
      if (doiTrusted(s) && doiTrusted(c)) return s.ref.doi === c.ref.doi;
      if (s.ref.title && c.ref.title) return titleSimilarity(s.ref.title, c.ref.title) >= 0.95 && s.ref.year === c.ref.year;
      return normalizeTitle(s.raw) === normalizeTitle(c.raw);
    });
    if (dup) {
      c.flags.push("duplicate");
      c.notes.push(`Duplicates entry ${dup.index}.`);
    } else seen.push(c);
  }
}

export interface VerifyListResult {
  checks: ReferenceCheck[];
  counts: Record<VerifyStatus, number> & { flagged: number };
}

export async function verifyReferences(
  refs: readonly ParsedReference[],
  deps: VerifierDeps,
  options: { concurrency?: number } = {},
): Promise<VerifyListResult> {
  const checks = await mapLimit(refs, options.concurrency ?? 4, (ref) => verifyReference(ref, deps));
  markDuplicates(checks);
  const counts = { verified: 0, likely: 0, mismatch: 0, not_found: 0, unchecked: 0, flagged: 0 };
  for (const c of checks) {
    counts[c.status]++;
    if (c.flags.some((f) => f !== "incomplete_reference" && f !== "duplicate")) counts.flagged++;
  }
  return { checks, counts };
}
