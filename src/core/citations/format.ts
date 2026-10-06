import type { Author, CitationStyle, Work } from "./types.ts";

/** A formatted reference as plain pieces so it can be rendered as text, Markdown or HTML. */
export type Segment = string | { italic: string };

export function renderPlain(segments: readonly Segment[]): string {
  return segments.map((s) => (typeof s === "string" ? s : s.italic)).join("");
}

export function renderMarkdown(segments: readonly Segment[]): string {
  return segments.map((s) => (typeof s === "string" ? s : `*${s.italic}*`)).join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderHtml(segments: readonly Segment[]): string {
  return segments
    .map((s) => (typeof s === "string" ? escapeHtml(s) : `<i>${escapeHtml(s.italic)}</i>`))
    .join("");
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** "John Ronald" -> ["J", "R"]; keeps hyphenated parts: "Jean-Paul" -> ["J", "P"] marked hyphenated. */
function initialsParts(given: string): string[] {
  return given
    .replace(/\./g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      part
        .split("-")
        .filter(Boolean)
        .map((p) => p.charAt(0).toUpperCase())
        .join("-"),
    );
}

/** "J. R." style (APA, IEEE, Harvard uses "J.R."). */
export function initials(given: string | undefined, spaced = true): string {
  if (!given) return "";
  const parts = initialsParts(given).map((p) => p.split("-").map((x) => `${x}.`).join("-"));
  return parts.join(spaced ? " " : "");
}

/** Vancouver style: "JR", no punctuation. */
function initialsCompact(given: string | undefined): string {
  if (!given) return "";
  return initialsParts(given)
    .map((p) => p.replace(/-/g, ""))
    .join("");
}

function familyFirst(a: Author, spacedInitials = true): string {
  if (a.organization || !a.given) return a.family;
  return `${a.family}, ${initials(a.given, spacedInitials)}`;
}

function givenFirst(a: Author): string {
  if (a.organization || !a.given) return a.family;
  return `${a.given} ${a.family}`;
}

function initialsFirst(a: Author): string {
  if (a.organization || !a.given) return a.family;
  return `${initials(a.given)} ${a.family}`;
}

function joinWithAnd(names: string[], conjunction: string, oxford: boolean): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} ${conjunction} ${names[1]}`;
  const head = names.slice(0, -1).join(", ");
  return `${head}${oxford ? "," : ""} ${conjunction} ${names[names.length - 1]}`;
}

function stripTrailingPeriod(s: string): string {
  return s.replace(/\.+$/, "");
}

function endWithPeriod(s: string): string {
  return /[.?!]$/.test(s) ? s : `${s}.`;
}

function pageRange(pages: string | undefined): string {
  return (pages ?? "").replace(/\s*[-–—]\s*/g, "–");
}

function doiUrl(work: Work): string {
  if (work.doi) return `https://doi.org/${work.doi}`;
  return work.url ?? "";
}

