/**
 * Phrases that language models over-use compared with human academic writing.
 * Each has a weight: 1 for words humans also use often, up to 3 for stock phrases
 * that are rare outside model output. None of them proves anything on its own.
 */
export const CLICHES: ReadonlyArray<readonly [string, number]> = [
  ["delve into", 3],
  ["delves into", 3],
  ["delving into", 3],
  ["rich tapestry", 3],
  ["tapestry of", 2],
  ["a testament to", 3],
  ["stands as a testament", 3],
  ["in today's fast-paced world", 3],
  ["in today's rapidly evolving", 3],
  ["in the ever-evolving", 3],
  ["ever-evolving landscape", 3],
  ["ever-changing landscape", 3],
  ["navigate the complexities", 3],
  ["navigating the complexities", 3],
  ["the intricacies of", 2],
  ["intricate interplay", 3],
  ["nuanced understanding", 2],
  ["plays a crucial role", 2],
  ["play a crucial role", 2],
  ["plays a pivotal role", 3],
  ["play a pivotal role", 3],
  ["plays a vital role", 2],
  ["a pivotal role", 2],
  ["it is important to note", 2],
  ["it is worth noting", 2],
  ["it is crucial to", 2],
  ["it is essential to", 1],
  ["in conclusion,", 1],
  ["in summary,", 1],
  ["overall,", 1],
  ["shed light on", 2],
  ["sheds light on", 2],
  ["shedding light on", 2],
  ["paving the way", 2],
  ["pave the way", 2],
  ["unlock the potential", 3],
  ["unlocking the potential", 3],
  ["harness the power", 3],
  ["harnessing the power", 3],
  ["the power of", 1],
  ["a myriad of", 2],
  ["myriad of", 2],
  ["a plethora of", 2],
  ["multifaceted", 2],
  ["holistic approach", 2],
  ["seamlessly", 2],
  ["seamless integration", 3],
  ["cutting-edge", 1],
  ["game-changer", 2],
  ["game changer", 2],
  ["groundbreaking", 1],
  ["transformative", 1],
  ["underscores the importance", 3],
  ["underscore the importance", 3],
  ["underscores", 1],
  ["highlighting the importance", 2],
  ["foster a", 1],
  ["fostering", 1],
  ["leverage", 1],
  ["leveraging", 1],
  ["robust framework", 2],
  ["comprehensive understanding", 2],
  ["valuable insights", 2],
  ["provides valuable insights", 3],
  ["offers valuable insights", 3],
  ["gain insights", 1],
  ["in the realm of", 3],
  ["the realm of", 2],
  ["landscape of", 1],
  ["crucial insights", 2],
  ["a deeper understanding", 2],
  ["deeper understanding", 1],
  ["serves as a", 1],
  ["not only", 1],
  ["both a challenge and an opportunity", 3],
  ["at the forefront of", 2],
  ["a key role", 1],
  ["meticulous", 2],
  ["meticulously", 2],
  ["embark on", 2],
  ["embarking on", 2],
  ["journey of", 1],
  ["resonate with", 2],
  ["resonates with", 2],
  ["ultimately,", 1],
  ["notably,", 1],
  ["furthermore,", 1],
  ["moreover,", 1],
  ["additionally,", 1],
  ["vibrant", 1],
  ["bustling", 2],
  ["realm", 1],
  ["intricate", 1],
  ["pivotal", 1],
  ["commendable", 2],
  ["showcasing", 1],
  ["showcases", 1],
  ["elevate", 1],
  ["streamline", 1],
  ["empower", 1],
  ["empowering", 1],
  ["a nuanced", 1],
  ["in essence,", 2],
  ["it's important to remember", 3],
  ["by doing so,", 1],
  ["this not only", 2],
  ["a crucial step", 2],
  ["a significant step forward", 2],
  ["remains a challenge", 1],
  ["future research should", 1],
];

/** Connectives that open a sentence. Models start sentences with them far more often than people do. */
export const TRANSITIONS: ReadonlyArray<string> = [
  "moreover",
  "furthermore",
  "additionally",
  "in addition",
  "consequently",
  "therefore",
  "thus",
  "hence",
  "however",
  "nevertheless",
  "nonetheless",
  "overall",
  "in conclusion",
  "in summary",
  "to summarize",
  "to summarise",
  "ultimately",
  "notably",
  "importantly",
  "interestingly",
  "similarly",
  "likewise",
  "conversely",
  "subsequently",
  "accordingly",
  "as a result",
  "in particular",
  "specifically",
  "on the other hand",
  "by contrast",
  "in contrast",
  "for instance",
  "for example",
  "first",
  "firstly",
  "second",
  "secondly",
  "third",
  "thirdly",
  "finally",
  "lastly",
  "in essence",
  "indeed",
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface LexiconHit {
  start: number;
  end: number;
  phrase: string;
  weight: number;
}

let clicheRe: RegExp | null = null;
const clicheWeights = new Map<string, number>();

function getClicheRe(): RegExp {
  if (clicheRe) return clicheRe;
  for (const [p, w] of CLICHES) clicheWeights.set(p, w);
  const sorted = [...clicheWeights.keys()].sort((a, b) => b.length - a.length);
  // Phrases ending in a comma must end there; others must end at a word boundary.
  const alts = sorted.map((p) => (p.endsWith(",") ? escape(p) : `${escape(p)}\\b`));
  clicheRe = new RegExp(`\\b(?:${alts.join("|")})`, "gi");
  return clicheRe;
}

/** Finds cliché phrases. Longer phrases win over the shorter ones they contain. */
export function findCliches(text: string): LexiconHit[] {
  const re = getClicheRe();
  re.lastIndex = 0;
  const out: LexiconHit[] = [];
  let m: RegExpExecArray | null;
  const normal = text.replace(/’/g, "'");
  while ((m = re.exec(normal)) !== null) {
    const phrase = m[0].toLowerCase();
    out.push({ start: m.index, end: m.index + m[0].length, phrase, weight: clicheWeights.get(phrase) ?? 1 });
  }
  return out;
}

const TRANSITION_RE = new RegExp(
  `^[\\s"“(]*(?:${[...TRANSITIONS].sort((a, b) => b.length - a.length).map(escape).join("|")})\\b\\s*,?`,
  "i",
);

/** The connective a sentence opens with, or null. */
export function openingTransition(sentence: string): string | null {
  const m = TRANSITION_RE.exec(sentence);
  return m ? m[0].replace(/^[\s"“(]+/, "").replace(/[\s,]+$/, "").toLowerCase() : null;
}
