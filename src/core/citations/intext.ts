import type { ParsedReference } from "./types.ts";

export interface InTextCitation {
  raw: string;
  start: number;
  end: number;
  kind: "numeric" | "author-year";
  /** Reference numbers for numeric citations, ranges expanded. */
  numbers?: number[];
  /** Leading surname (or organisation) for author-year citations. */
  surname?: string;
  year?: number;
  yearSuffix?: string;
}

const NAME = "[\\p{Lu}][\\p{L}'’\\-]+";
const NAME_GROUP = `(?:(?:van|von|de|der|den|di|da|del|la|le|bin|al|el|ter|ten|du)\\s+)*${NAME}(?:\\s+${NAME})*`;

const NUMERIC_RE = /\[(\d{1,3}(?:\s*[,;–\-]\s*\d{1,3})*)\]/g;
const PAREN_RE = /\(([^()]{3,300})\)/g;
const NARRATIVE_RE = new RegExp(
  `(${NAME_GROUP})(?:\\s+(?:and|&)\\s+${NAME}|\\s+et\\s+al\\.?)?\\s*\\(((?:19|20)\\d{2})([a-z])?(?:,\\s*p+\\.\\s*[\\d–-]+)?\\)`,
  "gu",
);
const PART_RE = new RegExp(
  `^(?:(?:see|e\\.g\\.,?|cf\\.|also|but see|compare)\\s+)?(${NAME_GROUP})(?:\\s*(?:,|and|&)\\s*${NAME_GROUP})*?(?:\\s+et\\s+al\\.?)?,?\\s*((?:19|20)\\d{2})([a-z])?`,
  "u",
);

export function expandNumbers(spec: string): number[] {
  const out: number[] = [];
  for (const piece of spec.split(/[,;]/)) {
    const range = /^\s*(\d+)\s*[–-]\s*(\d+)\s*$/.exec(piece);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (b >= a && b - a <= 60) for (let n = a; n <= b; n++) out.push(n);
      else out.push(a, b);
    } else {
      const n = Number(piece.trim());
      if (Number.isFinite(n) && piece.trim() !== "") out.push(n);
    }
  }
  return out;
}

