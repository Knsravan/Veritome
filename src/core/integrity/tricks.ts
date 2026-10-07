import { CONFUSABLES, hasConfusable, mixedWordLooksDisguised, unconfuseWord } from "./confusables.ts";

export type TrickKind = "lookalike_letters" | "invisible_characters" | "unusual_spaces" | "hidden_text";

/** A place where the text looks normal on the page but has been altered in a way that hides it from checkers. */
export interface TrickFlag {
  kind: TrickKind;
  start: number;
  end: number;
  /** The affected text as it reads on the page. */
  text: string;
  /** How many altered characters this range contains. */
  count: number;
}

export const TRICK_TEXT: Record<TrickKind, { title: string; why: string }> = {
  lookalike_letters: {
    title: "Letters swapped for look-alikes from another alphabet",
    why: "Some letters here come from another alphabet (such as a Cyrillic “а” in place of a Latin “a”). They look identical but stop checkers from matching the words. Veritome undoes the swap before checking.",
  },
  invisible_characters: {
    title: "Invisible characters inside words",
    why: "Zero-width characters split words for a computer while the page looks normal. Veritome removes them before checking.",
  },
  unusual_spaces: {
    title: "Unusual space characters",
    why: "Many spaces here are special Unicode spaces rather than ordinary ones, a trick sometimes used to break up copied text.",
  },
  hidden_text: {
    title: "Hidden text",
    why: "This text is in the file but is invisible on the page (white, tiny or hidden), so it changes what checkers read.",
  },
};

const INVISIBLE_G = /[​-‍⁠﻿᠎]/g;
const SOFT_HYPHEN = "­";
const ODD_SPACE_G = /[ -   　]/g;

/** Merges ranges of the same kind that are close together, so a disguised paragraph is one finding, not fifty. */
function merge(flags: TrickFlag[], text: string, gap = 40): TrickFlag[] {
  const out: TrickFlag[] = [];
  for (const f of flags.sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && last.kind === f.kind && f.start - last.end <= gap) {
      last.end = Math.max(last.end, f.end);
      last.count += f.count;
      last.text = text.slice(last.start, last.end);
    } else out.push({ ...f });
  }
  return out;
}

/**
 * Finds disguised text: look-alike letters from other alphabets mixed into Latin words, invisible characters
 * inside words and runs of unusual space characters. Genuine non-Latin words (Greek symbols, Russian names) are
 * not flagged, because they contain letters with no Latin twin.
 */
export function findTricks(text: string): TrickFlag[] {
  const flags: TrickFlag[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}­​-‍⁠﻿]+/gu)) {
    const word = m[0];
    const start = m.index;
    if (hasConfusable(word)) {
      const visible = word.replace(/[­​-‍⁠﻿]/g, "");
      // A single Greek letter (α, ν) is notation, not a disguise.
      const fixed = unconfuseWord(visible);
      // A word made only of look-alikes counts when the words around it are Latin (one disguised word in an
      // English sentence), not inside genuinely Cyrillic or Greek text.
      const around = text.slice(Math.max(0, start - 40), start) + text.slice(start + word.length, start + word.length + 40);
      const latinContext = (around.match(/[A-Za-z]/g) ?? []).length > 3 * (around.match(/[\u0370-\u03ff\u0400-\u04ff]/g) ?? []).length + 5;
      const disguised = /[A-Za-z]/.test(visible) ? mixedWordLooksDisguised(visible) : visible.length >= 3 && latinContext;
      if (fixed !== visible && disguised) {
        const count = [...visible].filter((c) => CONFUSABLES[c] !== undefined).length;
        flags.push({ kind: "lookalike_letters", start, end: start + word.length, text: word, count });
      }
    }
    const inv = (word.match(INVISIBLE_G) ?? []).length;
    if (inv > 0 && /\p{L}/u.test(word.replace(INVISIBLE_G, ""))) flags.push({ kind: "invisible_characters", start, end: start + word.length, text: word, count: inv });
  }
  // Soft hyphens are normal in PDFs in small numbers; many inside words is a disguise.
  const softInside = [...text.matchAll(/\p{L}­\p{L}/gu)];
  if (softInside.length >= 10) for (const m of softInside) flags.push({ kind: "invisible_characters", start: m.index, end: m.index + 3, text: m[0], count: 1 });
  const odd = [...text.matchAll(ODD_SPACE_G)];
  if (odd.length >= 8) for (const m of odd) flags.push({ kind: "unusual_spaces", start: m.index, end: m.index + 1, text: m[0], count: 1 });

  const merged = merge(flags, text);
  // Report the words around a run of odd spaces, so there is something to read.
  for (const f of merged) {
    if (f.kind !== "unusual_spaces") continue;
    const from = Math.max(0, text.lastIndexOf(" ", Math.max(0, f.start - 1)) + 1);
    const toSpace = text.indexOf(" ", f.end);
    f.start = from;
    f.end = toSpace < 0 ? text.length : toSpace;
    f.text = text.slice(f.start, f.end);
  }
  return merged;
}

/** Text with invisible characters removed and disguised words restored, for use as search queries. */
export function cleanForSearch(s: string): string {
  return s
    .replace(/[­​-‍⁠﻿᠎]/g, "")
    .replace(ODD_SPACE_G, " ")
    .replace(/[\p{L}\p{N}]+/gu, (w) => unconfuseWord(w));
}
