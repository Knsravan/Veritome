import { isAbbreviation } from "../text/sentences.ts";
import type { Author, ParsedReference } from "./types.ts";

// ---------------------------------------------------------------------------
// Splitting a reference list into entries
// ---------------------------------------------------------------------------

const BRACKET_MARKER = /^\s*\[(\d{1,3})\]\s*/;
const DOT_MARKER = /^\s*(\d{1,3})[.)]\s+(?=\S)/;
const SURNAME_START = /^\s*(?:[\p{Lu}][\p{L}'’\-]+(?:\s+[\p{Lu}][\p{L}'’\-]+)?\s*,\s*[\p{Lu}]|[\p{Lu}]\.\s*(?:[\p{Lu}]\.\s*)*[\p{Lu}][\p{L}'’\-]+|[\p{Lu}][\p{L}'’\-]+\s+[\p{Lu}]{1,3}[,.])/u;

function joinLines(lines: string[]): string {
  let out = "";
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (out.endsWith("-") && /^[a-z]/.test(t) && !/\s-$/.test(out)) out = out.slice(0, -1) + t;
    else out = out ? `${out} ${t}` : t;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Splits pasted reference-list text into one string per reference. */
export function splitReferenceList(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length === 0) return [];

  const threshold = Math.max(2, Math.floor(nonEmpty.length * 0.25));
  const byMarker = (marker: RegExp): string[] => {
    const entries: string[][] = [];
    for (const line of lines) {
      if (marker.test(line)) entries.push([line.replace(marker, "")]);
      else if (line.trim() && entries.length) (entries[entries.length - 1] as string[]).push(line);
    }
    return entries.map(joinLines).filter(Boolean);
  };

  if (nonEmpty.filter((l) => BRACKET_MARKER.test(l)).length >= threshold) return byMarker(BRACKET_MARKER);
  if (nonEmpty.filter((l) => DOT_MARKER.test(l)).length >= threshold) return byMarker(DOT_MARKER);

  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => joinLines(p.split("\n")))
    .filter(Boolean);
  if (paragraphs.length >= 2) return paragraphs;

  // One entry per line start that looks like "Surname, I." or "I. Surname".
  const entries: string[][] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (entries.length === 0 || SURNAME_START.test(line)) entries.push([line]);
    else (entries[entries.length - 1] as string[]).push(line);
  }
  return entries.map(joinLines).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Authors
// ---------------------------------------------------------------------------

const PARTICLE = "(?:(?:van|von|de|der|den|di|da|del|della|la|le|bin|ibn|al|el|ter|ten|du|dos|das|st\\.?)\\s+)*";
/** A capitalised word that contains a lower-case letter, so "JA" (initials) is never a name. */
const CAPWORD = "[\\p{Lu}][\\p{L}'’\\-]*\\p{Ll}[\\p{L}'’\\-]*";
const FAMILY = `${PARTICLE}${CAPWORD}(?:\\s+${CAPWORD})?`;
const INITIAL = "[\\p{Lu}](?:\\.|(?![\\p{L}]))";
const INITIALS = `(?:${INITIAL}(?:\\s*-\\s*${INITIAL})?\\s*)+`;
const GIVEN_FULL = `${CAPWORD}(?:\\s+(?:${CAPWORD}|[\\p{Lu}]\\.?))*`;

const SEPARATOR = /\s*(?:,\s*(?:&|and)\s+|,\s*|;\s*|\s+&\s+|\s+and\s+)/y;

function cleanGiven(g: string): string {
  return g.replace(/\s+/g, " ").trim().replace(/\s*-\s*/g, "-");
}

interface Matcher {
  re: RegExp;
  build: (m: RegExpExecArray) => Author;
  /** True when the layout carries punctuation or initials that make "this is a person" likely. */
  cue: boolean;
}

const FAMILY_FIRST: Matcher = {
  re: new RegExp(`(${FAMILY})\\s*,\\s*(${INITIALS}|${GIVEN_FULL})`, "uy"),
  build: (m) => ({ family: (m[1] ?? "").trim(), given: cleanGiven(m[2] ?? "") }),
  cue: true,
};
const INITIALS_FIRST: Matcher = {
  re: new RegExp(`(${INITIALS})\\s*(${FAMILY})`, "uy"),
  build: (m) => ({ family: (m[2] ?? "").trim(), given: cleanGiven(m[1] ?? "") }),
  cue: true,
};
const GIVEN_FIRST: Matcher = {
  re: new RegExp(`(${GIVEN_FULL})\\s+(${FAMILY})`, "uy"),
  build: (m) => ({ family: (m[2] ?? "").trim(), given: cleanGiven(m[1] ?? "") }),
  cue: false,
};
const VANCOUVER: Matcher = {
  re: new RegExp(`(${FAMILY})\\s+([\\p{Lu}]{1,4})(?![\\p{L}])`, "uy"),
  build: (m) => ({ family: (m[1] ?? "").trim(), given: (m[2] ?? "").split("").map((c) => `${c}.`).join(" ") }),
  cue: true,
};

