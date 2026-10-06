import { isAbbreviation, splitParagraphs, splitSentences, type Paragraph, type Sentence } from "../text/sentences.ts";
import { MASK_CHAR, maskProtected } from "../text/protect.ts";
import { countWords, tokenize, type Token } from "../text/tokens.ts";
import {
  COMMON_ACRONYMS,
  COMMON_MISSPELLINGS,
  CONFUSIONS,
  CONTRACTIONS,
  INFORMAL_PHRASES,
  SPELLING_VARIANTS,
  WEAK_WORDS,
  WORDY_PHRASES,
} from "./lexicons.ts";
import type { GrammarOptions, Issue, IssueCategory, IssueSource, Severity } from "./types.ts";

export interface RuleContext {
  /** The text exactly as the author wrote it. */
  text: string;
  /** Same length as `text`, with citations, maths and URLs replaced by MASK_CHAR. */
  checkText: string;
  sentences: Sentence[];
  paragraphs: Paragraph[];
  tokens: Token[];
  options: GrammarOptions;
}

export function buildContext(text: string, options: GrammarOptions = {}): RuleContext {
  const { masked: checkText } = maskProtected(text);
  return {
    text,
    checkText,
    sentences: splitSentences(checkText),
    paragraphs: splitParagraphs(checkText),
    tokens: tokenize(checkText),
    options,
  };
}

export type Rule = (ctx: RuleContext) => Issue[];

function make(
  ctx: RuleContext,
  rule: string,
  category: IssueCategory,
  severity: Severity,
  message: string,
  start: number,
  end: number,
  suggestions: string[] = [],
  source: IssueSource = "veritome",
): Issue {
  return {
    id: `${rule}:${start}-${end}`,
    rule,
    category,
    severity,
    message,
    start,
    end,
    text: ctx.text.slice(start, end),
    suggestions,
    source,
  };
}

/** Gives the replacement the same capitalisation pattern as the original. */
export function matchCase(original: string, replacement: string): string {
  if (!replacement) return replacement;
  const letters = original.replace(/[^A-Za-z]/g, "");
  if (letters.length > 1 && letters === letters.toUpperCase()) return replacement.toUpperCase();
  if (/^[A-Z]/.test(original)) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  return replacement;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function* matches(re: RegExp, text: string): Generator<RegExpExecArray> {
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) {
    if (m[0].length === 0) {
      r.lastIndex++;
      continue;
    }
    yield m;
  }
}

// ---------------------------------------------------------------------------
// Mechanics
// ---------------------------------------------------------------------------

const ALLOWED_REPEATS = new Set(["had had", "that that", "is is", "do do", "bye bye", "so so", "no no", "very very"]);

