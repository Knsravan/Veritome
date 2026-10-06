import { HttpError, type Http } from "../../infra/http.ts";
import type { Author, RetractionInfo, RetractionStatus, Work } from "../types.ts";
import { normalizeDoi, stripTags } from "./common.ts";

interface DateParts {
  "date-parts"?: Array<Array<number | null>>;
}

export interface CrossrefItem {
  DOI?: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string; name?: string }>;
  issued?: DateParts;
  "published-print"?: DateParts;
  "published-online"?: DateParts;
  created?: DateParts;
  "container-title"?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  type?: string;
  URL?: string;
  publisher?: string;
  abstract?: string;
  "is-referenced-by-count"?: number;
  "updated-by"?: Array<{ DOI?: string; type?: string; label?: string; source?: string; updated?: DateParts }>;
  relation?: Record<string, unknown>;
}

const RETRACTION_TYPES: Readonly<Record<string, RetractionStatus>> = {
  retraction: "retracted",
  withdrawal: "withdrawn",
  removal: "removed",
  expression_of_concern: "expression_of_concern",
  "expression-of-concern": "expression_of_concern",
};

function datePart(d: DateParts | undefined): number | undefined {
  const year = d?.["date-parts"]?.[0]?.[0];
  return typeof year === "number" ? year : undefined;
}

function dateString(d: DateParts | undefined): string | undefined {
  const parts = d?.["date-parts"]?.[0];
  if (!parts || typeof parts[0] !== "number") return undefined;
  return parts.filter((p): p is number => typeof p === "number").map((p, i) => (i === 0 ? String(p) : String(p).padStart(2, "0"))).join("-");
}

/** Reads Crossref's update records (which include Retraction Watch data) and title conventions. */
export function detectCrossrefRetraction(item: CrossrefItem): RetractionInfo | undefined {
  for (const u of item["updated-by"] ?? []) {
    const status = RETRACTION_TYPES[(u.type ?? "").toLowerCase()];
    if (status) {
      const date = dateString(u.updated);
      return { status, source: u.source === "retraction-watch" ? "Crossref / Retraction Watch" : "Crossref", ...(u.DOI ? { noticeDoi: u.DOI.toLowerCase() } : {}), ...(date ? { date } : {}) };
    }
  }
  const relations = Object.keys(item.relation ?? {});
  if (relations.some((r) => /retract/i.test(r) && /(?:is-)?retracted-by|has-retraction/i.test(r))) {
    return { status: "retracted", source: "Crossref" };
  }
  const title = item.title?.[0] ?? "";
  if (/^\s*(?:retracted|withdrawn)\s*[:\-–]/i.test(title)) return { status: /withdrawn/i.test(title) ? "withdrawn" : "retracted", source: "Crossref (title)" };
  return undefined;
}

export function mapCrossrefItem(item: CrossrefItem): Work {
  const authors: Author[] = (item.author ?? []).map((a) =>
    a.family ? { family: a.family, ...(a.given ? { given: a.given } : {}) } : { family: a.name ?? "", organization: true },
  );
  const year = datePart(item.issued) ?? datePart(item["published-print"]) ?? datePart(item["published-online"]) ?? datePart(item.created);
  const doi = normalizeDoi(item.DOI);
  const work: Work = {
    title: stripTags(item.title?.[0] ?? "") || "(untitled)",
    authors: authors.filter((a) => a.family),
    sources: ["crossref"],
  };
  if (year !== undefined) work.year = year;
  const container = item["container-title"]?.[0];
  if (container) work.container = stripTags(container);
  if (item.volume) work.volume = item.volume;
  if (item.issue) work.issue = item.issue;
  if (item.page) work.pages = item.page;
  if (doi) work.doi = doi;
  if (item.URL) work.url = item.URL;
  if (item.publisher) work.publisher = item.publisher;
  if (item.type) work.type = item.type;
  if (item.abstract) work.abstract = stripTags(item.abstract);
  if (typeof item["is-referenced-by-count"] === "number") work.citationCount = item["is-referenced-by-count"];
  const retraction = detectCrossrefRetraction(item);
  if (retraction) work.retraction = retraction;
  return work;
}

export interface CrossrefClient {
  /** Returns null when the DOI is not registered with Crossref. */
  getWork(doi: string): Promise<Work | null>;
  search(query: string, rows?: number): Promise<Work[]>;
}

export function createCrossref(http: Http, options: { mailto?: string; baseUrl?: string } = {}): CrossrefClient {
  const base = (options.baseUrl ?? "https://api.crossref.org").replace(/\/+$/, "");
  const mailto = options.mailto ? `&mailto=${encodeURIComponent(options.mailto)}` : "";
  return {
    async getWork(doi) {
      try {
        const data = await http.json<{ message?: CrossrefItem }>(`${base}/works/${encodeURIComponent(doi)}?${mailto.slice(1)}`);
        return data.message ? mapCrossrefItem(data.message) : null;
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) return null;
        throw err;
      }
    },
    async search(query, rows = 5) {
      const data = await http.json<{ message?: { items?: CrossrefItem[] } }>(
        `${base}/works?query.bibliographic=${encodeURIComponent(query)}&rows=${rows}${mailto}`,
      );
      return (data.message?.items ?? []).map(mapCrossrefItem);
    },
  };
}
