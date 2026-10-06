import { HttpError, type Http } from "../../infra/http.ts";
import type { Author, Work } from "../types.ts";
import { normalizeDoi } from "./common.ts";

export interface DataCiteRecord {
  data?: {
    attributes?: {
      doi?: string;
      titles?: Array<{ title?: string }>;
      creators?: Array<{ name?: string; givenName?: string; familyName?: string; nameType?: string }>;
      publicationYear?: number | null;
      publisher?: string | { name?: string } | null;
      types?: { resourceTypeGeneral?: string };
      url?: string | null;
      descriptions?: Array<{ description?: string; descriptionType?: string }>;
    };
  };
}

export function mapDataCite(record: DataCiteRecord): Work | null {
  const a = record.data?.attributes;
  if (!a) return null;
  const authors: Author[] = (a.creators ?? []).map((c) =>
    c.familyName ? { family: c.familyName, ...(c.givenName ? { given: c.givenName } : {}) } : { family: c.name ?? "", organization: true },
  );
  const work: Work = {
    title: a.titles?.[0]?.title?.trim() || "(untitled)",
    authors: authors.filter((x) => x.family),
    sources: ["datacite"],
  };
  if (a.publicationYear) work.year = a.publicationYear;
  const publisher = typeof a.publisher === "string" ? a.publisher : a.publisher?.name;
  if (publisher) work.publisher = publisher;
  const doi = normalizeDoi(a.doi);
  if (doi) work.doi = doi;
  if (a.url) work.url = a.url;
  if (a.types?.resourceTypeGeneral) work.type = a.types.resourceTypeGeneral.toLowerCase();
  const abstract = a.descriptions?.find((d) => d.descriptionType === "Abstract")?.description;
  if (abstract) work.abstract = abstract;
  return work;
}

export interface DataCiteClient {
  getWork(doi: string): Promise<Work | null>;
}

/** DataCite registers DOIs for datasets, software, preprints (including arXiv) and repositories such as Zenodo. */
export function createDataCite(http: Http, options: { baseUrl?: string } = {}): DataCiteClient {
  const base = (options.baseUrl ?? "https://api.datacite.org").replace(/\/+$/, "");
  return {
    async getWork(doi) {
      try {
        return mapDataCite(await http.json<DataCiteRecord>(`${base}/dois/${encodeURIComponent(doi)}`));
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) return null;
        throw err;
      }
    },
  };
}
