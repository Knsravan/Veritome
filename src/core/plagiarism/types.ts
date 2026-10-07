import type { TrickFlag } from "../integrity/tricks.ts";
import type { TorturedPhrase } from "../integrity/tortured.ts";
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
  /** Where the full text came from, when the whole paper (not only its abstract) was compared. */
  fullText?: string;
  /** Words of the checked text that this source shares. */
  matchedWords: number;
  /** Share of the checked text, 0 to 100. */
  percent: number;
  /** Words credited to this source as the best match for a passage. Each matched word is credited to one source only. */
  primaryWords: number;
  /** primaryWords as a share of the checked text; these add up to the overall similarity. */
  primaryPercent: number;
}

export interface MatchedSpan {
  /** Character offsets in the checked body text. */
  start: number;
  end: number;
  words: number;
  text: string;
  /** Ids of sources containing this passage, best first. The first is the source the passage is credited to. */
  sourceIds: string[];
  /** Whether an in-text citation appears in the same sentence(s). */
  cited: boolean;
  /** The citation found, such as "(He et al., 2016)" or "[3]". */
  citation?: string;
  /** The matching wording in the credited source, with a little context, for a side-by-side view. */
  sourceExcerpt?: SourceExcerpt;
}

export interface SourceExcerpt {
  text: string;
  /** Offsets of the shared wording inside `text`. */
  matchStart: number;
  matchEnd: number;
}

/** A quotation in the text. Quotations are left out of the similarity score but still need a citation. */
export interface QuotedPassage {
  start: number;
  end: number;
  text: string;
  cited: boolean;
}

export interface ProviderStat {
  name: string;
  kind: "scholarly" | "web" | "library" | "self" | "own";
  coverage: string;
  queries: number;
  failures: number;
  /** Queries not sent because the service's rate limit allowance for this check was used up. */
  skipped?: number;
  documents: number;
}

export type PlagiarismVerdict = "low" | "moderate" | "high";

/** A sentence that rewords a source sentence (synonyms, reordering) rather than copying it. */
export interface ParaphraseSpan {
  start: number;
  end: number;
  text: string;
  sourceId: string;
  sourceText: string;
  /** 0 to 1 concept overlap with the source sentence. */
  similarity: number;
  /** Whether an in-text citation appears in the same sentence. */
  cited: boolean;
}

export interface PlagiarismReport {
  /** Share of words covered by at least one match, 0 to 100. */
  similarity: number;
  verdict: PlagiarismVerdict;
  words: number;
  matchedWords: number;
  spans: MatchedSpan[];
  /** Reworded sentences, reported separately and not counted in `similarity`. */
  paraphrases: ParaphraseSpan[];
  /** Share of words in reworded sentences, 0 to 100. */
  paraphrasePercent: number;
  sources: MatchedSource[];
  /** Quotations found in the text (left out of the score). */
  quotes: QuotedPassage[];
  /** The parts of the text used as search queries, so readers can see what was checked online. */
  searched: Array<{ start: number; end: number }>;
  providers: ProviderStat[];
  /** The author whose earlier papers were compared, for the self-plagiarism check. */
  ownAuthor?: import("./ownwork.ts").OwnAuthor;
  /** Sentences translated from English sources, for papers not written in English. */
  translated?: import("./translated.ts").TranslatedMatch[];
  /** The paper's language when it is not English, and whether the translated check ran. */
  language?: { name: string; translatedCheck: boolean };
  /** Disguised text: look-alike letters, invisible characters, odd spaces, hidden text. */
  disguises?: TrickFlag[];
  /** Phrases typical of synonym-swapping paraphrasing tools, such as "counterfeit consciousness". */
  tortured?: TorturedPhrase[];
  excluded: { references: boolean; quotes: boolean; referenceWords: number };
  warnings: string[];
  disclaimer: string;
}
