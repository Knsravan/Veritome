export interface Author {
  family: string;
  given?: string;
  /** Set for institutional authors, which have no family/given split. */
  organization?: boolean;
}

export type WorkSource = "crossref" | "openalex" | "semanticscholar" | "datacite" | "arxiv" | "parsed";

export type RetractionStatus = "retracted" | "expression_of_concern" | "withdrawn" | "removed";

export interface RetractionInfo {
  status: RetractionStatus;
  noticeDoi?: string;
  date?: string;
  source: string;
}

/** One bibliographic item, whichever source it came from. */
export interface Work {
  title: string;
  authors: Author[];
  year?: number;
  container?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url?: string;
  publisher?: string;
  /** journal-article, proceedings-article, book, book-chapter, preprint, ... */
  type?: string;
  abstract?: string;
  citationCount?: number;
  arxivId?: string;
  retraction?: RetractionInfo;
  sources: WorkSource[];
}

export type CitationStyle = "apa" | "mla" | "ieee" | "chicago" | "harvard" | "vancouver";

export const CITATION_STYLES: ReadonlyArray<{ id: CitationStyle; label: string }> = [
  { id: "apa", label: "APA 7" },
  { id: "mla", label: "MLA 9" },
  { id: "ieee", label: "IEEE" },
  { id: "chicago", label: "Chicago (author-date)" },
  { id: "harvard", label: "Harvard" },
  { id: "vancouver", label: "Vancouver" },
];

export interface ParsedReference {
  /** 1-based position in the reference list. */
  index: number;
  raw: string;
  authors: Author[];
  year?: number;
  /** Suffix such as "a" in "2020a". */
  yearSuffix?: string;
  title?: string;
  container?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  /** 0 to 1: how many of the key fields could be read. */
  completeness: number;
}
