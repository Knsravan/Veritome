import type { Http } from "../infra/http.ts";
import { rebuildAbstract } from "../citations/sources/openalex.ts";
import type { SourceDoc } from "./providers.ts";

export interface OwnAuthor {
  name: string;
  orcid?: string;
  institution?: string;
  /** Works found for this author. */
  works: number;
  /** How many of them were compared in full text. */
  fullTexts: number;
}

export interface OwnWorkDeps {
  http: Http;
  fullText?: (doc: SourceDoc, signal?: AbortSignal) => Promise<{ text: string; via: string } | null>;
  openalexBase?: string;
  openAlexKey?: string;
  mailto?: string;
}

const ORCID = /(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i;

interface OAAuthor {
  id?: string;
  display_name?: string;
  orcid?: string | null;
  works_count?: number;
  last_known_institutions?: Array<{ display_name?: string }>;
}

interface OAWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  publication_year?: number | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: { landing_page_url?: string | null } | null;
}

/**
 * The author's own earlier papers, for a self-plagiarism (text recycling) check: found through OpenAlex by ORCID
 * iD (exact) or by name (the best-known author with that name, which is shown so the user can check it).
 */
export async function findOwnWorks(who: string, deps: OwnWorkDeps, signal?: AbortSignal, max = 40): Promise<{ author: OwnAuthor; docs: SourceDoc[] } | null> {
  const base = (deps.openalexBase ?? "https://api.openalex.org").replace(/\/+$/, "");
  const mailto = deps.mailto ? `&mailto=${encodeURIComponent(deps.mailto)}` : "";
  const req = { ...(deps.openAlexKey ? { headers: { authorization: `Bearer ${deps.openAlexKey}` } } : {}), ...(signal ? { signal } : {}) };
  const orcid = who.match(ORCID)?.[1]?.toUpperCase();
  let author: OAAuthor | undefined;
  if (orcid) author = await deps.http.json<OAAuthor>(`${base}/authors/orcid:${orcid}?select=id,display_name,orcid,works_count,last_known_institutions${mailto}`, req).catch(() => undefined);
  else {
    const name = who.replace(/[^\p{L}\p{N}' .-]+/gu, " ").trim().slice(0, 120);
    if (name.length < 3) return null;
    const res = await deps.http.json<{ results?: OAAuthor[] }>(`${base}/authors?search=${encodeURIComponent(name)}&per-page=1&select=id,display_name,orcid,works_count,last_known_institutions${mailto}`, req);
    author = res.results?.[0];
  }
  const id = author?.id?.split("/").pop();
  if (!author || !id) return null;
  const works = await deps.http.json<{ results?: OAWork[] }>(
    `${base}/works?filter=author.id:${id}&per-page=${max}&sort=publication_date:desc&select=id,doi,title,publication_year,abstract_inverted_index,primary_location${mailto}`,
    req,
  );
  const docs: SourceDoc[] = [];
  for (const w of works.results ?? []) {
    const doi = w.doi?.replace(/^https?:\/\/doi\.org\//i, "").toLowerCase();
    const title = (w.title ?? "Untitled").trim();
    const abstract = rebuildAbstract(w.abstract_inverted_index);
    const doc: SourceDoc = {
      id: doi ? `own:doi:${doi}` : `own:${w.id ?? title}`,
      title,
      text: [title, abstract].filter(Boolean).join(". "),
      provider: "Your earlier papers",
      kind: "own",
      ...(doi ? { doi, url: `https://doi.org/${doi}` } : w.primary_location?.landing_page_url ? { url: w.primary_location.landing_page_url } : {}),
      ...(w.publication_year ? { year: w.publication_year } : {}),
      authors: author.display_name ?? "",
    };
    docs.push(doc);
  }
  // The most recent few are compared in full where a free copy exists.
  let fullTexts = 0;
  if (deps.fullText)
    for (const d of docs.slice(0, 6)) {
      if (signal?.aborted) break;
      try {
        const full = await deps.fullText({ ...d, id: d.id.replace(/^own:/, "") }, signal);
        if (full) {
          d.text = full.text;
          d.fullText = full.via;
          fullTexts++;
        }
      } catch {
        // Abstract only.
      }
    }
  return {
    author: {
      name: author.display_name ?? who,
      ...(author.orcid ? { orcid: author.orcid.replace(/^https?:\/\/orcid\.org\//, "") } : {}),
      ...(author.last_known_institutions?.[0]?.display_name ? { institution: author.last_known_institutions[0].display_name } : {}),
      works: docs.length,
      fullTexts,
    },
    docs: docs.filter((d) => d.text.length > 40),
  };
}