function isBook(work: Work): boolean {
  return work.type === "book" || (!work.container && Boolean(work.publisher) && work.type !== "journal-article");
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function apaAuthors(authors: Author[]): string {
  if (authors.length === 0) return "";
  const names = authors.map((a) => familyFirst(a));
  if (authors.length === 1) return names[0] ?? "";
  if (authors.length <= 20) return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
  return `${names.slice(0, 19).join(", ")}, . . . ${names[names.length - 1]}`;
}

function apa(work: Work): Segment[] {
  const out: Segment[] = [];
  const authors = apaAuthors(work.authors);
  const year = work.year ? `(${work.year})` : "(n.d.)";
  out.push(authors ? `${endWithPeriod(authors)} ${year}. ` : `${year}. `);
  const title = stripTrailingPeriod(work.title);
  if (isBook(work)) {
    out.push({ italic: title }, ". ");
    if (work.publisher) out.push(`${endWithPeriod(work.publisher)} `);
  } else {
    out.push(`${title}. `);
    if (work.container) {
      out.push({ italic: work.container });
      if (work.volume) out.push(", ", { italic: work.volume });
      if (work.issue) out.push(`(${work.issue})`);
      if (work.pages) out.push(`, ${pageRange(work.pages)}`);
      out.push(". ");
    }
  }
  const link = doiUrl(work);
  if (link) out.push(link);
  return trimEnd(out);
}

function mla(work: Work): Segment[] {
  const out: Segment[] = [];
  const a = work.authors;
  let authors = "";
  if (a.length === 1) authors = familyFirstMla(a[0] as Author);
  else if (a.length === 2) authors = `${familyFirstMla(a[0] as Author)}, and ${givenFirst(a[1] as Author)}`;
  else if (a.length > 2) authors = `${familyFirstMla(a[0] as Author)}, et al`;
  if (authors) out.push(`${endWithPeriod(authors)} `);
  const title = stripTrailingPeriod(work.title);
  if (isBook(work)) {
    out.push({ italic: title }, ". ");
    if (work.publisher) out.push(`${work.publisher}, `);
    if (work.year) out.push(`${work.year}.`);
  } else {
    out.push(`“${title}.” `);
    if (work.container) {
      out.push({ italic: work.container });
      const bits: string[] = [];
      if (work.volume) bits.push(`vol. ${work.volume}`);
      if (work.issue) bits.push(`no. ${work.issue}`);
      if (work.year) bits.push(String(work.year));
      if (work.pages) bits.push(`pp. ${pageRange(work.pages)}`);
      if (bits.length) out.push(`, ${bits.join(", ")}`);
      out.push(". ");
    } else if (work.year) {
      out.push(`${work.year}. `);
    }
  }
  const link = work.doi ? `https://doi.org/${work.doi}` : (work.url ?? "");
  if (link) out.push(`${link}.`);
  return trimEnd(out);
}

function familyFirstMla(a: Author): string {
  if (a.organization || !a.given) return a.family;
  return `${a.family}, ${a.given}`;
}

function ieee(work: Work, index?: number): Segment[] {
  const out: Segment[] = [];
  if (index !== undefined) out.push(`[${index}] `);
  const a = work.authors;
  let authors = "";
  if (a.length > 6) authors = `${initialsFirst(a[0] as Author)} et al.`;
  else authors = joinWithAnd(a.map(initialsFirst), "and", true);
  if (authors) out.push(`${authors}, `);
  const title = stripTrailingPeriod(work.title);
  if (isBook(work)) {
    out.push({ italic: title }, ". ");
    if (work.publisher) out.push(`${work.publisher}, `);
    if (work.year) out.push(`${work.year}.`);
  } else {
    out.push(`“${title},” `);
    if (work.container) {
      out.push({ italic: work.container });
      if (work.volume) out.push(`, vol. ${work.volume}`);
      if (work.issue) out.push(`, no. ${work.issue}`);
      if (work.pages) out.push(`, ${/[-–—]/.test(work.pages) ? "pp." : "Art."} ${pageRange(work.pages)}`);
      if (work.year) out.push(`, ${work.year}`);
      out.push(work.doi ? `, doi: ${work.doi}.` : ".");
    } else {
      if (work.year) out.push(`${work.year}`);
      out.push(work.doi ? `, doi: ${work.doi}.` : ".");
    }
  }
  return trimEnd(out);
}

function chicago(work: Work): Segment[] {
  const out: Segment[] = [];
  const a = work.authors;
  let names: string[] = [];
  if (a.length > 10) names = [...a.slice(0, 7).map((x, i) => (i === 0 ? familyFirstMla(x) : givenFirst(x))), "et al."];
  else names = a.map((x, i) => (i === 0 ? familyFirstMla(x) : givenFirst(x)));
  const authors =
    a.length > 10 ? names.join(", ") : a.length === 2 ? `${names[0]}, and ${names[1]}` : joinWithAnd(names, "and", true);
  if (authors) out.push(`${endWithPeriod(authors)} `);
  out.push(work.year ? `${work.year}. ` : "n.d. ");
  const title = stripTrailingPeriod(work.title);
  if (isBook(work)) {
    out.push({ italic: title }, ". ");
    if (work.publisher) out.push(`${endWithPeriod(work.publisher)} `);
  } else {
    out.push(`“${title}.” `);
    if (work.container) {
      out.push({ italic: work.container });
      let vol = "";
      if (work.volume) vol += ` ${work.volume}`;
      if (work.issue) vol += ` (${work.issue})`;
      if (work.pages) vol += `: ${pageRange(work.pages)}`;
      out.push(`${vol}. `);
    }
  }
  const link = doiUrl(work);
  if (link) out.push(`${link}.`);
  return trimEnd(out);
}

function harvard(work: Work): Segment[] {
  const out: Segment[] = [];
  const a = work.authors;
  let authors = "";
  if (a.length > 3) authors = `${familyFirst(a[0] as Author, false)} et al.`;
  else authors = joinWithAnd(a.map((x) => familyFirst(x, false)), "and", false);
  out.push(authors ? `${authors} ` : "");
  out.push(work.year ? `(${work.year}) ` : "(no date) ");
  const title = stripTrailingPeriod(work.title);
  if (isBook(work)) {
    out.push({ italic: title }, ". ");
    if (work.publisher) out.push(`${endWithPeriod(work.publisher)} `);
  } else {
    out.push(`‘${title}’`);
    if (work.container) {
      out.push(", ", { italic: work.container });
      if (work.volume) out.push(`, ${work.volume}`);
      if (work.issue) out.push(`(${work.issue})`);
      if (work.pages) out.push(`, pp. ${pageRange(work.pages)}`);
    }
    out.push(". ");
  }
  if (work.doi) out.push(`doi: ${work.doi}.`);
  else if (work.url) out.push(`Available at: ${work.url}.`);
  return trimEnd(out);
}

function vancouver(work: Work, index?: number): Segment[] {
  const out: Segment[] = [];
  if (index !== undefined) out.push(`${index}. `);
  const a = work.authors;
  const fmt = (x: Author) => (x.organization || !x.given ? x.family : `${x.family} ${initialsCompact(x.given)}`);
  const authors = a.length > 6 ? `${a.slice(0, 6).map(fmt).join(", ")}, et al` : a.map(fmt).join(", ");
  if (authors) out.push(`${authors}. `);
  out.push(`${endWithPeriod(work.title)} `);
  if (isBook(work)) {
    if (work.publisher) out.push(`${work.publisher}; `);
    if (work.year) out.push(`${work.year}.`);
  } else {
    if (work.container) out.push(`${work.container}. `);
    let tail = work.year ? String(work.year) : "";
    if (work.volume) tail += `;${work.volume}`;
    if (work.issue) tail += `(${work.issue})`;
    if (work.pages) tail += `:${pageRange(work.pages).replace("–", "-")}`;
    if (tail) out.push(`${tail}.`);
  }
  if (work.doi) out.push(` doi:${work.doi}`);
  return trimEnd(out);
}

function trimEnd(segments: Segment[]): Segment[] {
  const out = [...segments];
  const last = out[out.length - 1];
  if (typeof last === "string") out[out.length - 1] = last.replace(/\s+$/, "");
  return out.filter((seg) => seg !== "");
}

/** Formats a reference-list entry. `index` is used by numbered styles (IEEE, Vancouver). */
export function formatReference(work: Work, style: CitationStyle, index?: number): Segment[] {
  switch (style) {
    case "apa":
      return apa(work);
    case "mla":
      return mla(work);
    case "ieee":
      return ieee(work, index);
    case "chicago":
      return chicago(work);
    case "harvard":
      return harvard(work);
    case "vancouver":
      return vancouver(work, index);
  }
}

export function formatReferenceText(work: Work, style: CitationStyle, index?: number): string {
  return renderPlain(formatReference(work, style, index));
}

/** The in-text form to paste into the manuscript, e.g. "(Smith & Lee, 2020)" or "[3]". */
export function formatInText(work: Work, style: CitationStyle, index = 1): string {
  const a = work.authors;
  const year = work.year ? String(work.year) : "n.d.";
  const family = (x: Author | undefined) => x?.family ?? "Anon.";
  switch (style) {
    case "ieee":
      return `[${index}]`;
    case "vancouver":
      return `(${index})`;
    case "mla": {
      if (a.length === 0) return `("${work.title.slice(0, 30)}")`;
      if (a.length === 1) return `(${family(a[0])})`;
      if (a.length === 2) return `(${family(a[0])} and ${family(a[1])})`;
      return `(${family(a[0])} et al.)`;
    }
    case "chicago": {
      if (a.length === 0) return `(${year})`;
      if (a.length === 1) return `(${family(a[0])} ${year})`;
      if (a.length === 2) return `(${family(a[0])} and ${family(a[1])} ${year})`;
      if (a.length === 3) return `(${family(a[0])}, ${family(a[1])}, and ${family(a[2])} ${year})`;
      return `(${family(a[0])} et al. ${year})`;
    }
    case "harvard": {
      if (a.length === 0) return `(${year})`;
      if (a.length === 1) return `(${family(a[0])}, ${year})`;
      if (a.length === 2) return `(${family(a[0])} and ${family(a[1])}, ${year})`;
      if (a.length === 3) return `(${family(a[0])}, ${family(a[1])} and ${family(a[2])}, ${year})`;
      return `(${family(a[0])} et al., ${year})`;
    }
    case "apa":
    default: {
      if (a.length === 0) return `(${work.title.split(" ").slice(0, 3).join(" ")}, ${year})`;
      if (a.length === 1) return `(${family(a[0])}, ${year})`;
      if (a.length === 2) return `(${family(a[0])} & ${family(a[1])}, ${year})`;
      return `(${family(a[0])} et al., ${year})`;
    }
  }
}

// ---------------------------------------------------------------------------
// Machine-readable exports
// ---------------------------------------------------------------------------

function bibtexEscape(s: string): string {
  return s.replace(/([&%$#_])/g, "\\$1");
}

function ascii(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]/g, "");
}

export function bibtexKey(work: Work): string {
  const family = ascii(work.authors[0]?.family ?? "anon").toLowerCase() || "anon";
  const word =
    work.title
      .split(/\s+/)
      .map((w) => ascii(w).toLowerCase())
      .find((w) => w.length > 3 && !["with", "from", "that", "this", "using", "their", "which", "toward", "towards"].includes(w)) ?? "";
  return `${family}${work.year ?? ""}${word}`;
}

export function formatBibtex(work: Work): string {
  const type =
    work.type === "book"
      ? "book"
      : work.type === "proceedings-article"
        ? "inproceedings"
        : work.container
          ? "article"
          : work.type === "preprint" || work.arxivId
            ? "misc"
            : "misc";
  const fields: Array<[string, string | undefined]> = [
    ["author", work.authors.map((a) => (a.organization || !a.given ? `{${a.family}}` : `${a.family}, ${a.given}`)).join(" and ") || undefined],
    ["title", work.title ? `{${bibtexEscape(work.title)}}` : undefined],
    [type === "inproceedings" ? "booktitle" : "journal", work.container],
    ["year", work.year ? String(work.year) : undefined],
    ["volume", work.volume],
    ["number", work.issue],
    ["pages", work.pages ? pageRange(work.pages).replace("–", "--") : undefined],
    ["publisher", work.publisher],
    ["doi", work.doi],
    ["url", work.doi ? undefined : work.url],
    ["eprint", work.arxivId],
    ["archivePrefix", work.arxivId ? "arXiv" : undefined],
  ];
  const body = fields
    .filter(([, v]) => v)
    .map(([k, v]) => {
      const value = k === "title" ? `{${v}}` : `{${bibtexEscape(String(v))}}`;
      return `  ${k} = ${value}`;
    })
    .join(",\n");
  return `@${type}{${bibtexKey(work)},\n${body}\n}`;
}

export function formatRis(work: Work): string {
  const ty = work.type === "book" ? "BOOK" : work.type === "proceedings-article" ? "CONF" : work.container ? "JOUR" : "GEN";
  const lines: string[] = [`TY  - ${ty}`];
  for (const a of work.authors) lines.push(`AU  - ${a.organization || !a.given ? a.family : `${a.family}, ${a.given}`}`);
  lines.push(`TI  - ${work.title}`);
  if (work.container) lines.push(`${ty === "CONF" ? "T2" : "JO"}  - ${work.container}`);
  if (work.year) lines.push(`PY  - ${work.year}`);
  if (work.volume) lines.push(`VL  - ${work.volume}`);
  if (work.issue) lines.push(`IS  - ${work.issue}`);
  if (work.pages) {
    const [sp, ep] = pageRange(work.pages).split("–");
    if (sp) lines.push(`SP  - ${sp}`);
    if (ep) lines.push(`EP  - ${ep}`);
  }
  if (work.publisher) lines.push(`PB  - ${work.publisher}`);
  if (work.doi) lines.push(`DO  - ${work.doi}`);
  if (work.url) lines.push(`UR  - ${work.url}`);
  lines.push("ER  - ");
  return lines.join("\n");
}
