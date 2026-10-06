import type { Http } from "../infra/http.ts";
import type { ArxivClient } from "../citations/sources/arxiv.ts";
import { stripTags } from "../citations/sources/common.ts";
import type { CrossrefClient } from "../citations/sources/crossref.ts";
import type { OpenAlexClient } from "../citations/sources/openalex.ts";
import type { SemanticScholarClient } from "../citations/sources/semanticscholar.ts";
import type { Work } from "../citations/types.ts";
import type { Passage } from "./passages.ts";

export type SourceKind = "scholarly" | "web" | "library" | "self";

/** Text that something else published, which the checked text is compared against. */
export interface SourceDoc {
  id: string;
  title: string;
  url?: string;
  doi?: string;
  year?: number;
  authors?: string;
  text: string;
  provider: string;
  kind: SourceKind;
}

export interface SourceProvider {
  name: string;
  kind: "scholarly" | "web";
  /** What this provider can see, shown to the user so limits are clear. */
  coverage: string;
  search(passage: Passage, signal?: AbortSignal): Promise<SourceDoc[]>;
}

function authorString(work: Work): string | undefined {
  if (work.authors.length === 0) return undefined;
  const names = work.authors.slice(0, 3).map((a) => a.family);
  return names.join(", ") + (work.authors.length > 3 ? " et al." : "");
}

export function workToSource(work: Work, provider: string): SourceDoc {
  const doc: SourceDoc = {
    id: work.doi ? `doi:${work.doi}` : (work.url ?? `title:${work.title}`),
    title: work.title,
    text: [work.title, work.abstract].filter(Boolean).join(". "),
    provider,
    kind: "scholarly",
  };
  if (work.url) doc.url = work.url;
  else if (work.doi) doc.url = `https://doi.org/${work.doi}`;
  if (work.doi) doc.doi = work.doi;
  if (work.year) doc.year = work.year;
  const authors = authorString(work);
  if (authors) doc.authors = authors;
  return doc;
}

export function openAlexProvider(client: Pick<OpenAlexClient, "search">): SourceProvider {
  return {
    name: "OpenAlex",
    kind: "scholarly",
    coverage: "Titles and abstracts of about 250 million scholarly works.",
    async search(p) {
      return p.keywords ? (await client.search(p.keywords, 10)).map((w) => workToSource(w, "OpenAlex")) : [];
    },
  };
}

export function crossrefProvider(client: Pick<CrossrefClient, "search">): SourceProvider {
  return {
    name: "Crossref",
    kind: "scholarly",
    coverage: "Titles and, where publishers deposit them, abstracts.",
    async search(p) {
      return p.keywords ? (await client.search(p.keywords, 8)).map((w) => workToSource(w, "Crossref")) : [];
    },
  };
}

export function semanticScholarProvider(client: Pick<SemanticScholarClient, "search">): SourceProvider {
  return {
    name: "Semantic Scholar",
    kind: "scholarly",
    coverage: "Titles and abstracts.",
    async search(p) {
      return p.keywords ? (await client.search(p.keywords, 10)).map((w) => workToSource(w, "Semantic Scholar")) : [];
    },
  };
}

export function arxivProvider(client: Pick<ArxivClient, "search">): SourceProvider {
  return {
    name: "arXiv",
    kind: "scholarly",
    coverage: "Titles and abstracts of preprints.",
    async search(p) {
      return p.keywords ? (await client.search(p.keywords, 6)).map((w) => workToSource(w, "arXiv")) : [];
    },
  };
}

interface S2SnippetResponse {
  data?: Array<{
    snippet?: { text?: string };
    paper?: { corpusId?: string | number; title?: string; authors?: Array<string | { name?: string }>; year?: number };
  }>;
}

/** Full-text snippets from open-access papers indexed by Semantic Scholar. */
export function semanticScholarSnippetProvider(http: Http, options: { apiKey?: string; baseUrl?: string } = {}): SourceProvider {
  const base = (options.baseUrl ?? "https://api.semanticscholar.org/graph/v1").replace(/\/+$/, "");
  return {
    name: "Semantic Scholar full text",
    kind: "scholarly",
    coverage: "Text snippets from the full text of open-access papers.",
    async search(p) {
      if (!p.phrase) return [];
      const data = await http.json<S2SnippetResponse>(`${base}/snippet/search?query=${encodeURIComponent(p.phrase)}&limit=10`, {
        headers: options.apiKey ? { "x-api-key": options.apiKey } : {},
      });
      const out: SourceDoc[] = [];
      for (const item of data.data ?? []) {
        const text = item.snippet?.text;
        if (!text) continue;
        const id = item.paper?.corpusId;
        const names = (item.paper?.authors ?? []).map((a) => (typeof a === "string" ? a : (a.name ?? ""))).filter(Boolean);
        out.push({
          id: id !== undefined ? `s2:${id}` : `s2:${item.paper?.title ?? text.slice(0, 40)}`,
          title: item.paper?.title ?? "Untitled paper",
          text,
          provider: "Semantic Scholar full text",
          kind: "scholarly",
          ...(id !== undefined ? { url: `https://api.semanticscholar.org/CorpusID:${id}` } : {}),
          ...(item.paper?.year ? { year: item.paper.year } : {}),
          ...(names.length ? { authors: names.slice(0, 3).map((n) => n.split(" ").pop() ?? n).join(", ") + (names.length > 3 ? " et al." : "") } : {}),
        });
      }
      return out;
    },
  };
}

interface BraveResponse {
  web?: { results?: Array<{ title?: string; url?: string; description?: string; extra_snippets?: string[] }> };
}

export function braveProvider(http: Http, apiKey: string, options: { baseUrl?: string } = {}): SourceProvider {
  const base = (options.baseUrl ?? "https://api.search.brave.com/res/v1/web/search").replace(/\/+$/, "");
  return {
    name: "Brave Search",
    kind: "web",
    coverage: "Search-result snippets for exact-phrase queries across the web.",
    async search(p) {
      if (!p.phrase) return [];
      const data = await http.json<BraveResponse>(`${base}?q=${encodeURIComponent(`"${p.phrase}"`)}&count=10`, {
        headers: { "x-subscription-token": apiKey },
      });
      return (data.web?.results ?? [])
        .filter((r) => r.url)
        .map((r) => ({
          id: r.url as string,
          title: stripTags(r.title ?? r.url ?? ""),
          url: r.url as string,
          text: stripTags([r.description, ...(r.extra_snippets ?? [])].filter(Boolean).join(" ... ")),
          provider: "Brave Search",
          kind: "web" as const,
        }));
    },
  };
}

interface SerperResponse {
  organic?: Array<{ title?: string; link?: string; snippet?: string }>;
}

export function serperProvider(http: Http, apiKey: string, options: { baseUrl?: string } = {}): SourceProvider {
  const url = options.baseUrl ?? "https://google.serper.dev/search";
  return {
    name: "Google (Serper)",
    kind: "web",
    coverage: "Search-result snippets for exact-phrase queries across the web.",
    async search(p) {
      if (!p.phrase) return [];
      const data = await http.json<SerperResponse>(url, {
        method: "POST",
        headers: { "x-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({ q: `"${p.phrase}"`, num: 10 }),
      });
      return (data.organic ?? [])
        .filter((r) => r.link)
        .map((r) => ({
          id: r.link as string,
          title: r.title ?? (r.link as string),
          url: r.link as string,
          text: r.snippet ?? "",
          provider: "Google (Serper)",
          kind: "web" as const,
        }));
    },
  };
}