export const repeatedWord: Rule = (ctx) => {
  const out: Issue[] = [];
  for (const m of matches(/\b([\p{L}']{2,})(\s+)\1\b/giu, ctx.checkText)) {
    const pair = m[0].toLowerCase().replace(/\s+/g, " ");
    if (ALLOWED_REPEATS.has(pair)) continue;
    out.push(
      make(ctx, "repeated-word", "grammar", "error", `Repeated word: "${m[1]}".`, m.index, m.index + m[0].length, [m[1] ?? ""]),
    );
  }
  return out;
};

export const doubleSpace: Rule = (ctx) => {
  const out: Issue[] = [];
  for (const m of matches(/(?<=\S)[ \t]{2,}(?=\S)/g, ctx.checkText)) {
    out.push(make(ctx, "double-space", "punctuation", "info", "Extra space between words.", m.index, m.index + m[0].length, [" "]));
  }
  return out;
};

export const spaceBeforePunctuation: Rule = (ctx) => {
  const out: Issue[] = [];
  const re = new RegExp(`(?<=[\\p{L}\\p{N})\\]${MASK_CHAR}]) +([,;:!?]|\\.(?!\\.))(?=\\s|$)`, "gu");
  for (const m of matches(re, ctx.checkText)) {
    out.push(
      make(ctx, "space-before-punctuation", "punctuation", "warning", "No space is needed before this punctuation mark.", m.index, m.index + m[0].length, [m[1] ?? ""]),
    );
  }
  return out;
};

export const missingSpaceAfterPunctuation: Rule = (ctx) => {
  const out: Issue[] = [];
  for (const m of matches(/(?<=\p{L}{2})([,;])(?=\p{L})/gu, ctx.checkText)) {
    out.push(
      make(ctx, "missing-space-after-punctuation", "punctuation", "warning", "Add a space after the comma or semicolon.", m.index, m.index + 1, [`${m[1]} `]),
    );
  }
  for (const m of matches(/(?<=[a-z]{2})\.(?=[A-Z][a-z]{1,})/g, ctx.checkText)) {
    if (isAbbreviation(ctx.checkText.slice(Math.max(0, m.index - 4), m.index).replace(/^.*\W/, ""))) continue;
    out.push(make(ctx, "missing-space-after-punctuation", "punctuation", "warning", "Add a space after the full stop.", m.index, m.index + 1, [". "]));
  }
  return out;
};

interface BracketFrame {
  ch: string;
  pos: number;
}
const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{", "”": "“" };

export const unbalancedBrackets: Rule = (ctx) => {
  const out: Issue[] = [];
  for (const para of ctx.paragraphs) {
    // Ignore list markers such as "1)" or "a)" at the start of a line.
    const body = para.text.replace(/^[ \t]*(?:\d+|[a-zA-Z])\)/gm, (s) => " ".repeat(s.length));
    const stack: BracketFrame[] = [];
    for (let i = 0; i < body.length; i++) {
      const ch = body.charAt(i);
      if (ch === "(" || ch === "[" || ch === "{" || ch === "“") {
        stack.push({ ch, pos: i });
      } else if (ch in CLOSERS) {
        const top = stack[stack.length - 1];
        if (top && top.ch === CLOSERS[ch]) stack.pop();
        else {
          const at = para.start + i;
          out.push(make(ctx, "unbalanced-brackets", "punctuation", "warning", `Closing "${ch}" has no matching opening mark.`, at, at + 1));
        }
      }
    }
    for (const frame of stack) {
      const at = para.start + frame.pos;
      out.push(make(ctx, "unbalanced-brackets", "punctuation", "warning", `Opening "${frame.ch}" is never closed.`, at, at + 1));
    }
    const straight = [...body.matchAll(/"/g)];
    if (straight.length % 2 === 1) {
      const last = straight[straight.length - 1];
      if (last?.index !== undefined) {
        const at = para.start + last.index;
        out.push(make(ctx, "unbalanced-quotes", "punctuation", "warning", "Quotation marks do not pair up in this paragraph.", at, at + 1));
      }
    }
  }
  return out;
};

const STARTERS = new Set(
  "the a an this that these those it we they he she in on at however therefore moreover thus for as if when while although because our their there here such some many most all both each one two three first second finally further furthermore additionally in".split(
    " ",
  ),
);

export const lowercaseAfterPeriod: Rule = (ctx) => {
  const out: Issue[] = [];
  for (const m of matches(/([A-Za-z]{3,})([.!?])\s+([a-z][a-z']*)/g, ctx.checkText)) {
    const prev = m[1] ?? "";
    const next = m[3] ?? "";
    if (isAbbreviation(prev) || !STARTERS.has(next)) continue;
    const start = m.index + m[0].length - next.length;
    out.push(
      make(ctx, "sentence-capital", "grammar", "error", "A new sentence should start with a capital letter.", start, start + next.length, [matchCase("A", next)]),
    );
  }
  for (const para of ctx.paragraphs) {
    const first = /^[a-z][a-z']*/.exec(para.text);
    if (first && STARTERS.has(first[0])) {
      out.push(
        make(ctx, "sentence-capital", "grammar", "error", "A paragraph should start with a capital letter.", para.start, para.start + first[0].length, [matchCase("A", first[0])]),
      );
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Grammar
// ---------------------------------------------------------------------------

const AN_EXCEPTIONS = /^(hour|honest|honor|honour|heir|x-)/i;
const A_EXCEPTIONS = /^(one|once|ouija|eu|ewe|uni(?![mn])|use|usu|uti|ubiq|ukr|uran|ural|uter|urin|urol|urea)/i;
const LETTER_NAMES_WITH_VOWEL_SOUND = new Set("AEFHILMNORSX".split(""));

/** Whether the word is pronounced with a vowel sound; null when it is too ambiguous to judge. */
export function startsWithVowelSound(word: string): boolean | null {
  if (/^[A-Z]{2,}$/.test(word)) {
    if (/[AEIOU]/.test(word)) return null; // NASA vs MRI: cannot tell.
    return LETTER_NAMES_WITH_VOWEL_SOUND.has(word.charAt(0));
  }
  if (/^[A-Z]$/.test(word)) return LETTER_NAMES_WITH_VOWEL_SOUND.has(word);
  if (/\d/.test(word)) return null;
  if (AN_EXCEPTIONS.test(word)) return true;
  if (A_EXCEPTIONS.test(word)) return false;
  return /^[aeiou]/i.test(word);
}

export const articleAAn: Rule = (ctx) => {
  const out: Issue[] = [];
  for (const m of matches(/\b(a|an)(\s+)([A-Za-z][A-Za-z'-]*)/gi, ctx.checkText)) {
    const article = m[1] ?? "";
    const word = m[3] ?? "";
    if (word.length === 1 && /[a-z]/.test(word)) continue; // "a b" in maths-like text
    const vowel = startsWithVowelSound(word);
    if (vowel === null) continue;
    const wantsAn = vowel;
    const isAn = article.toLowerCase() === "an";
    if (wantsAn === isAn) continue;
    const replacement = matchCase(article, wantsAn ? "an" : "a");
    out.push(
      make(ctx, "a-an", "grammar", "error", `Use "${replacement}" before "${word}".`, m.index, m.index + article.length, [replacement]),
    );
  }
  return out;
};

const confusionRules = CONFUSIONS.map(([re, replacement, message]) => ({ re, replacement, message }));

export const confusedWords: Rule = (ctx) => {
  const out: Issue[] = [];
  for (const { re, replacement, message } of confusionRules) {
    const single = new RegExp(re.source, re.flags.replace("g", ""));
    for (const m of matches(re, ctx.checkText)) {
      const fixed = matchCase(m[0], m[0].replace(single, replacement));
      out.push(make(ctx, "confused-words", "grammar", "error", message, m.index, m.index + m[0].length, [fixed]));
    }
  }
  return out;
};

const IRREGULAR_PARTICIPLES =
  "known|shown|made|done|seen|given|taken|found|built|held|kept|led|chosen|drawn|written|set|put|run|become|begun|brought|bought|caught|taught|sent|spent|told|understood|lost|won|paid|read|heard|met|left|shown|grown|thrown|worn|torn|broken|spoken|driven|eaten|fallen|forgotten|hidden|ridden|risen|stolen";
const ADVERBS = "not|also|often|then|thus|further|subsequently|previously|already|still|always|never|usually|typically|generally|commonly|widely|currently|recently|\\w+ly";
const PASSIVE_RE = new RegExp(
  `\\b(?:am|is|are|was|were|be|been|being)\\s+(?:(?:${ADVERBS})\\s+)?((?:\\w{3,}ed|${IRREGULAR_PARTICIPLES}))\\b`,
  "gi",
);

/** First passive construction in a piece of text, or null. */
export function findPassive(text: string): { start: number; end: number; text: string } | null {
  PASSIVE_RE.lastIndex = 0;
  const m = PASSIVE_RE.exec(text);
  return m ? { start: m.index, end: m.index + m[0].length, text: m[0] } : null;
}

export function passiveSentenceRatio(sentences: readonly Sentence[]): number {
  if (sentences.length === 0) return 0;
  return sentences.filter((s) => findPassive(s.text) !== null).length / sentences.length;
}

export const passiveOveruse: Rule = (ctx) => {
  if (ctx.sentences.length < 5 || passiveSentenceRatio(ctx.sentences) <= 0.4) return [];
  const out: Issue[] = [];
  for (const s of ctx.sentences) {
    const hit = findPassive(s.text);
    if (!hit) continue;
    out.push(
      make(
        ctx,
        "passive-voice",
        "style",
        "info",
        "Passive voice. A large share of this text is passive; prefer active voice where the actor matters.",
        s.start + hit.start,
        s.start + hit.end,
      ),
    );
  }
  return out;
};

export const contractions: Rule = (ctx) => {
  const out: Issue[] = [];
  for (const m of matches(/\b[A-Za-z]+(?:n['’]t|['’](?:re|ve|ll|d|m|s))\b/g, ctx.checkText)) {
    const key = m[0].toLowerCase().replace(/’/g, "'");
    const expansion = CONTRACTIONS[key];
    if (!expansion) continue;
    out.push(
      make(ctx, "contraction", "academic", "info", "Contractions are usually avoided in formal academic writing.", m.index, m.index + m[0].length, [matchCase(m[0], expansion)]),
    );
  }
  return out;
};

// ---------------------------------------------------------------------------
// Clarity and style
// ---------------------------------------------------------------------------

const wordyRe = new RegExp(
  `\\b(?:${[...WORDY_PHRASES]
    .sort((a, b) => b[0].length - a[0].length)
    .map(([p]) => escapeRegExp(p).replace(/\s+/g, "\\s+"))
    .join("|")})\\b`,
  "gi",
);
const wordyMap = new Map(WORDY_PHRASES.map(([p, r]) => [p, r]));

export const wordyPhrases: Rule = (ctx) => {
  const out: Issue[] = [];
  for (const m of matches(wordyRe, ctx.checkText)) {
    const key = m[0].toLowerCase().replace(/\s+/g, " ");
    const replacement = wordyMap.get(key);
    if (replacement === undefined) continue;
    const message = replacement
      ? `Wordy: "${m[0]}" can usually be "${replacement}".`
      : `"${m[0]}" can usually be cut without losing meaning.`;
    out.push(
      make(ctx, "wordy-phrase", "clarity", "info", message, m.index, m.index + m[0].length, replacement ? [matchCase(m[0], replacement)] : []),
    );
  }
  return out;
};

const informalRe = new RegExp(
  `\\b(?:${[...INFORMAL_PHRASES]
    .sort((a, b) => b[0].length - a[0].length)
    .map(([p]) => escapeRegExp(p).replace(/\s+/g, "\\s+"))
    .join("|")})\\b`,
  "gi",
);
const informalMap = new Map(INFORMAL_PHRASES.map(([p, r]) => [p, r]));

export const informalWording: Rule = (ctx) => {
  const out: Issue[] = [];
  for (const m of matches(informalRe, ctx.checkText)) {
    const key = m[0].toLowerCase().replace(/\s+/g, " ");
    const options = informalMap.get(key) ?? [];
    out.push(
      make(ctx, "informal-wording", "academic", "info", `"${m[0]}" is informal for academic writing.`, m.index, m.index + m[0].length, options.map((o) => matchCase(m[0], o))),
    );
  }
  return out;
};

const weakRe = new RegExp(`\\b(?:${WEAK_WORDS.join("|")})\\b`, "gi");

export const weakWords: Rule = (ctx) => {
  const out: Issue[] = [];
  for (const m of matches(weakRe, ctx.checkText)) {
    out.push(
      make(ctx, "weak-word", "style", "info", `"${m[0]}" rarely adds meaning; consider a more precise word or cutting it.`, m.index, m.index + m[0].length),
    );
  }
  return out;
};

export const longSentences: Rule = (ctx) => {
  const limit = ctx.options.longSentenceWords ?? 40;
  const out: Issue[] = [];
  for (const s of ctx.sentences) {
    const n = countWords(s.text);
    if (n <= limit) continue;
    out.push(
      make(
        ctx,
        "long-sentence",
        "clarity",
        n > limit * 1.5 ? "error" : "warning",
        `Very long sentence (${n} words). Consider splitting it.`,
        s.start,
        s.end,
      ),
    );
  }
  return out;
};

export const repeatedSentenceStart: Rule = (ctx) => {
  const out: Issue[] = [];
  for (const para of ctx.paragraphs) {
    const inPara = ctx.sentences.filter((s) => s.start >= para.start && s.end <= para.end);
    let runWord = "";
    let run = 0;
    for (const s of inPara) {
      const first = /^[\p{L}']+/u.exec(s.text)?.[0]?.toLowerCase() ?? "";
      if (first && first === runWord) run++;
      else {
        runWord = first;
        run = 1;
      }
      if (first && run === 3) {
        const len = first.length;
        out.push(
          make(ctx, "repeated-sentence-start", "style", "info", `Three sentences in a row start with "${first}". Vary the openings.`, s.start, s.start + len),
        );
      }
    }
  }
  return out;
};

export const numberAtStart: Rule = (ctx) => {
  const out: Issue[] = [];
  for (const s of ctx.sentences) {
    const m = /^\d+(?:[.,]\d+)?(?![\d.]*\s*[.)])/.exec(s.text);
    if (!m || countWords(s.text) < 5) continue;
    out.push(
      make(ctx, "number-at-start", "academic", "info", "Avoid starting a sentence with a numeral; reword or spell it out.", s.start, s.start + m[0].length),
    );
  }
  return out;
};

// ---------------------------------------------------------------------------
// Consistency
// ---------------------------------------------------------------------------

export const mixedSpellingVariety: Rule = (ctx) => {
  const uk: Token[] = [];
  const us: Token[] = [];
  for (const t of ctx.tokens) {
    if (SPELLING_VARIANTS.uk.has(t.word)) uk.push(t);
    else if (SPELLING_VARIANTS.us.has(t.word)) us.push(t);
  }
  if (uk.length === 0 || us.length === 0) return [];
  const flagUk = uk.length <= us.length;
  const minority = flagUk ? uk : us;
  const map = flagUk ? SPELLING_VARIANTS.uk : SPELLING_VARIANTS.us;
  const majorityName = flagUk ? "American" : "British";
  return minority.map((t) => {
    const target = map.get(t.word) ?? "";
    return make(
      ctx,
      "mixed-spelling-variety",
      "consistency",
      "warning",
      `Mixed British and American spelling. The rest of the text is mostly ${majorityName}.`,
      t.start,
      t.end,
      [matchCase(t.raw, target)],
    );
  });
};

export const acronymDefinitions: Rule = (ctx) => {
  const occurrences = new Map<string, Token[]>();
  for (const t of ctx.tokens) {
    if (!/^[A-Z]{2,6}s?$/.test(t.raw)) continue;
    const base = t.raw.replace(/s$/, "");
    if (/^[IVXLCDM]+$/.test(base) || COMMON_ACRONYMS.has(base)) continue;
    const list = occurrences.get(base) ?? [];
    list.push(t);
    occurrences.set(base, list);
  }
  const out: Issue[] = [];
  for (const [base, list] of occurrences) {
    const first = list[0];
    if (!first) continue;
    const def = new RegExp(`\\(\\s*${base}s?\\s*\\)`).exec(ctx.checkText);
    if (!def) {
      if (list.length >= 2) {
        out.push(
          make(ctx, "undefined-acronym", "academic", "info", `"${base}" is used ${list.length} times but never defined. Spell it out on first use.`, first.start, first.end),
        );
      }
    } else if (def.index > first.start) {
      out.push(
        make(ctx, "acronym-before-definition", "academic", "info", `"${base}" is used before it is defined.`, first.start, first.end),
      );
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Spelling
// ---------------------------------------------------------------------------

export const spelling: Rule = (ctx) => {
  const out: Issue[] = [];
  const ignore = new Set((ctx.options.ignoreWords ?? []).map((w) => w.toLowerCase()));
  const autoIgnore = ctx.options.autoIgnoreRepeated ?? 3;
  const freq = new Map<string, number>();
  for (const t of ctx.tokens) freq.set(t.word, (freq.get(t.word) ?? 0) + 1);
  const sentenceStarts = new Set(ctx.sentences.map((s) => s.start));
  const checker = ctx.options.spellChecker;

  for (const t of ctx.tokens) {
    const raw = t.raw;
    if (raw.length < 3 || /\d/.test(raw)) continue;
    if (/^[A-Z]+s?$/.test(raw)) continue; // acronyms
    if (/[a-z][A-Z]/.test(raw)) continue; // camelCase, mRNA
    if (ignore.has(t.word)) continue;

    const known = COMMON_MISSPELLINGS[t.word];
    if (known) {
      out.push(make(ctx, "spelling", "spelling", "error", `Possible misspelling of "${known}".`, t.start, t.end, [matchCase(raw, known)], "spelling"));
      continue;
    }
    if (!checker) continue;
    if (/^[A-Z]/.test(raw) && !sentenceStarts.has(t.start)) continue; // probable proper noun
    if (autoIgnore > 0 && (freq.get(t.word) ?? 0) >= autoIgnore) continue;

    const parts = raw.split("-").filter((p) => p.length >= 3);
    const stem = raw.replace(/['’]s$/i, "");
    const candidates = parts.length > 1 ? parts : [stem];
    const bad = candidates.find((p) => !checker.isCorrect(p) && !checker.isCorrect(p.toLowerCase()));
    if (!bad) continue;
    const suggestions = checker
      .suggest(bad)
      .slice(0, 5)
      .map((s) => matchCase(bad, s));
    out.push(make(ctx, "spelling", "spelling", "error", `"${bad}" may be misspelled.`, t.start, t.end, suggestions, "spelling"));
  }
  return out;
};

export const ALL_RULES: Record<string, Rule> = {
  "repeated-word": repeatedWord,
  "double-space": doubleSpace,
  "space-before-punctuation": spaceBeforePunctuation,
  "missing-space-after-punctuation": missingSpaceAfterPunctuation,
  "unbalanced-brackets": unbalancedBrackets,
  "sentence-capital": lowercaseAfterPeriod,
  "a-an": articleAAn,
  "confused-words": confusedWords,
  "passive-voice": passiveOveruse,
  contraction: contractions,
  "wordy-phrase": wordyPhrases,
  "informal-wording": informalWording,
  "weak-word": weakWords,
  "long-sentence": longSentences,
  "repeated-sentence-start": repeatedSentenceStart,
  "number-at-start": numberAtStart,
  "mixed-spelling-variety": mixedSpellingVariety,
  "undefined-acronym": acronymDefinitions,
  spelling,
};

