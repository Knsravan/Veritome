import { normalizeTitle } from "../../text/similarity.ts";
import type { Author, Work } from "../types.ts";

const FAMILY_PARTICLES = new Set(["van", "von", "de", "der", "den", "di", "da", "del", "della", "la", "le", "bin", "ibn", "al", "el", "ter", "ten", "du", "dos", "das"]);
const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "phd", "md"]);

/** Splits "Given Middle Family" into parts; also accepts "Family, Given". */
export function splitName(display: string): Author {
  const name = display.trim().replace(/\s+/g, " ");
  if (name.includes(",")) {
    const [family, ...rest] = name.split(",");
    const given = rest.join(",").trim();
    return given ? { family: (family ?? "").trim(), given } : { family: (family ?? "").trim() };
  }
  const parts = name.split(" ").filter((p) => !SUFFIXES.has(p.toLowerCase()));
  if (parts.length <= 1) return { family: parts[0] ?? name };
  let familyStart = parts.length - 1;
  while (familyStart > 1 && FAMILY_PARTICLES.has((parts[familyStart - 1] ?? "").toLowerCase())) familyStart--;
  return { family: parts.slice(familyStart).join(" "), given: parts.slice(0, familyStart).join(" ") };
}

/** Lower-cases a DOI and strips resolver prefixes such as https://doi.org/. */
export function normalizeDoi(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const m = /10\.\d{4,9}\/[^\s"<>]+/i.exec(input);
  if (!m) return undefined;
  return m[0].replace(/[.,;:)\]}>]+$/, "").toLowerCase();
}

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

export function stripTags(s: string): string {
  return decodeXmlEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Stable identity for de-duplication: DOI when known, else normalised title plus year. */
export function workKey(work: Work): string {
  if (work.doi) return `doi:${work.doi}`;
  if (work.arxivId) return `arxiv:${work.arxivId.replace(/v\d+$/, "")}`;
  return `title:${normalizeTitle(work.title)}:${work.year ?? ""}`;
}

/** Combines two records for the same work, keeping the richest value of each field. */
export function mergeWorks(a: Work, b: Work): Work {
  const pick = <T>(x: T | undefined, y: T | undefined): T | undefined => (x !== undefined && x !== "" ? x : y);
  const merged: Work = {
    title: a.title.length >= b.title.length ? a.title : b.title,
    authors: a.authors.length >= b.authors.length && a.authors.some((x) => x.given) ? a.authors : b.authors.length > a.authors.length ? b.authors : a.authors,
    sources: [...new Set([...a.sources, ...b.sources])],
  };
  const optional: Array<[keyof Work, unknown]> = [
    ["year", pick(a.year, b.year)],
    ["container", pick(a.container, b.container)],
    ["volume", pick(a.volume, b.volume)],
    ["issue", pick(a.issue, b.issue)],
    ["pages", pick(a.pages, b.pages)],
    ["doi", pick(a.doi, b.doi)],
    ["url", pick(a.url, b.url)],
    ["publisher", pick(a.publisher, b.publisher)],
    ["type", pick(a.type, b.type)],
    ["arxivId", pick(a.arxivId, b.arxivId)],
    ["retraction", pick(a.retraction, b.retraction)],
  ];
  for (const [key, value] of optional) if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
  const abstract = (a.abstract?.length ?? 0) >= (b.abstract?.length ?? 0) ? a.abstract : b.abstract;
  if (abstract) merged.abstract = abstract;
  const cites = Math.max(a.citationCount ?? -1, b.citationCount ?? -1);
  if (cites >= 0) merged.citationCount = cites;
  return merged;
}

export function dedupeWorks(works: readonly Work[]): Work[] {
  const byKey = new Map<string, Work>();
  const titleIndex = new Map<string, string>();
  for (const w of works) {
    let key = workKey(w);
    const titleKey = `${normalizeTitle(w.title)}:${w.year ?? ""}`;
    // A record without a DOI should merge into a DOI-bearing record with the same title and year.
    const existingByTitle = titleIndex.get(titleKey);
    if (!byKey.has(key) && existingByTitle) key = existingByTitle;
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeWorks(existing, w) : w);
    if (!titleIndex.has(titleKey)) titleIndex.set(titleKey, key);
  }
  return [...byKey.values()];
}

export interface ScholarlyConfig {
  /** Contact address for the polite pools of Crossref and OpenAlex. */
  mailto?: string;
  semanticScholarKey?: string;
}
