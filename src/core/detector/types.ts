export type SignalId = "burstiness" | "lexical_diversity" | "cliches" | "transitions";

export interface DetectorSignal {
  id: SignalId;
  label: string;
  /** The measured value, in the unit described by `unit`. */
  value: number;
  unit: string;
  /** -1 (reads like typical human writing) to +1 (reads like typical model output). */
  lean: number;
  weight: number;
  /** Plain-language explanation of the value. */
  explanation: string;
}

export type SentenceLevel = "low" | "medium" | "high";

export interface SentenceScore {
  start: number;
  end: number;
  text: string;
  /** 0 to 1. Sentence scores are much noisier than the document score. */
  score: number;
  level: SentenceLevel;
  reasons: string[];
  /** Phrases inside the sentence that contributed, as offsets into the checked text. */
  highlights: Array<{ start: number; end: number; phrase: string }>;
}

export type DetectorVerdict = "insufficient_text" | "likely_human" | "uncertain" | "likely_ai";

export interface LlmOpinion {
  model: string;
  /** 0 to 1, the model's own estimate. Language models are poorly calibrated judges. */
  probability: number;
  reasons: string[];
}

export interface ModelEvidence {
  version: string;
  /** 0 to 1: the trained classifier's estimate for the whole text. */
  probability: number;
  /** Per-window estimates for long texts (offsets into the checked text). */
  windows: Array<{ start: number; end: number; probability: number }>;
  /** Per-paragraph estimates (short paragraphs joined to at least 150 words), for showing which parts read as AI. */
  segments?: Array<{ start: number; end: number; words: number; probability: number }>;
  /** Words and phrases that pushed the estimate towards model output. */
  topPhrases: Array<{ phrase: string; weight: number }>;
  thresholds: { likelyAi: number; likelyHuman: number };
  /**
   * Set when the neural models judged the document as a whole: most of its paragraphs score above the range of
   * human writing (a pattern about 1 in 100 human papers shows), so paragraphs above that range count as likely AI.
   */
  document?: { paragraphs: number; aboveHumanRange: number; share: number };
}

export interface EvasionSigns {
  /** Lookalike letters from other alphabets inside Latin words. */
  homoglyphs: number;
  /** Zero-width and other invisible characters. */
  invisible: number;
}

export interface DetectorResult {
  words: number;
  /** 0 to 100: how strongly the text shows patterns common in model output. Not a probability of authorship. */
  score: number;
  /** Plausible range for the score given text length and how much the signals agree. */
  band: { low: number; high: number };
  verdict: DetectorVerdict;
  signals: DetectorSignal[];
  sentences: SentenceScore[];
  /** Score from the four style signals alone (shown for comparison; the trained model decides). */
  statisticalScore: number;
  model: ModelEvidence;
  evasion: EvasionSigns;
  llm?: LlmOpinion;
  warnings: string[];
  disclaimer: string;
}
