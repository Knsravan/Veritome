import type { Http } from "../infra/http.ts";

/** A figure published in a matched source, with a URL to its image. */
export interface SourceFigure {
  label: string;
  caption: string;
  url: string;
}

export interface FigureQuery {
  /** The matched source's id, such as "doi:10.1/x" or "wikipedia:123". */
  id: string;
  doi?: string;
}

/** Hosts that figure images may be fetched from (by the image proxy too). */
export const FIGURE_HOSTS = ["pmc.ncbi.nlm.nih.gov", "upload.wikimedia.org"] as const;

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x?[0-9a-f]+;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** Figures in a PubMed Central open-access article, from its JATS XML. */
export function figuresFromJats(xml: string, pmcid: string): SourceFigure[] {
  const num = pmcid.replace(/^PMC/i, "");
  const out: SourceFigure[] = [];
  for (const m of xml.matchAll(/<fig\b[\s\S]*?<\/fig>/g)) {
    const fig = m[0];
    const href = fig.match(/<graphic\b[^>]*xlink:href="([^"]+)"/)?.[1];
    if (!href || !/^[\w.-]+$/.test(href)) continue;
    const file = /\.(jpe?g|png|gif)$/i.test(href) ? href : `${href}.jpg`;
    out.push({
      label: decode(fig.match(/<label>([\s\S]*?)<\/label>/)?.[1] ?? "Figure"),
      caption: decode(fig.match(/<caption>([\s\S]*?)<\/caption>/)?.[1] ?? "").slice(0, 300),
      url: `https://pmc.ncbi.nlm.nih.gov/articles/instance/${num}/bin/${file}`,
    });
  }
  return out.slice(0, 20);
}

/**
 * Looks up the published figures of matched sources: open-access life-science papers through Europe PMC and
 * PubMed Central, and Wikipedia articles through Wikimedia Commons. Other sources are skipped.
 */
export async function findSourceFigures(
  sources: readonly FigureQuery[],
  http: Http,
  options: { epmcBase?: string; wikiBase?: string; max?: number } = {},
): Promise<Array<{ id: string; figures: SourceFigure[] }>> {
  const epmc = options.epmcBase ?? "https://www.ebi.ac.uk/europepmc/webservices/rest";
  const wiki = options.wikiBase ?? "https://en.wikipedia.org/w/api.php";
  const out: Array<{ id: string; figures: SourceFigure[] }> = [];
  for (const s of sources.slice(0, options.max ?? 6)) {
    try {
      const wikiId = s.id.match(/^wikipedia:(\d+)$/)?.[1];
      if (wikiId) {
        const data = await http.json<{ query?: { pages?: Record<string, { title?: string; imageinfo?: Array<{ thumburl?: string; mime?: string }> }> } }>(
          `${wiki}?action=query&format=json&generator=images&gimlimit=20&pageids=${wikiId}&prop=imageinfo&iiprop=url|mime&iiurlwidth=640`,
        );
        const figures = Object.values(data.query?.pages ?? {})
          .filter((p) => /image\/(jpeg|png)/.test(p.imageinfo?.[0]?.mime ?? "") && p.imageinfo?.[0]?.thumburl?.startsWith("https://upload.wikimedia.org/"))
          .map((p) => ({ label: (p.title ?? "Image").replace(/^File:/, ""), caption: "", url: p.imageinfo![0]!.thumburl! }));
        out.push({ id: s.id, figures });
        continue;
      }
      const doi = s.doi ?? s.id.match(/^doi:(.+)$/)?.[1];
      if (!doi) continue;
      const found = await http.json<{ resultList?: { result?: Array<{ pmcid?: string; isOpenAccess?: string; inEPMC?: string }> } }>(
        `${epmc}/search?query=${encodeURIComponent(`DOI:"${doi}"`)}&format=json&resultType=lite&pageSize=1`,
      );
      const r = found.resultList?.result?.[0];
      if (!r?.pmcid || r.isOpenAccess !== "Y") continue;
      const xml = await http.text(`${epmc}/${encodeURIComponent(r.pmcid)}/fullTextXML`, { timeoutMs: 20_000, retries: 0 });
      out.push({ id: s.id, figures: figuresFromJats(xml, r.pmcid) });
    } catch {
      // A source whose figures cannot be fetched is skipped.
    }
  }
  return out;
}
