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

/** Exact phrases to try for a passage, best first (one per sentence). */
export function phrasesOf(p: Passage): string[] {
  const list = p.phrases?.length ? p.phrases : p.phrase ? [p.phrase] : [];
  return list.filter((x) => x.split(/\s+/).length >= 5);
}

export function arxivProvider(client: Pick<ArxivClient, "search"> & Partial<Pick<ArxivClient, "searchAbstractPhrase">>): SourceProvider {
  return {
    name: "arXiv",
    kind: "scholarly",
    coverage: "Titles and abstracts of about 2.5 million preprints, searched by exact phrase first.",
    async search(p) {
      // An exact phrase finds copied abstracts precisely; topic keywords are the fallback.
      if (client.searchAbstractPhrase) {
        for (const phrase of phrasesOf(p)) {
          const hits = await client.searchAbstractPhrase(phrase, 3);
          if (hits.length) return hits.map((w) => workToSource(w, "arXiv"));
        }
      }
      return p.keywords ? (await client.search(p.keywords, 6)).map((w) => workToSource(w, "arXiv")) : [];
    },
  };
}

/** Removes XML/HTML markup from a full-text document. */
export function stripMarkup(xml: string): string {
  return stripTags(
    xml
      .replace(/<(script|style|ref-list|table-wrap|fig|disp-formula|tex-math)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|sec|title|abstract|div|li|h\d)>/gi, "\n"),
  );
}

const FULL_TEXT_LIMIT = 400_000;

interface EuropePmcResult {
  id?: string;
  source?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  pubYear?: string;
  abstractText?: string;
  isOpenAccess?: string;
  inEPMC?: string;
}

/**
 * Europe PMC searches abstracts of 45 million life-science articles and the full
 * text of about 10 million open-access ones, so an exact phrase can be found
 * anywhere in a paper, not only in its abstract.
 */
export function europePmcProvider(http: Http, options: { baseUrl?: string; maxFullText?: number } = {}): SourceProvider {
  const base = (options.baseUrl ?? "https://www.ebi.ac.uk/europepmc/webservices/rest").replace(/\/+$/, "");
  const maxFull = options.maxFullText ?? 2;
  return {
    name: "Europe PMC",
    kind: "scholarly",
    coverage: "Abstracts of 45 million life-science papers and full text of about 10 million open-access ones.",
    async search(p) {
      for (const phrase of phrasesOf(p)) {
        const data = await http.json<{ resultList?: { result?: EuropePmcResult[] } }>(
          `${base}/search?query=${encodeURIComponent(`"${phrase.replace(/"/g, "")}"`)}&format=json&resultType=core&pageSize=4`,
        );
        const results = data.resultList?.result ?? [];
        if (results.length === 0) continue;
        const docs: SourceDoc[] = [];
        let fetched = 0;
        for (const r of results) {
          let text = [r.title, r.abstractText].filter(Boolean).map((x) => stripTags(x as string)).join(". ");
          if (r.pmcid && r.isOpenAccess === "Y" && r.inEPMC === "Y" && fetched < maxFull) {
            fetched++;
            try {
              const xml = await http.text(`${base}/${encodeURIComponent(r.pmcid)}/fullTextXML`, { timeoutMs: 20_000, retries: 0 });
              text = stripMarkup(xml).slice(0, FULL_TEXT_LIMIT);
            } catch {
              // Abstract only when the full text cannot be fetched.
            }
          }
          if (!text) continue;
          const doi = r.doi?.toLowerCase();
          docs.push({
            id: doi ? `doi:${doi}` : `epmc:${r.source}:${r.id}`,
            title: stripTags(r.title ?? "Untitled article"),
            text,
            provider: "Europe PMC",
            kind: "scholarly",
            url: doi ? `https://doi.org/${doi}` : `https://europepmc.org/article/${r.source}/${r.id}`,
            ...(doi ? { doi } : {}),
            ...(r.pubYear ? { year: Number(r.pubYear) } : {}),
            ...(r.authorString ? { authors: r.authorString.split(",").slice(0, 3).join(",") + (r.authorString.split(",").length > 3 ? " et al." : "") } : {}),
          });
        }
        return docs;
      }
      return [];
    },
  };
}

