import type { Http } from "../../infra/http.ts";
import type { Work } from "../types.ts";
import { decodeXmlEntities, normalizeDoi, splitName } from "./common.ts";

function tag(entry: string, name: string): string | undefined {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(entry);
  return m?.[1] ? decodeXmlEntities(m[1]).replace(/\s+/g, " ").trim() : undefined;
}

/** Reads the Atom feed returned by the arXiv API. */
export function parseArxivFeed(xml: string): Work[] {
  const works: Work[] = [];
  const entries = xml.split(/<entry>/i).slice(1);
  for (const raw of entries) {
    const entry = raw.split(/<\/entry>/i)[0] ?? "";
    const title = tag(entry, "title");
    if (!title || /^error$/i.test(title)) continue;
    const idUrl = tag(entry, "id") ?? "";
    const id = /abs\/(.+)$/.exec(idUrl)?.[1];
    const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/gi)].map((m) => splitName(decodeXmlEntities(m[1] ?? "")));
    const published = tag(entry, "published");
    const work: Work = { title, authors, sources: ["arxiv"], type: "preprint" };
    if (published && /^\d{4}/.test(published)) work.year = Number(published.slice(0, 4));
    if (id) {
      work.arxivId = id.replace(/v\d+$/, "");
      work.url = `https://arxiv.org/abs/${id}`;
    }
    const abstract = tag(entry, "summary");
    if (abstract) work.abstract = abstract;
    const doi = normalizeDoi(tag(entry, "arxiv:doi"));
    if (doi) work.doi = doi;
    const journalRef = tag(entry, "arxiv:journal_ref");
    if (journalRef) work.container = journalRef;
    works.push(work);
  }
  return works;
}

export interface ArxivClient {
  getById(id: string): Promise<Work | null>;
  search(query: string, max?: number): Promise<Work[]>;
}

export function createArxiv(http: Http, options: { baseUrl?: string } = {}): ArxivClient {
  const base = (options.baseUrl ?? "https://export.arxiv.org/api/query").replace(/\/+$/, "");
  return {
    async getById(id) {
      const xml = await http.text(`${base}?id_list=${encodeURIComponent(id)}&max_results=1`);
      return parseArxivFeed(xml)[0] ?? null;
    },
    async search(query, max = 5) {
      const terms = query.replace(/["():]/g, " ").split(/\s+/).filter(Boolean).slice(0, 12).join(" AND all:");
      if (!terms) return [];
      const xml = await http.text(`${base}?search_query=${encodeURIComponent(`all:${terms}`)}&max_results=${max}&sortBy=relevance`);
      return parseArxivFeed(xml);
    },
  };
}
