import { splitSentences } from "../text/sentences.ts";
import { stem } from "../text/similarity.ts";
import { isStopword, tokenize } from "../text/tokens.ts";
import { MASK_CHAR } from "../text/protect.ts";

/**
 * Groups of words that rewording tools and writers commonly swap for each
 * other. Every member maps to the group's first word, so "demonstrates" and
 * "shows" compare equal. Kept to near-synonyms in academic prose.
 */
const SYNONYM_GROUPS: readonly string[][] = [
  ["show", "demonstrate", "reveal", "indicate", "illustrate", "display", "exhibit"],
  ["use", "utilize", "utilise", "employ", "apply", "leverage", "adopt"],
  ["increase", "rise", "grow", "raise", "boost", "enhance", "elevate", "augment"],
  ["decrease", "reduce", "decline", "lower", "diminish", "drop", "lessen", "cut"],
  ["large", "big", "substantial", "considerable", "huge", "vast", "sizable", "massive"],
  ["small", "little", "minor", "slight", "modest", "tiny"],
  ["method", "approach", "technique", "procedure", "strategy", "methodology", "framework"],
  ["result", "finding", "outcome", "observation"],
  ["important", "significant", "crucial", "critical", "essential", "vital", "key", "pivotal", "central"],
  ["study", "research", "investigation", "work", "analysis", "survey"],
  ["examine", "investigate", "analyze", "analyse", "explore", "assess", "evaluate", "study"],
  ["propose", "present", "introduce", "put", "offer", "suggest"],
  ["difficult", "hard", "challenging", "tough", "complex"],
  ["easy", "simple", "straightforward"],
  ["ease", "facilitate", "simplify", "help", "aid", "assist", "support"],
  ["train", "learn", "fit"],
  ["previous", "prior", "earlier", "past", "former", "existing"],
  ["deep", "deeper", "profound"],
  ["network", "net", "model", "architecture", "system"],
  ["problem", "issue", "challenge", "difficulty"],
  ["many", "numerous", "several", "various", "multiple", "lot"],
  ["obtain", "get", "achieve", "attain", "acquire", "gain", "reach"],
  ["improve", "better", "boost", "advance", "refine"],
  ["effect", "impact", "influence", "consequence"],
  ["cause", "induce", "produce", "generate", "trigger", "lead"],
  ["need", "require", "necessitate", "demand"],
  ["find", "discover", "identify", "detect", "observe", "note", "notice"],
  ["main", "primary", "principal", "chief", "major"],
  ["fast", "quick", "rapid", "swift"],
  ["accurate", "precise", "exact", "correct"],
  ["aim", "goal", "objective", "purpose", "intent"],
  ["establish", "create", "build", "construct", "develop", "form", "make", "design"],
  ["therefore", "thus", "hence", "consequently", "accordingly"],
  ["however", "nevertheless", "nonetheless", "yet", "although", "though"],
  ["also", "additionally", "furthermore", "moreover", "besides"],
  ["about", "approximately", "around", "roughly", "nearly"],
  ["entirely", "completely", "fully", "solely", "wholly", "exclusively", "only"],
  ["depend", "rely", "base", "hinge"],
  ["substantially", "considerably", "significantly", "markedly", "much"],
];

/** Common inflections, so "increases", "increased" and "increasing" fold with "increase". */
function inflections(w: string): string[] {
  const base = w.endsWith("e") ? w.slice(0, -1) : w;
  const y = w.endsWith("y") ? w.slice(0, -1) : null;
  return [w, `${w}s`, `${w}es`, `${base}ed`, `${base}ing`, `${w}d`, ...(y ? [`${y}ies`, `${y}ied`] : [])];
}

const CANON = new Map<string, string>();
for (const group of SYNONYM_GROUPS) {
  const head = stem(group[0] as string);
  for (const w of group) for (const form of inflections(w)) if (!CANON.has(stem(form))) CANON.set(stem(form), head);
}

/** Content words of a sentence, stemmed and with synonyms folded together. */
export function conceptSet(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokenize(text)) {
    if (t.word.length < 3 || isStopword(t.word) || /^\d+$/.test(t.word)) continue;
    const s = stem(t.word);
    out.add(CANON.get(s) ?? s);
  }
  return out;
}

export interface ParaphraseMatch {
  /** Offsets of the sentence in the checked text. */
  start: number;
  end: number;
  text: string;
  sourceId: string;
  /** The most similar sentence in the source. */
  sourceText: string;
  /** 0 to 1: share of this sentence's concepts found in the source sentence (and vice versa, averaged). */
  similarity: number;
}

export interface ParaphraseOptions {
  /** Minimum similarity to report. Default 0.65. */
  threshold?: number;
  /** Sentences need at least this many content words. Default 7. */
  minConcepts?: number;
}

interface Indexed {
  start: number;
  end: number;
  text: string;
  concepts: Set<string>;
}

/**
 * Finds sentences that say the same thing as a sentence in a source using
 * mostly the same concepts, even when words are swapped for synonyms or the
 * order changes. Exact copies are found by the run matcher; this catches
 * rewording.
 */
export function findParaphrases(
  checkText: string,
  sources: ReadonlyArray<{ id: string; text: string }>,
  options: ParaphraseOptions = {},
): ParaphraseMatch[] {
  const threshold = options.threshold ?? 0.65;
  const minConcepts = options.minConcepts ?? 7;
  const body: Indexed[] = [];
  const index = new Map<string, number[]>();
  for (const s of splitSentences(checkText)) {
    const visible = s.text.replace(new RegExp(`${MASK_CHAR}+`, "g"), " ");
    const concepts = conceptSet(visible);
    if (concepts.size < minConcepts) continue;
    const i = body.length;
    body.push({ start: s.start, end: s.end, text: visible.replace(/\s+/g, " ").trim(), concepts });
    for (const c of concepts) {
      let list = index.get(c);
      if (!list) index.set(c, (list = []));
      list.push(i);
    }
  }
  if (body.length === 0) return [];

  const best = new Map<number, ParaphraseMatch>();
  for (const src of sources) {
    for (const s of splitSentences(src.text)) {
      const concepts = conceptSet(s.text);
      if (concepts.size < minConcepts - 2) continue;
      const shared = new Map<number, number>();
      for (const c of concepts) for (const i of index.get(c) ?? []) shared.set(i, (shared.get(i) ?? 0) + 1);
      for (const [i, n] of shared) {
        const b = body[i] as Indexed;
        if (n < 5) continue;
        // Symmetric overlap: a long source sentence containing a short one is not enough on its own.
        const sim = (n / b.concepts.size + n / concepts.size) / 2;
        if (sim < threshold) continue;
        const prev = best.get(i);
        if (!prev || sim > prev.similarity) {
          best.set(i, {
            start: b.start,
            end: b.end,
            text: b.text,
            sourceId: src.id,
            sourceText: s.text.replace(/\s+/g, " ").trim().slice(0, 600),
            similarity: Math.round(sim * 100) / 100,
          });
        }
      }
    }
  }
  return [...best.values()].sort((a, b) => a.start - b.start);
}