interface ScanResult {
  authors: Author[];
  consumed: number;
  cue: boolean;
}

function scan(text: string, matchers: readonly Matcher[]): ScanResult {
  const authors: Author[] = [];
  let pos = 0;
  let consumed = 0;
  let cue = false;
  for (;;) {
    let hit: { m: RegExpExecArray; matcher: Matcher } | undefined;
    for (const matcher of matchers) {
      matcher.re.lastIndex = pos;
      const m = matcher.re.exec(text);
      if (m) {
        hit = { m, matcher };
        break;
      }
    }
    if (!hit) break;
    authors.push(hit.matcher.build(hit.m));
    if (hit.matcher.cue) cue = true;
    pos = hit.matcher.re.lastIndex;
    consumed = pos;
    SEPARATOR.lastIndex = pos;
    if (!SEPARATOR.exec(text)) break;
    pos = SEPARATOR.lastIndex;
  }
  return { authors, consumed, cue };
}

/** Tries each known name layout and keeps the one that explains the most text. */
function scanBest(text: string): ScanResult {
  const attempts = [
    scan(text, [FAMILY_FIRST, GIVEN_FIRST]),
    scan(text, [INITIALS_FIRST, GIVEN_FIRST]),
    scan(text, [VANCOUVER]),
  ];
  let best: ScanResult = { authors: [], consumed: 0, cue: false };
  for (const a of attempts) {
    if (a.authors.length === 0) continue;
    if (a.consumed > best.consumed || (a.consumed === best.consumed && a.authors.length > best.authors.length)) best = a;
  }
  return best;
}

const ORGANISATION_WORDS =
  /\b(?:organi[sz]ation|association|institute|university|society|committee|council|department|agency|commission|foundation|ministry|bureau|center|centre|group|board|academy|office|laboratory|consortium|network|union|service|company|corporation|inc|ltd|llc|press|bank)\b/i;

export interface AuthorParse {
  authors: Author[];
  truncated: boolean;
}

/** Reads an author block in APA/Chicago, IEEE, Vancouver, Harvard or MLA layout. */
export function parseAuthors(blockRaw: string): AuthorParse {
  let block = blockRaw.trim().replace(/[,;:\s]+$/, "");
  // A final period belongs to an initial ("Lee, K.") but not to a word ("Kate Lee.").
  if (/[\p{Ll}\d)]\.$/u.test(block)) block = block.slice(0, -1);
  const truncated = /\bet\s+al\.?$/i.test(block);
  block = block.replace(/,?\s*\bet\s+al\.?$/i, "").replace(/\s*\.\.\.\s*/g, ", ").trim();
  if (!block) return { authors: [], truncated };

  const hasInitialPattern = /,\s*[\p{Lu}]\./u.test(block) || /(?:^|\s)[\p{Lu}]\.\s*[\p{Lu}]/u.test(block);
  if (ORGANISATION_WORDS.test(block) && !hasInitialPattern && !/\sand\s[\p{Lu}][\p{Ll}]+\s[\p{Lu}][\p{Ll}]+$/u.test(block)) {
    return { authors: [{ family: block, organization: true }], truncated };
  }

  const best = scanBest(block);
  if (best.authors.length > 0 && best.consumed >= block.length * 0.85) return { authors: best.authors, truncated };
  if (/^[\p{Lu}][\p{L}&'’\-. ]{2,}$/u.test(block) && !/,/.test(block)) {
    return { authors: [{ family: block, organization: true }], truncated };
  }
  return { authors: best.authors, truncated };
}

/** Reads authors from the very start of an entry that has no year in parentheses and no quoted title. */
function scanAuthorPrefix(body: string): { authors: Author[]; consumed: number } | null {
  const best = scanBest(body);
  if (!best.cue || best.authors.length === 0) return null;
  return { authors: best.authors, consumed: best.consumed };
}

// ---------------------------------------------------------------------------
// One reference
// ---------------------------------------------------------------------------

const DOI_RE = /(?:doi:?\s*|https?:\/\/(?:dx\.)?doi\.org\/)?\b(10\.\d{4,9}\/[^\s"<>]+)/i;
const ARXIV_RE = /arxiv:\s*(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Za-z]{2})?\/\d{7})/i;
const QUOTE_RE = /[“"‘']([^“”"‘’']{6,}?[.,?!]?)[”"’']/u;

