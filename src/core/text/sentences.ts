export interface Span {
  start: number;
  end: number;
}

export interface Sentence extends Span {
  text: string;
}

/** Abbreviations whose trailing period does not end a sentence (lower-case, no dot). */
const NON_TERMINAL_ABBREVIATIONS = new Set([
  "e.g",
  "i.e",
  "fig",
  "figs",
  "eq",
  "eqs",
  "dr",
  "mr",
  "mrs",
  "ms",
  "prof",
  "vs",
  "no",
  "nos",
  "vol",
  "vols",
  "pp",
  "p",
  "ca",
  "cf",
  "approx",
  "sec",
  "secs",
  "ch",
  "ref",
  "refs",
  "st",
  "jr",
  "sr",
  "inc",
  "ltd",
  "co",
  "dept",
  "univ",
  "ed",
  "eds",
  "resp",
  "viz",
  "est",
  "avg",
  "max",
  "min",
]);

/** Abbreviations that may legitimately end a sentence when an upper-case word follows. */
const MAYBE_TERMINAL_ABBREVIATIONS = new Set(["etc", "al"]);

/** True for common abbreviations such as "e.g", "fig" or "et al" (case-insensitive, no trailing dot). */
export function isAbbreviation(word: string): boolean {
  const w = word.toLowerCase().replace(/\.$/, "");
  return NON_TERMINAL_ABBREVIATIONS.has(w) || MAYBE_TERMINAL_ABBREVIATIONS.has(w);
}

const BOUNDARY = /([.!?]+)(["'”’)\]]*)(\s+)/g;

function previousToken(text: string, periodIndex: number): string {
  let i = periodIndex - 1;
  while (i >= 0 && !/\s/.test(text.charAt(i))) i--;
  return text.slice(i + 1, periodIndex).replace(/^[("'“‘[]+/, "");
}

function nextVisibleChar(text: string, from: number): string {
  for (let i = from; i < text.length; i++) {
    const ch = text.charAt(i);
    if (!/\s/.test(ch)) return ch;
  }
  return "";
}

/**
 * Splits text into sentences and keeps exact character offsets into the
 * original string. Paragraph breaks (blank lines) always end a sentence.
 */
export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];

  const push = (rawStart: number, rawEnd: number) => {
    let start = rawStart;
    let end = rawEnd;
    while (start < end && /\s/.test(text.charAt(start))) start++;
    while (end > start && /\s/.test(text.charAt(end - 1))) end--;
    if (end > start) sentences.push({ text: text.slice(start, end), start, end });
  };

  // Walk paragraph by paragraph so blank lines are hard boundaries.
  const paragraphRe = /[^\n]+(?:\n(?!\s*\n)[^\n]*)*/g;
  let pm: RegExpExecArray | null;
  while ((pm = paragraphRe.exec(text)) !== null) {
    const pStart = pm.index;
    const para = pm[0];
    let cursor = 0;
    BOUNDARY.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BOUNDARY.exec(para)) !== null) {
      const terminators = m[1] ?? "";
      const closers = m[2] ?? "";
      const space = m[3] ?? "";
      const afterIdx = m.index + terminators.length + closers.length + space.length;
      const next = nextVisibleChar(para, afterIdx);
      const lastTerminator = terminators.charAt(terminators.length - 1);

      if (lastTerminator === "." && terminators.length === 1) {
        const token = previousToken(para, m.index).toLowerCase();
        const bare = token.replace(/\.$/, "");
        const isInitial = /^[A-Za-z]$/.test(previousToken(para, m.index));
        if (isInitial) continue;
        if (NON_TERMINAL_ABBREVIATIONS.has(bare) || NON_TERMINAL_ABBREVIATIONS.has(token)) continue;
        if (MAYBE_TERMINAL_ABBREVIATIONS.has(bare)) {
          if (!/[A-Z]/.test(next)) continue;
        } else if (next !== "" && /[a-z]/.test(next)) {
          continue;
        }
      } else if (next !== "" && /[a-z]/.test(next)) {
        // "?" or "!" followed by lower-case text, e.g. a mid-sentence quotation.
        continue;
      }

      push(pStart + cursor, pStart + m.index + terminators.length + closers.length);
      cursor = m.index + terminators.length + closers.length + space.length;
    }
    push(pStart + cursor, pStart + para.length);
  }
  return sentences;
}

export interface Paragraph extends Span {
  text: string;
}

/** Splits on blank lines and returns paragraphs with offsets. */
export function splitParagraphs(text: string): Paragraph[] {
  const out: Paragraph[] = [];
  const re = /[^\n]+(?:\n(?!\s*\n)[^\n]*)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const start = m.index + raw.indexOf(trimmed);
    out.push({ text: trimmed, start, end: start + trimmed.length });
  }
  return out;
}
