import type { Span } from "./sentences.ts";

export type ProtectedKind = "math" | "latex" | "url" | "doi" | "cite" | "ref" | "quote" | "keep";

export interface ProtectedSpan extends Span {
  id: number;
  kind: ProtectedKind;
  text: string;
}

export interface ProtectResult {
  masked: string;
  spans: ProtectedSpan[];
}

export interface ProtectOptions {
  /** Also protect long quotations (default false). */
  quotes?: boolean;
  /** Words or phrases the author wants kept exactly (matched whole, ignoring case). */
  keep?: readonly string[];
}

const NAME = "[A-Z][\\p{L}'’\\-]+";

const PATTERNS: Array<{ kind: ProtectedKind; re: RegExp }> = [
  { kind: "math", re: /\$\$[\s\S]+?\$\$/g },
  { kind: "math", re: /\\\[[\s\S]+?\\\]/g },
  { kind: "math", re: /\\\([\s\S]+?\\\)/g },
  { kind: "math", re: /\$[^$\n]{1,200}\$/g },
  { kind: "latex", re: /\\(?:cite[a-z]*|ref|eqref|autoref|cref|label|footnote)\*?(?:\[[^\]]*\])*\{[^}]*\}/g },
  { kind: "url", re: /https?:\/\/[^\s)>\]}"']+/g },
  { kind: "doi", re: /\b10\.\d{4,9}\/[^\s"<>)\]]+/g },
  { kind: "cite", re: /\[\d+(?:\s*[,;–\-]\s*\d+)*\]/g },
  {
    kind: "cite",
    re: new RegExp(
      `\\((?:(?:see|e\\.g\\.,?|cf\\.|also|but see)\\s+)?${NAME}[^()]{0,200}?\\b(?:19|20)\\d{2}[a-z]?(?:[;,][^()]*)?\\)`,
      "gu",
    ),
  },
  {
    kind: "cite",
    re: new RegExp(
      `\\b${NAME}(?:\\s+(?:and|&)\\s+${NAME}|\\s+et\\s+al\\.?)?\\s*\\((?:19|20)\\d{2}[a-z]?(?:,\\s*p+\\.\\s*\\d+(?:\\s*[–-]\\s*\\d+)?)?\\)`,
      "gu",
    ),
  },
  {
    kind: "ref",
    re: /\b(?:Fig(?:ure)?s?\.?|Tables?|Eq(?:uation)?s?\.?|Sections?|Sec\.|Appendix|Algorithm|Theorem|Lemma|Proposition)\s+[A-Z]?\d+(?:\.\d+)*[a-z]?(?:\s*[–-]\s*\d+)?/g,
  },
];

const QUOTE_PATTERN = /(["“])[^"“”\n]{40,2000}?(["”])/g;

interface RawMatch extends Span {
  kind: ProtectedKind;
}

function collect(text: string, options: ProtectOptions): RawMatch[] {
  const matches: RawMatch[] = [];
  const patterns = options.quotes ? [...PATTERNS, { kind: "quote" as const, re: QUOTE_PATTERN }] : [...PATTERNS];
  for (const term of options.keep ?? []) {
    const t = term.trim();
    if (!t) continue;
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    patterns.push({ kind: "keep", re: new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "giu") });
  }
  for (const { kind, re } of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      matches.push({ kind, start: m.index, end: m.index + m[0].length });
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: RawMatch[] = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start < lastEnd) continue;
    kept.push(m);
    lastEnd = m.end;
  }
  return kept;
}

export function placeholder(id: number): string {
  return `{{P${id}}}`;
}

/** Replaces citations, maths, URLs and cross-references with opaque placeholders. */
export function protect(text: string, options: ProtectOptions = {}): ProtectResult {
  const raw = collect(text, options);
  const spans: ProtectedSpan[] = [];
  let masked = "";
  let cursor = 0;
  raw.forEach((m, i) => {
    const id = i + 1;
    masked += text.slice(cursor, m.start) + placeholder(id);
    spans.push({ id, kind: m.kind, start: m.start, end: m.end, text: text.slice(m.start, m.end) });
    cursor = m.end;
  });
  masked += text.slice(cursor);
  return { masked, spans };
}

export interface RestoreResult {
  text: string;
  /** Placeholder ids that were in the input but are absent from the output. */
  missing: number[];
  /** Placeholder ids that appear more than once. */
  duplicated: number[];
  /** Placeholder-looking tokens whose id was never issued. */
  unknown: number[];
  ok: boolean;
}

const PLACEHOLDER_RE = /\{\{\s*P(\d+)\s*\}\}/g;

/** Puts the original text back. Tolerates stray spaces inside the braces. */
export function restore(output: string, spans: readonly ProtectedSpan[]): RestoreResult {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const seen = new Map<number, number>();
  const unknown = new Set<number>();
  PLACEHOLDER_RE.lastIndex = 0;
  const text = output.replace(PLACEHOLDER_RE, (_whole, idStr: string) => {
    const id = Number(idStr);
    const span = byId.get(id);
    if (!span) {
      unknown.add(id);
      return "";
    }
    seen.set(id, (seen.get(id) ?? 0) + 1);
    return span.text;
  });
  const missing = spans.filter((s) => !seen.has(s.id)).map((s) => s.id);
  const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  return {
    text,
    missing,
    duplicated,
    unknown: [...unknown],
    ok: missing.length === 0 && duplicated.length === 0 && unknown.size === 0,
  };
}

const NUMBER_RE = /(?<![\p{L}\d])[-−+]?\d+(?:[.,]\d+)*(?:[eE][-+]?\d+)?/gu;

/** Numeric tokens in order of appearance, used to check a rewrite did not change data. */
export function numberTokens(text: string): string[] {
  const out: string[] = [];
  NUMBER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMBER_RE.exec(text)) !== null) out.push(m[0].replace("−", "-"));
  return out;
}

export interface NumberCheck {
  ok: boolean;
  missing: string[];
  added: string[];
}

/** Compares numbers as multisets so reordering is allowed but changes are not. */
export function checkNumbersPreserved(original: string, rewritten: string): NumberCheck {
  const count = (xs: string[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const a = count(numberTokens(original));
  const b = count(numberTokens(rewritten));
  const missing: string[] = [];
  const added: string[] = [];
  for (const [k, n] of a) for (let i = 0; i < n - (b.get(k) ?? 0); i++) missing.push(k);
  for (const [k, n] of b) for (let i = 0; i < n - (a.get(k) ?? 0); i++) added.push(k);
  return { ok: missing.length === 0 && added.length === 0, missing, added };
}

/** Stand-in for protected text so offsets stay aligned but nothing inside is analysed. */
export const MASK_CHAR = "\u0001";

/**
 * Replaces citations, maths, URLs and cross-references with MASK_CHAR, one per
 * character, so the result has exactly the same length and offsets as the input.
 */
export function maskProtected(text: string, options: ProtectOptions = {}): { masked: string; spans: ProtectedSpan[] } {
  const { spans } = protect(text, options);
  let masked = text;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    masked = masked.slice(0, span.start) + MASK_CHAR.repeat(span.end - span.start) + masked.slice(span.end);
  }
  return { masked, spans };
}