function trimDoi(doi: string): string {
  return doi.replace(/[.,;:)\]}>]+$/, "").toLowerCase();
}

function stripMarkup(s: string): string {
  return s.replace(/[*_]/g, "").replace(/\s+/g, " ").trim();
}

/** First sentence end that is not an abbreviation, initial or "vs.". Returns index of the period, or -1. */
function firstSentenceEnd(s: string, from = 0): number {
  const re = /\.\s+(?=[\p{Lu}*_“"‘'(\d])/gu;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const before = s.slice(0, m.index);
    const token = /(\S+)$/.exec(before)?.[1] ?? "";
    if (/^[\p{Lu}]$/u.test(token)) continue;
    if (isAbbreviation(token) || /^(vs|st|jr|sr|no)$/i.test(token)) continue;
    return m.index;
  }
  return -1;
}

interface Tail {
  container?: string;
  volume?: string;
  issue?: string;
  pages?: string;
}

function parseTail(rest: string): Tail {
  const out: Tail = {};
  let text = stripMarkup(rest).replace(/^[\s,.]+/, "").replace(/^in:?\s+/i, "");

  // Vancouver: "2020;17(3):245-53"
  const vanc = /(?:^|\s)(?:\d{4}[a-z]?);\s*(\d+)(?:\((\d+[\w-]*)\))?\s*:\s*([A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?)/.exec(text);
  if (vanc) {
    out.volume = vanc[1];
    if (vanc[2]) out.issue = vanc[2];
    out.pages = (vanc[3] ?? "").replace(/\s+/g, "");
  }

  const pp = /\bpp?\.\s*([A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?)/i.exec(text);
  if (pp && !out.pages) out.pages = (pp[1] ?? "").replace(/\s+/g, "");

  const vi = /(\d+)\s*\((\d+[\w-]*)\)/.exec(text);
  if (vi && !out.volume) {
    out.volume = vi[1];
    out.issue = vi[2];
  }
  const vol = /\bvol(?:ume)?\.?\s*(\d+)/i.exec(text);
  if (vol && !out.volume) out.volume = vol[1];
  const no = /\bno\.?\s*(\d+)/i.exec(text);
  if (no && !out.issue) out.issue = no[1];

  if (!out.pages) {
    const range = /,\s*([A-Za-z]?\d{1,6}\s*[-–]\s*[A-Za-z]?\d{1,6})(?=[.,\s]|$)/.exec(text);
    if (range && !/^(?:19|20)\d{2}$/.test((range[1] ?? "").split(/[-–]/)[0]?.trim() ?? "")) out.pages = (range[1] ?? "").replace(/\s+/g, "");
  }
  if (!out.pages) {
    const elocator = /,\s*(e\d{3,}|\d{5,8})(?=[.,\s]|$)/.exec(text);
    if (elocator) out.pages = elocator[1];
  }
  if (!out.volume) {
    const bare = /,\s*(\d{1,4})\s*,/.exec(text);
    if (bare) out.volume = bare[1];
  }

  // Container: up to the first volume/pages/year marker.
  text = text.replace(/^(?:proc\.|proceedings)\b/i, (m) => m);
  const cut = text.search(/,\s*(?:vol\.|no\.|pp?\.|\d)|\s*\(|\.\s+(?=\d{4}\b)|;\s*\d|\s+\d{4}[;.]/i);
  const container = (cut >= 0 ? text.slice(0, cut) : text).replace(/[.,;:\s]+$/, "").trim();
  if (container && container.length >= 3 && !/^\d+$/.test(container)) out.container = container;
  return out;
}

function pickYear(body: string): { year?: number; suffix?: string; parenIndex: number; parenEnd: number } {
  const paren = /\(\s*(?:n\.d\.|(\d{4})([a-z])?)\s*[,)]/.exec(body);
  if (paren) {
    const end = body.indexOf(")", paren.index);
    const year = paren[1] ? Number(paren[1]) : undefined;
    return { ...(year !== undefined ? { year } : {}), ...(paren[2] ? { suffix: paren[2] } : {}), parenIndex: paren.index, parenEnd: end + 1 };
  }
  const candidates: Array<{ year: number; suffix?: string }> = [];
  const re = /(?<![\d–-])((?:18|19|20)\d{2})([a-z])?(?![\d–-]|\))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const year = Number(m[1]);
    if (year <= new Date().getFullYear() + 1) candidates.push({ year, ...(m[2] ? { suffix: m[2] } : {}) });
  }
  const last = candidates[candidates.length - 1];
  return { ...(last ? { year: last.year, ...(last.suffix ? { suffix: last.suffix } : {}) } : {}), parenIndex: -1, parenEnd: -1 };
}

export function parseReference(rawInput: string, index: number): ParsedReference {
  const raw = rawInput.replace(/\s+/g, " ").trim().replace(BRACKET_MARKER, "").replace(DOT_MARKER, "");
  const ref: ParsedReference = { index, raw, authors: [], completeness: 0 };

  const doiMatch = DOI_RE.exec(raw);
  if (doiMatch?.[1]) ref.doi = trimDoi(doiMatch[1]);
  const arxiv = ARXIV_RE.exec(raw);
  if (arxiv?.[1]) ref.arxivId = arxiv[1];
  const urlMatch = /https?:\/\/[^\s"<>]+/.exec(raw);
  if (urlMatch && !/doi\.org\//i.test(urlMatch[0])) ref.url = urlMatch[0].replace(/[.,;)]+$/, "");

  // Work on the entry with identifiers removed so they do not pollute titles.
  let body = raw
    .replace(/(?:doi:?\s*|https?:\/\/(?:dx\.)?doi\.org\/)?\b10\.\d{4,9}\/[^\s"<>]+/gi, " ")
    .replace(/https?:\/\/[^\s"<>]+/g, " ")
    .replace(/\barxiv:\s*\S+(?:\s*\[[^\]]+\])?/gi, " ")
    .replace(/\b(?:available at|retrieved from|accessed)\b[^.]*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  body = body.replace(/[,;:\s]+$/, "");

  const { year, suffix, parenIndex, parenEnd } = pickYear(body);
  if (year !== undefined) ref.year = year;
  if (suffix) ref.yearSuffix = suffix;

  const quoted = QUOTE_RE.exec(body);

  if (parenIndex >= 0) {
    // APA, Chicago author-date, Harvard: Authors (Year). Title. Container, vol(issue), pages.
    const authorBlock = body.slice(0, parenIndex);
    ref.authors = parseAuthors(authorBlock).authors;
    let after = body.slice(parenEnd).replace(/^[\s.,:)]+/, "");
    const q = /^[“"‘']([^“”"’]{3,}?)[,.]?[”"’']/u.exec(after);
    if (q) {
      ref.title = stripMarkup(q[1] ?? "").replace(/[.,]$/, "");
      Object.assign(ref, parseTail(after.slice(q[0].length)));
    } else {
      const end = firstSentenceEnd(after);
      if (end >= 0) {
        ref.title = stripMarkup(after.slice(0, end));
        Object.assign(ref, parseTail(after.slice(end + 1)));
      } else {
        ref.title = stripMarkup(after.replace(/\.$/, ""));
      }
    }
    after = "";
  } else if (quoted && quoted.index > 0) {
    // IEEE, MLA, Chicago notes: Authors, "Title," Container, vol., pp., Year.
    ref.authors = parseAuthors(body.slice(0, quoted.index)).authors;
    ref.title = stripMarkup(quoted[1] ?? "").replace(/[.,?!]$/, (m) => (m === "?" || m === "!" ? m : ""));
    Object.assign(ref, parseTail(body.slice(quoted.index + quoted[0].length)));
  } else {
    // Vancouver and plain: Authors. Title. Container. Year;vol(issue):pages.
    const prefix = scanAuthorPrefix(body);
    if (prefix) {
      ref.authors = prefix.authors;
      const afterAuthors = body.slice(prefix.consumed).replace(/^[.,;\s]+/, "");
      const second = firstSentenceEnd(afterAuthors);
      if (second >= 0) {
        ref.title = stripMarkup(afterAuthors.slice(0, second));
        Object.assign(ref, parseTail(afterAuthors.slice(second + 1)));
      } else {
        ref.title = stripMarkup(afterAuthors.replace(/\.$/, ""));
      }
    } else {
      const first = firstSentenceEnd(body);
      if (first >= 0) {
        ref.title = stripMarkup(body.slice(0, first));
        Object.assign(ref, parseTail(body.slice(first + 1)));
      } else {
        ref.title = stripMarkup(body.replace(/\.$/, ""));
      }
    }
  }

  if (ref.title) ref.title = ref.title.replace(/^[“"‘']|[”"’']$/g, "").trim();
  if (ref.title && ref.title.length < 4) delete ref.title;

  const completeness =
    (ref.authors.length ? 0.25 : 0) + (ref.year ? 0.2 : 0) + (ref.title ? 0.3 : 0) + (ref.container ? 0.15 : 0) + (ref.doi ? 0.1 : 0);
  ref.completeness = Math.min(1, Math.round(completeness * 100) / 100);
  return ref;
}

export function parseReferenceList(text: string): ParsedReference[] {
  return splitReferenceList(text).map((raw, i) => parseReference(raw, i + 1));
}
