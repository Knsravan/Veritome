import type { SourceKind } from "./providers.ts";

/** A document the user supplies to compare against, such as a previous paper or a colleague's draft. */
export interface LibraryDoc {
  id: string;
  title: string;
  text: string;
  url?: string;
}

export interface MatchedSource {
  id: string;
  title: string;
  kind: SourceKind;
  provider: string;
  url?: string;
  doi?: string;
  year?: number;
  authors?: string;
  /** Words of the checked text that this source shares. */
  matchedWords: number;
  /** Share of the checked text, 0 to 100. */
  percent: number;
}

export interface MatchedSpan {
  /** Character offsets in the checked body text. */
  start: number;
  end: number;
  words: number;
  text: string;
  /** Ids of sources containing this passage, best first. */
  sourceIds: string[];
}

export interface ProviderStat {
  name: string;
  kind: "scholarly" | "web" | "library" | "self";
  coverage: string;
  queries: number;
  failures: number;
  documents: number;
}

export type PlagiarismVerdict = "low" | "moderate" | "high";

export interface PlagiarismReport {
  /** Share of words covered by at least one match, 0 to 100. */
  similarity: number;
  verdict: PlagiarismVerdict;
  words: number;
  matchedWords: number;
  spans: MatchedSpan[];
  sources: MatchedSource[];
  providers: ProviderStat[];
  excluded: { references: boolean; quotes: boolean; referenceWords: number };
  warnings: string[];
  disclaimer: string;
}
