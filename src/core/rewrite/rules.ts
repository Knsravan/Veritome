import { WORDY_PHRASES, INFORMAL_PHRASES, CONTRACTIONS, WEAK_WORDS } from "../grammar/lexicons.ts";
import { matchCase } from "../grammar/rules.ts";
import type { RewriteMode } from "./types.ts";

type Pair = readonly [string, string];

/** Stock phrases and plainer replacements. Grammatical person is kept by listing each form. */
export const STOCK_REPLACEMENTS: ReadonlyArray<Pair> = [
  ["it is important to note that", ""],
  ["it is worth noting that", ""],
  ["it should be noted that", ""],
  ["it is crucial to note that", ""],
  ["delves into", "examines"],
  ["delve into", "examine"],
  ["delving into", "examining"],
  ["plays a pivotal role in", "is central to"],
  ["play a pivotal role in", "are central to"],
  ["plays a crucial role in", "is central to"],
  ["play a crucial role in", "are central to"],
  ["plays a vital role in", "is central to"],
  ["play a vital role in", "are central to"],
  ["plays a key role in", "is central to"],
  ["play a key role in", "are central to"],
  ["a myriad of", "many"],
  ["a plethora of", "many"],
  ["in the realm of", "in"],
  ["sheds light on", "clarifies"],
  ["shed light on", "clarify"],
  ["shedding light on", "clarifying"],
  ["navigate the complexities of", "deal with"],
  ["navigating the complexities of", "dealing with"],
  ["underscores the importance of", "shows the importance of"],
  ["underscore the importance of", "show the importance of"],
  ["provides valuable insights into", "informs our understanding of"],
  ["provide valuable insights into", "inform our understanding of"],
  ["offers valuable insights into", "informs our understanding of"],
  ["valuable insights", "insights"],
  ["stands as a testament to", "shows"],
  ["is a testament to", "shows"],
  ["a testament to", "evidence of"],
  ["paves the way for", "enables"],
  ["pave the way for", "enable"],
  ["paving the way for", "enabling"],
  ["harnessing the power of", "using"],
  ["harness the power of", "use"],
  ["leveraging", "using"],
  ["leverages", "uses"],
  ["leverage", "use"],
  ["utilizing", "using"],
  ["utilises", "uses"],
  ["utilizes", "uses"],
  ["utilize", "use"],
  ["utilise", "use"],
  ["multifaceted", "complex"],
  ["holistic approach", "integrated approach"],
  ["seamlessly", "smoothly"],
  ["meticulously", "carefully"],
  ["a deeper understanding", "a better understanding"],
  ["comprehensive understanding", "full understanding"],
  ["embark on", "begin"],
  ["in today's rapidly evolving", "in the current"],
  ["in today's fast-paced world,", ""],
  ["in the ever-evolving", "in the changing"],
  ["ever-evolving", "changing"],
];

export const PLAIN_REPLACEMENTS: ReadonlyArray<Pair> = [
  ["approximately", "about"],
  ["demonstrates", "shows"],
  ["demonstrated", "showed"],
  ["demonstrate", "show"],
  ["subsequently", "later"],
  ["commence", "start"],
  ["commenced", "started"],
  ["facilitates", "helps"],
  ["facilitate", "help"],
  ["numerous", "many"],
  ["sufficient", "enough"],
  ["additional", "more"],
  ["ascertain", "find out"],
  ["endeavour", "try"],
  ["endeavor", "try"],
  ["in excess of", "more than"],
  ["a considerable amount of", "much"],
];

/** Formulaic sentence openers that are dropped by the humaniser fallback. "However" is kept on purpose. */
const DROPPABLE_OPENERS = /(^|[.!?]["”’)]?\s+)(Moreover|Furthermore|Additionally|In addition|Notably|Importantly|Overall|Ultimately|In essence|Indeed),\s+([a-z\p{Lu}{])/gu;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function replaceAll(text: string, pairs: ReadonlyArray<Pair>): { text: string; edits: number } {
  let edits = 0;
  const sorted = [...pairs].sort((a, b) => b[0].length - a[0].length);
  const map = new Map(sorted.map(([k, v]) => [k.toLowerCase(), v]));
  const re = new RegExp(`\\b(?:${sorted.map(([k]) => escape(k).replace(/ /g, "\\s+").replace(/'/g, "['’]")).join("|")})(?=\\W|$)`, "giu");
  const out = text.replace(re, (m) => {
    const key = m.toLowerCase().replace(/\s+/g, " ").replace(/’/g, "'");
    const rep = map.get(key);
    if (rep === undefined) return m;
    edits++;
    return rep === "" ? DELETED : matchCase(m, rep);
  });
  return { text: out, edits };
}

const DELETED = "\u0002";

/** Removes deletion markers and capitalises a sentence whose opening words were deleted. */
function settleDeletions(text: string): string {
  return text
    .replace(/(^\s*|[.!?]["”’)]?\s+)\u0002\s*(\p{Ll})/gu, (_m, p: string, c: string) => p + c.toUpperCase())
    .replace(/ ?\u0002 ?/g, (m) => (m.length === 3 ? " " : ""));
}

function upperFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Light, deterministic edits used when no language model is available. They
 * never touch placeholders or numbers. This is editing, not paraphrasing.
 */
export function ruleRewrite(masked: string, mode: RewriteMode): { text: string; edits: number } {
  let text = masked;
  let edits = 0;
  const apply = (pairs: ReadonlyArray<Pair>) => {
    const r = replaceAll(text, pairs);
    text = r.text;
    edits += r.edits;
  };
  // "the fact that" cannot be deleted safely without rewriting the sentence around it.
  const wordy = WORDY_PHRASES.filter(([p]) => p.split(" ").length > 1 && p !== "the fact that");
  switch (mode) {
    case "humanise": {
      // Openers go first so a deletion right after "Moreover," cannot hide it from the pattern.
      text = text.replace(DROPPABLE_OPENERS, (_m, lead: string, _w: string, next: string) => {
        edits++;
        return lead + upperFirst(next);
      });
      apply(STOCK_REPLACEMENTS);
      apply(wordy);
      break;
    }
    case "concise":
      apply(wordy);
      apply(STOCK_REPLACEMENTS.filter(([, v]) => v === ""));
      text = text.replace(new RegExp(`\\b(?:${WEAK_WORDS.map(escape).join("|")})\\s+(?=\\w)`, "gi"), () => {
        edits++;
        return "";
      });
      break;
    case "simple":
      apply(wordy);
      apply(PLAIN_REPLACEMENTS);
      apply(STOCK_REPLACEMENTS);
      break;
    case "academic":
      apply(Object.entries(CONTRACTIONS));
      apply(INFORMAL_PHRASES.map(([k, v]) => [k, v[0] ?? k] as const));
      apply(wordy);
      break;
    case "expand":
      // Expanding text needs a language model; there is no honest rule-based version.
      break;
  }
  return { text: settleDeletions(text), edits };
}
