export interface SplitDocument {
  /** Text before the reference list (or the whole text when none is found). */
  body: string;
  /** Reference list text, empty when none is found. */
  references: string;
  /** Character offset where the reference list starts, or -1. */
  referencesStart: number;
}

const HEADING_RE =
  /^[ \t]*(?:#{1,6}[ \t]+|\\(?:section|chapter)\*?\{)?(?:\d+\.?[ \t]+)?(references|bibliography|works cited|literature cited|reference list)\}?[ \t]*:?[ \t]*$/gim;

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
