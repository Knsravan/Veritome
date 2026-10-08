export interface SplitDocument {
  /** Text before the reference list (or the whole text when none is found). */
  body: string;
  /** Reference list text, empty when none is found. */
  references: string;
  /** Character offset where the reference list starts, or -1. */
  referencesStart: number;
}

const HEADING_RE =
  /^[ \t]*(?:#{1,6}[ \t]+|\\(?:section|chapter)\*?\{)?(?:\d+\.?[ \t]+)?(r ?eferences|b ?ibliography|works cited|literature cited|reference list)\}?[ \t]*:?[ \t]*$/gim;

const INLINE_HEADING_RE = /(^|\n)[ \t]*(?:\d+\.?[ \t]+)?(?:r ?eferences|b ?ibliography|works cited|literature cited|reference list)[ \t]*:?[ \t]+(?=\[1\][ \t]|1\.[ \t]+[A-Z])/gim;

/**
 * Where a numbered reference list starts when it has no heading: the last "[1] " (or "[2] " when the first entry
 * was garbled) that begins an entry in the second half of the text and is followed by the next numbers in order,
 * closely spaced, through to the end. One missing number is tolerated.
 */
function numberedListStart(text: string): number {
  const entry = /\[(\d{1,3})\][ \t]+(?=[A-Z\u00C0-\u024F"“])/g;
  const hits: Array<{ n: number; at: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = entry.exec(text)) !== null) hits.push({ n: Number(m[1]), at: m.index });
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i]!;
    if (h.n > 2 || h.at < text.length * 0.5) continue;
    if (h.n === 2 && hits.slice(0, i).some((e) => e.n === 1 && e.at > text.length * 0.5)) continue;
    let next = h.n + 1;
    let last = h.at;
    for (const later of hits.slice(i + 1)) {
      // One entry may be missing or garbled by extraction.
      if (later.n === next || later.n === next + 1) {
        if (later.at - last > 1500) break;
        next = later.n + 1;
        last = later.at;
      }
    }
    // At least five entries, and the list reaches (nearly) the end of the text.
    if (next - h.n >= 5 && text.length - last < 1500) return h.at;
  }
  return -1;
}

/**
 * Finds the reference list so the checkers can leave it out of the body text.
 * Chooses the last matching heading that sits in the second half of the
 * document, which avoids tables of contents.
 */
export function splitReferences(text: string): SplitDocument {
  let chosen = -1;
  let chosenEnd = -1;
  HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADING_RE.exec(text)) !== null) {
    if (m.index >= text.length * 0.3) {
      chosen = m.index;
      chosenEnd = m.index + m[0].length;
    }
  }

  // A heading run into its first entry ("REFERENCES [1] A. Author, …"), as PDF extraction often leaves it.
  if (chosen < 0) {
    INLINE_HEADING_RE.lastIndex = 0;
    while ((m = INLINE_HEADING_RE.exec(text)) !== null) {
      if (m.index >= text.length * 0.3) {
        chosen = m.index + m[1]!.length;
        chosenEnd = m.index + m[0].length;
      }
    }
  }
  // No heading at all (lost in extraction): a dense numbered list "[1] … [2] … [3] …" that runs to the end.
  if (chosen < 0) {
    const list = numberedListStart(text);
    if (list >= 0) {
      chosen = list;
      chosenEnd = list;
    }
  }

  const latex = text.search(/\\begin\{thebibliography\}/);
  if (latex >= 0 && (chosen < 0 || latex < chosen)) {
    return { body: text.slice(0, latex), references: text.slice(latex), referencesStart: latex };
  }

  if (chosen < 0) return { body: text, references: "", referencesStart: -1 };
  return { body: text.slice(0, chosen), references: text.slice(chosenEnd).trim(), referencesStart: chosen };
}

/** Replaces quoted passages with spaces so offsets stay stable. */
export function blankQuotedText(text: string, minLength = 40): string {
  return text.replace(/(["“])([^"“”\n]{1,2000}?)(["”])/g, (whole) =>
    whole.length >= minLength ? " ".repeat(whole.length) : whole,
  );
}

/**
 * The author block of a paper: what sits between the title line and the abstract (names, departments,
 * institutions, emails). Every paper from the same department shares it, so it is no evidence of copying.
 * Returns null when no abstract heading is found near the start.
 */
export function frontMatter(text: string): { start: number; end: number } | null {
  const head = text.slice(0, 6000);
  const abs = /(^|\n)[ \t]*(?:abstract|a\s?b\s?s\s?t\s?r\s?a\s?c\s?t|summary)\b[\s.:—–-]*/i.exec(head);
  if (!abs) return null;
  const firstBreak = text.indexOf("\n");
  if (firstBreak < 0 || firstBreak >= abs.index) return null;
  const block = text.slice(firstBreak, abs.index);
  // Only when it looks like an author block: short lines, or emails and affiliations.
  const lines = block.split("\n").filter((l) => l.trim());
  const looksLikeAuthors = /@|\b(dept|department|university|institute|college|school|faculty|laborator(y|ies))\b/i.test(block) || lines.every((l) => l.trim().split(/\s+/).length <= 12);
  if (!lines.length || !looksLikeAuthors) return null;
  return { start: firstBreak, end: abs.index + abs[1]!.length };
}