/** Wikipedia articles containing the exact phrase, compared in full. */
export function wikipediaProvider(http: Http, options: { baseUrl?: string; lang?: string } = {}): SourceProvider {
  const base = (options.baseUrl ?? `https://${options.lang ?? "en"}.wikipedia.org/w/api.php`).replace(/\/+$/, "");
  return {
    name: "Wikipedia",
    kind: "web",
    coverage: "Full text of Wikipedia articles containing the exact phrase.",
    async search(p) {
      for (const phrase of phrasesOf(p)) {
        const data = await http.json<{ query?: { search?: Array<{ pageid: number; title: string }> } }>(
          `${base}?action=query&list=search&format=json&srlimit=2&srsearch=${encodeURIComponent(`"${phrase.replace(/"/g, "")}"`)}`,
        );
        const hits = data.query?.search ?? [];
        if (hits.length === 0) continue;
        const docs: SourceDoc[] = [];
        for (const h of hits) {
          const page = await http.json<{ query?: { pages?: Record<string, { extract?: string; fullurl?: string }> } }>(
            `${base}?action=query&prop=extracts|info&inprop=url&explaintext=1&format=json&pageids=${h.pageid}`,
          );
          const info = page.query?.pages?.[String(h.pageid)];
          if (!info?.extract) continue;
          docs.push({
            id: `wikipedia:${h.pageid}`,
            title: `${h.title} (Wikipedia)`,
            text: info.extract.slice(0, FULL_TEXT_LIMIT),
            provider: "Wikipedia",
            kind: "web",
            url: info.fullurl ?? `https://en.wikipedia.org/?curid=${h.pageid}`,
          });
        }
        return docs;
      }
      return [];
    },
  };
}

interface CoreWork {
  id?: number | string;
  title?: string;
  doi?: string;
  yearPublished?: number;
  authors?: Array<{ name?: string }>;
  fullText?: string;
  abstract?: string;
  downloadUrl?: string;
}

/** CORE aggregates the full text of open-access papers from thousands of repositories. Needs a free key. */
export function coreProvider(http: Http, apiKey: string, options: { baseUrl?: string } = {}): SourceProvider {
  const base = (options.baseUrl ?? "https://api.core.ac.uk/v3").replace(/\/+$/, "");
  return {
    name: "CORE",
    kind: "scholarly",
    coverage: "Full text of over 30 million open-access papers from university and subject repositories.",
    async search(p) {
      for (const phrase of phrasesOf(p)) {
        const data = await http.json<{ results?: CoreWork[] }>(`${base}/search/works?q=${encodeURIComponent(`"${phrase.replace(/"/g, "")}"`)}&limit=3`, {
          headers: { authorization: `Bearer ${apiKey}` },
        });
        const results = (data.results ?? []).filter((r) => r.fullText || r.abstract);
        if (results.length === 0) continue;
        return results.map((r) => {
          const doi = r.doi?.toLowerCase();
          const names = (r.authors ?? []).map((a) => a.name ?? "").filter(Boolean);
          return {
            id: doi ? `doi:${doi}` : `core:${r.id}`,
            title: r.title ?? "Untitled paper",
            text: [r.title, r.fullText ?? r.abstract].filter(Boolean).join(". ").slice(0, FULL_TEXT_LIMIT),
            provider: "CORE",
            kind: "scholarly" as const,
            url: doi ? `https://doi.org/${doi}` : (r.downloadUrl ?? `https://core.ac.uk/works/${r.id}`),
            ...(doi ? { doi } : {}),
            ...(r.yearPublished ? { year: r.yearPublished } : {}),
            ...(names.length ? { authors: names.slice(0, 3).join("; ") + (names.length > 3 ? " et al." : "") } : {}),
          };
        });
      }
      return [];
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
