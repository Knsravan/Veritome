import type { Http } from "../infra/http.ts";
import { stripMarkup, type SourceDoc } from "./providers.ts";

/**
 * Fetches the free full text of a matched paper, so it is compared with the whole paper rather than only the
 * title and abstract the search returned. Tries, in order: the arXiv PDF, PubMed Central (via Europe PMC), and
 * the open-access PDF OpenAlex knows of.
 */
export interface FullTextDeps {
  http: Http;
  /** Downloads a PDF (with SSRF and size checks) and returns its text. */
  pdfText: (url: string, signal?: AbortSignal) => Promise<string>;
  epmcBase?: string;
  openalexBase?: string;
  /** Sent to OpenAlex as a header, never in the URL. */
  openAlexKey?: string;
  mailto?: string;
}

export const FULL_TEXT_LIMIT = 400_000;

function arxivId(doc: Pick<SourceDoc, "id" | "url" | "doi">): string | undefined {
  const fromDoi = doc.doi?.match(/^10\.48550\/arxiv\.(.+)$/i)?.[1];
  if (fromDoi) return fromDoi;
  const m = `${doc.id} ${doc.url ?? ""}`.match(/arxiv\.org\/(?:abs|pdf)\/([\w.\/-]+?)(?:v\d+)?(?:\.pdf)?(?:\s|$)|^arxiv:([\w.\/-]+)/i);
  return m?.[1] ?? m?.[2];
}

export async function fetchFullText(doc: Pick<SourceDoc, "id" | "url" | "doi">, deps: FullTextDeps, signal?: AbortSignal): Promise<{ text: string; via: string } | null> {
  const ok = (t: string | undefined, via: string) => (t && t.length > 2000 ? { text: t.slice(0, FULL_TEXT_LIMIT), via } : null);
  const ax = arxivId(doc);
  if (ax) {
    try {
      const r = ok(await deps.pdfText(`https://arxiv.org/pdf/${ax}`, signal), "arXiv");
      if (r) return r;
    } catch {
      // Try the next route.
    }
  }
  const doi = doc.doi ?? doc.id.match(/^doi:(.+)$/)?.[1];
  if (!doi) return null;
  const epmc = deps.epmcBase ?? "https://www.ebi.ac.uk/europepmc/webservices/rest";
  try {
    const found = await deps.http.json<{ resultList?: { result?: Array<{ pmcid?: string; isOpenAccess?: string; inEPMC?: string }> } }>(
      `${epmc}/search?query=${encodeURIComponent(`DOI:"${doi}"`)}&format=json&resultType=lite&pageSize=1`,
      signal ? { signal } : {},
    );
    const r = found.resultList?.result?.[0];
    if (r?.pmcid && r.isOpenAccess === "Y" && r.inEPMC === "Y") {
      const xml = await deps.http.text(`${epmc}/${encodeURIComponent(r.pmcid)}/fullTextXML`, { timeoutMs: 20_000, retries: 0, ...(signal ? { signal } : {}) });
      const out = ok(stripMarkup(xml), "PubMed Central");
      if (out) return out;
    }
  } catch {
    // Try the next route.
  }
  try {
    const base = (deps.openalexBase ?? "https://api.openalex.org").replace(/\/+$/, "");
    const work = await deps.http.json<{ best_oa_location?: { pdf_url?: string | null } | null; oa_locations?: Array<{ pdf_url?: string | null }> }>(
      `${base}/works/doi:${encodeURIComponent(doi)}?select=best_oa_location,oa_locations${deps.mailto ? `&mailto=${encodeURIComponent(deps.mailto)}` : ""}`,
      { ...(deps.openAlexKey ? { headers: { authorization: `Bearer ${deps.openAlexKey}` } } : {}), ...(signal ? { signal } : {}) },
    );
    const urls = [work.best_oa_location?.pdf_url, ...(work.oa_locations ?? []).map((l) => l.pdf_url)].filter((u): u is string => Boolean(u) && /^https?:\/\//.test(u!));
    for (const u of [...new Set(urls)].slice(0, 2)) {
      try {
        const out = ok(await deps.pdfText(u, signal), "open-access PDF");
        if (out) return out;
      } catch {
        // Next location.
      }
    }
  } catch {
    // No open copy known.
  }
  return null;
}
