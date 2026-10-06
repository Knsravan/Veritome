import type { Http } from "../../infra/http.ts";
import type { Work } from "../types.ts";
import { normalizeDoi, splitName } from "./common.ts";

export interface S2Paper {
  paperId?: string;
  title?: string | null;
  authors?: Array<{ name?: string | null }>;
  year?: number | null;
  venue?: string | null;
  journal?: { name?: string | null; volume?: string | null; pages?: string | null } | null;
  externalIds?: { DOI?: string; ArXiv?: string } | null;
  abstract?: string | null;
  citationCount?: number | null;
  publicationTypes?: string[] | null;
  url?: string | null;
}

const FIELDS = "title,authors,year,venue,journal,externalIds,abstract,citationCount,publicationTypes,url";

export function mapS2Paper(p: S2Paper): Work {
  const work: Work = {
    title: (p.title ?? "").trim() || "(untitled)",
    authors: (p.authors ?? []).map((a) => a.name).filter((n): n is string => Boolean(n)).map(splitName),
    sources: ["semanticscholar"],
  };
  if (p.year) work.year = p.year;
  const container = p.journal?.name || p.venue;
  if (container) work.container = container;
  if (p.journal?.volume) work.volume = p.journal.volume;
  if (p.journal?.pages) work.pages = p.journal.pages;
  const doi = normalizeDoi(p.externalIds?.DOI);
  if (doi) work.doi = doi;
  if (p.externalIds?.ArXiv) work.arxivId = p.externalIds.ArXiv;
  if (p.url) work.url = p.url;
  if (p.abstract) work.abstract = p.abstract;
  if (typeof p.citationCount === "number") work.citationCount = p.citationCount;
  const type = p.publicationTypes?.[0];
  if (type) work.type = type === "JournalArticle" ? "journal-article" : type === "Conference" ? "proceedings-article" : type.toLowerCase();
  return work;
}

export interface SemanticScholarClient {
  search(query: string, limit?: number): Promise<Work[]>;
}

export function createSemanticScholar(http: Http, options: { apiKey?: string; baseUrl?: string } = {}): SemanticScholarClient {
  const base = (options.baseUrl ?? "https://api.semanticscholar.org/graph/v1").replace(/\/+$/, "");
  return {
    async search(query, limit = 10) {
      const data = await http.json<{ data?: S2Paper[] }>(
        `${base}/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${FIELDS}`,
        { headers: options.apiKey ? { "x-api-key": options.apiKey } : {} },
      );
      return (data.data ?? []).map(mapS2Paper);
    },
  };
}
