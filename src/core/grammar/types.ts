export type IssueCategory =
  | "spelling"
  | "grammar"
  | "punctuation"
  | "style"
  | "clarity"
  | "academic"
  | "consistency";

export type Severity = "error" | "warning" | "info";

export type IssueSource = "veritome" | "spelling" | "languagetool";

export interface Issue {
  id: string;
  rule: string;
  category: IssueCategory;
  severity: Severity;
  message: string;
  /** Offsets into the text that was checked. */
  start: number;
  end: number;
  /** The flagged text. */
  text: string;
  /** Replacement candidates. An empty string means "delete the flagged text". */
  suggestions: string[];
  source: IssueSource;
}

export interface SpellChecker {
  isCorrect(word: string): boolean;
  suggest(word: string): string[];
}

export interface GrammarOptions {
  /** Words the author wants left alone (names, jargon). Case-insensitive. */
  ignoreWords?: readonly string[];
  /** Optional dictionary. Without it only the built-in common-misspelling list is used. */
  spellChecker?: SpellChecker;
  /** Words repeated this many times are assumed to be intentional terms. Default 3, 0 disables. */
  autoIgnoreRepeated?: number;
  /** Rule ids to turn off. */
  disabledRules?: readonly string[];
  /** Maximum words in a sentence before it is flagged. Default 40. */
  longSentenceWords?: number;
}

export interface ReadabilityMetrics {
  words: number;
  sentences: number;
  avgSentenceLength: number;
  longestSentence: number;
  fleschReadingEase: number;
  fleschKincaidGrade: number;
  passiveSentenceRatio: number;
  lexicalDiversity: number;
  level: string;
}

export interface GrammarSummary {
  total: number;
  byCategory: Partial<Record<IssueCategory, number>>;
  bySeverity: Record<Severity, number>;
  issuesPer1000Words: number;
  /** 0 to 100, higher is cleaner. A rough guide, not a grade. */
  score: number;
}

export interface GrammarResult {
  issues: Issue[];
  metrics: ReadabilityMetrics;
  summary: GrammarSummary;
}