/** Finds numeric ([3], [1–4]) and author-year ((Smith, 2020), Smith et al. (2020)) citations. */
export function findInTextCitations(body: string): InTextCitation[] {
  const found: InTextCitation[] = [];

  for (const m of body.matchAll(NUMERIC_RE)) {
    found.push({ raw: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, kind: "numeric", numbers: expandNumbers(m[1] ?? "") });
  }

  for (const m of body.matchAll(PAREN_RE)) {
    const inner = m[1] ?? "";
    if (!/(?:19|20)\d{2}/.test(inner)) continue;
    const base = (m.index ?? 0) + 1;
    let offset = 0;
    for (const part of inner.split(";")) {
      const trimmed = part.replace(/^\s+/, "");
      const lead = part.length - trimmed.length;
      const pm = PART_RE.exec(trimmed);
      if (pm?.[1] && pm[2]) {
        const start = base + offset + lead;
        found.push({
          raw: trimmed.trim(),
          start,
          end: start + trimmed.trimEnd().length,
          kind: "author-year",
          surname: pm[1].trim(),
          year: Number(pm[2]),
          ...(pm[3] ? { yearSuffix: pm[3] } : {}),
        });
      }
      offset += part.length + 1;
    }
  }

  const covered = found.filter((f) => f.kind === "author-year");
  for (const m of body.matchAll(NARRATIVE_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (covered.some((c) => c.start < end && start < c.end)) continue;
    // Sentence-initial capitalised words such as "In (2020)" are not names.
    if (/^(?:In|On|At|By|From|Since|During|Until|Before|After|Between|Through|Throughout|Early|Late|Mid)$/.test(m[1] ?? "")) continue;
    found.push({
      raw: m[0],
      start,
      end,
      kind: "author-year",
      surname: (m[1] ?? "").trim(),
      year: Number(m[2]),
      ...(m[3] ? { yearSuffix: m[3] } : {}),
    });
  }

  return found.sort((a, b) => a.start - b.start);
}

function ascii(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function surnameMatches(citationSurname: string, ref: ParsedReference): boolean {
  const s = ascii(citationSurname);
  return ref.authors.slice(0, 1).some((a) => {
    const f = ascii(a.family);
    return f === s || f.endsWith(` ${s}`) || s.endsWith(` ${f}`) || (a.organization === true && (f.startsWith(s) || s.startsWith(f)));
  });
}

export interface MissingCitation {
  citation: InTextCitation;
  reason: string;
}

export interface CitationCrossCheck {
  citations: InTextCitation[];
  style: "numeric" | "author-year" | "mixed" | "none";
  /** In-text citations with no matching reference-list entry. */
  citedButMissing: MissingCitation[];
  /** Reference-list entries that no in-text citation points to. */
  uncitedReferences: ParsedReference[];
  /** Numeric citations whose first appearances are not 1, 2, 3, ... */
  numbersOutOfOrder: boolean;
  warnings: string[];
}

/** Compares the citations in the body text with the entries in the reference list. */
export function crossCheckCitations(body: string, refs: readonly ParsedReference[]): CitationCrossCheck {
  const citations = findInTextCitations(body);
  const numeric = citations.filter((c) => c.kind === "numeric");
  const authorYear = citations.filter((c) => c.kind === "author-year");
  const style: CitationCrossCheck["style"] =
    numeric.length === 0 && authorYear.length === 0 ? "none" : numeric.length > 0 && authorYear.length > 0 ? "mixed" : numeric.length > 0 ? "numeric" : "author-year";

  const citedRefs = new Set<number>();
  const missing: MissingCitation[] = [];
  const warnings: string[] = [];

  for (const c of numeric) {
    for (const n of c.numbers ?? []) {
      if (n >= 1 && n <= refs.length) citedRefs.add(n);
      else missing.push({ citation: c, reason: `Reference ${n} does not exist; the list has ${refs.length} entr${refs.length === 1 ? "y" : "ies"}.` });
    }
  }

  for (const c of authorYear) {
    const sameAuthor = refs.filter((r) => surnameMatches(c.surname ?? "", r));
    const exact = sameAuthor.filter((r) => r.year === c.year && (!c.yearSuffix || !r.yearSuffix || c.yearSuffix === r.yearSuffix));
    if (exact.length > 0) {
      for (const r of exact) citedRefs.add(r.index);
    } else if (sameAuthor.length > 0) {
      const years = sameAuthor.map((r) => r.year ?? "n.d.").join(", ");
      missing.push({ citation: c, reason: `${c.surname} (${c.year}) is cited, but the reference list has ${c.surname} for ${years}.` });
    } else {
      missing.push({ citation: c, reason: `No reference by ${c.surname} in the reference list.` });
    }
  }

  let numbersOutOfOrder = false;
  if (numeric.length >= 5) {
    const firstSeen: number[] = [];
    for (const c of numeric) for (const n of c.numbers ?? []) if (!firstSeen.includes(n)) firstSeen.push(n);
    numbersOutOfOrder = firstSeen.some((n, i) => n !== i + 1) && firstSeen.length > 2;
    if (numbersOutOfOrder) warnings.push("Numbered citations do not first appear in order 1, 2, 3, ... Check whether your style requires order of appearance.");
  }
  if (style === "mixed") warnings.push("Both numbered and author-year citations are used. Journals expect one style.");
  if (style === "none" && refs.length > 0) warnings.push("A reference list was found but no in-text citations were recognised.");
  if (refs.length === 0 && citations.length > 0) warnings.push("In-text citations were found but no reference list could be read.");

  return {
    citations,
    style,
    citedButMissing: missing,
    uncitedReferences: refs.filter((r) => !citedRefs.has(r.index)),
    numbersOutOfOrder,
    warnings,
  };
}
