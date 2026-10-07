import { HttpError, type Http } from "../../infra/http.ts";
import type { Work } from "../types.ts";
import { normalizeDoi, splitName } from "./common.ts";

export interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  authorships?: Array<{ author?: { display_name?: string | null } }>;
  primary_location?: { source?: { display_name?: string | null } | null; landing_page_url?: string | null } | null;
  biblio?: { volume?: string | null; issue?: string | null; first_page?: string | null; last_page?: string | null };
  cited_by_count?: number;
  abstract_inverted_index?: Record<string, number[]> | null;
  type?: string | null;
  is_retracted?: boolean;
}

const SELECT =
  "id,doi,title,display_name,publication_year,authorships,primary_location,biblio,cited_by_count,abstract_inverted_index,type,is_retracted";

/** OpenAlex ships abstracts as {word: [positions]}; rebuild the running text. */
export function rebuildAbstract(index: Record<string, number[]> | null | undefined): string | undefined {
  if (!index) return undefined;
  const slots: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const p of positions) slots[p] = word;
  const text = slots.filter((w) => w !== undefined).join(" ").trim();
  return text || undefined;
}

export function mapOpenAlexWork(w: OpenAlexWork): Work {
  const title = (w.title ?? w.display_name ?? "").trim();
  const work: Work = {
    title: title || "(untitled)",
    authors: (w.authorships ?? []).map((a) => a.author?.display_name).filter((n): n is string => Boolean(n)).map(splitName),
    sources: ["openalex"],
  };
  if (w.publication_year) work.year = w.publication_year;
  const container = w.primary_location?.source?.display_name;
  if (container) work.container = container;
  if (w.biblio?.volume) work.volume = w.biblio.volume;
  if (w.biblio?.issue) work.issue = w.biblio.issue;
  if (w.biblio?.first_page) work.pages = w.biblio.last_page && w.biblio.last_page !== w.biblio.first_page ? `${w.biblio.first_page}-${w.biblio.last_page}` : w.biblio.first_page;
  const doi = normalizeDoi(w.doi);
  if (doi) work.doi = doi;
  const url = w.primary_location?.landing_page_url ?? w.id;
  if (url) work.url = url;
  if (w.type) work.type = w.type === "article" ? "journal-article" : w.type;
  const abstract = rebuildAbstract(w.abstract_inverted_index);
  if (abstract) work.abstract = abstract;
  if (typeof w.cited_by_count === "number") work.citationCount = w.cited_by_count;
  if (w.is_retracted) work.retraction = { status: "retracted", source: "OpenAlex" };
  return work;
}

export interface OpenAlexClient {
  search(query: string, perPage?: number): Promise<Work[]>;
  /** Returns null when OpenAlex does not know the DOI. */
  getByDoi(doi: string): Promise<Work | null>;
  searchByTitle(title: string, perPage?: number): Promise<Work[]>;
  /** Works whose text (title, abstract and, where OpenAlex has it, full text) contains this exact phrase. */
  searchPhrase?(phrase: string, perPage?: number): Promise<Work[]>;
}

/** Letters, digits, hyphens and apostrophes only, so a phrase cannot break the query syntax. */
export function cleanPhrase(phrase: string): string {
  return phrase
    .replace(/[^\p{L}\p{N}'’\- ]+/gu, " ")
    .replace(/\b(AND|OR|NOT)\b/g, (w) => w.toLowerCase())
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * OpenAlex now meters requests: without an API key every caller on the same IP
 * address shares one small daily budget. Keys are free; the key is sent as a
 * header so it never appears in URLs or error messages.
 */
export function createOpenAlex(http: Http, options: { mailto?: string; baseUrl?: string; apiKey?: string } = {}): OpenAlexClient {
  const base = (options.baseUrl ?? "https://api.openalex.org").replace(/\/+$/, "");
  const mailto = options.mailto ? `&mailto=${encodeURIComponent(options.mailto)}` : "";
  const req = options.apiKey ? { headers: { authorization: `Bearer ${options.apiKey}` } } : {};
  return {
    async search(query, perPage = 10) {
      const data = await http.json<{ results?: OpenAlexWork[] }>(
        `${base}/works?search=${encodeURIComponent(query)}&per-page=${perPage}&select=${SELECT}${mailto}`,
        req,
      );
      return (data.results ?? []).map(mapOpenAlexWork);
    },
    async getByDoi(doi) {
      try {
        const w = await http.json<OpenAlexWork>(`${base}/works/https://doi.org/${encodeURIComponent(doi).replace(/%2F/gi, "/")}?select=${SELECT}${mailto}`, req);
        return mapOpenAlexWork(w);
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) return null;
        throw err;
      }
    },
    async searchPhrase(phrase, perPage = 3) {
      const clean = cleanPhrase(phrase);
      if (clean.split(" ").length < 4) return [];
      const data = await http.json<{ results?: OpenAlexWork[] }>(
        `${base}/works?search=${encodeURIComponent(`"${clean}"`)}&per-page=${perPage}&select=${SELECT}${mailto}`,
        req,
      );
      return (data.results ?? []).map(mapOpenAlexWork);
    },
    async searchByTitle(title, perPage = 5) {
      const data = await http.json<{ results?: OpenAlexWork[] }>(
        `${base}/works?filter=title.search:${encodeURIComponent(title.replace(/[,:|]/g, " "))}&per-page=${perPage}&select=${SELECT}${mailto}`,
        req,
      );
      return (data.results ?? []).map(mapOpenAlexWork);
    },
  };
}
