/**
 * Readable text of a web page, for comparing a matched page as a whole rather than only its search snippet.
 * Scripts, styles, navigation, headers, footers and asides are dropped; block elements become line breaks.
 */
const DROP = /<(script|style|noscript|svg|template|iframe|head|nav|header|footer|aside|form|button|select)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const BLOCK = /<\/?(p|div|section|article|main|li|ul|ol|h[1-6]|br|tr|td|th|table|blockquote|pre|figure|figcaption|dd|dt)\b[^>]*>/gi;

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const text = body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(DROP, " ")
    .replace(BLOCK, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}
