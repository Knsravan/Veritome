/**
 * The Paraphraser: rewords a paragraph in one of several styles and at a chosen strength, keeping citations,
 * numbers, maths and the author's chosen terms exactly, and checking that the meaning did not change. Also offers
 * other ways to say one sentence, and words that fit in place of one word.
 */
import type { LlmClient } from "../llm/client.ts";
import { extractJson } from "../llm/client.ts";
import { changedShare, diffWords } from "../text/diff.ts";
import { checkNumbersPreserved, protect, restore } from "../text/protect.ts";
import { countWords } from "../text/tokens.ts";
import { checkMeaning, inflatedCount, PLAIN_WORDS, plainCleanup } from "./humanise.ts";
import { cleanReply } from "./prompts.ts";

export type ParaphraseStyle = "standard" | "fluent" | "academic" | "formal" | "simple" | "shorter" | "longer";
export type ParaphraseStrength = "light" | "medium" | "strong";

export const PARAPHRASE_STYLES: ReadonlyArray<{ id: ParaphraseStyle; label: string; description: string }> = [
  { id: "standard", label: "Standard", description: "New wording, same meaning and length." },
  { id: "fluent", label: "Fluent", description: "Smooths awkward phrasing and grammar." },
  { id: "academic", label: "Academic", description: "A precise, scholarly register." },
  { id: "formal", label: "Formal", description: "Professional and polished." },
  { id: "simple", label: "Simple", description: "Plain words and shorter sentences." },
  { id: "shorter", label: "Shorter", description: "About a third shorter; nothing dropped." },
  { id: "longer", label: "Longer", description: "Spells out the steps; adds no facts." },
];

export const PARAPHRASE_STRENGTHS: ReadonlyArray<{ id: ParaphraseStrength; label: string; description: string }> = [
  { id: "light", label: "Light", description: "Changes some words; keeps the sentences." },
  { id: "medium", label: "Medium", description: "New wording and some new sentence shapes." },
  { id: "strong", label: "Strong", description: "Rebuilds every sentence around the same ideas." },
];

const STYLE: Record<ParaphraseStyle, string> = {
  standard: "Reword the paragraph in clear, natural prose, keeping roughly the same length and the same level of formality.",
  fluent: "Make the paragraph read smoothly: fix awkward phrasing, grammar and flow, and join or split sentences where that helps.",
  academic: "Write in a precise academic register, as a careful researcher would: exact terms, measured claims, plain words where they are accurate.",
  formal: "Write in a formal, professional register, polished and impersonal, without becoming wordy.",
  simple: "Use plain, common words and shorter sentences so a reader outside the field can follow. Keep technical terms that have no plain equivalent.",
  shorter: "Make the paragraph about a third shorter by cutting repetition and wordiness. Keep every claim, result, qualification and citation.",
  longer: "Make the paragraph easier to follow by spelling out steps and connections that are only implied, up to about 40% longer. Add no new facts, examples, results or claims.",
};

const STRENGTH: Record<ParaphraseStrength, string> = {
  light: "Change the wording lightly: swap words and phrases, keep each sentence's structure.",
  medium: "Change the wording throughout and reshape some sentences.",
  strong: "Rebuild every sentence with new wording and new structure, keeping each idea, claim and qualification.",
};

/** Accepted ratio of output to input words, by style. */
const LENGTH: Record<ParaphraseStyle, readonly [number, number]> = {
  standard: [0.75, 1.3],
  fluent: [0.7, 1.3],
  academic: [0.7, 1.4],
  formal: [0.7, 1.4],
  simple: [0.6, 1.4],
  shorter: [0.45, 0.95],
  longer: [1.0, 1.8],
};

/** Share of words a paraphrase should change at each strength; less than this, and it is sent back once. */
const MIN_CHANGE: Record<ParaphraseStrength, number> = { light: 0.12, medium: 0.3, strong: 0.45 };

export function paraphraseSystemPrompt(style: ParaphraseStyle, strength: ParaphraseStrength): string {
  return `You are an expert editor who paraphrases passages from research and academic writing.

Style: ${STYLE[style]}
How much to change: ${STRENGTH[strength]}

Write the way a skilled person writes: plain, exact words, varied sentence lengths, no stock phrases. Never use these inflated words: ${PLAIN_WORDS.map(([, w]) => w).join(", ")}.

Rules you must follow:
1. Tokens such as {{P1}} or {{P12}} stand for citations, equations, URLs, cross-references or terms the author wants kept. Copy every one exactly once, unchanged. Never invent or drop one.
2. Keep every number, unit, name and technical term exactly as written.
3. Keep the meaning: add no facts, claims, examples or opinions, drop no finding or caveat, and keep the level of certainty.
4. Keep the language and its spelling variety (British or American).
5. Reply with the paraphrased paragraph only: no preface, notes or quotation marks.`;
}

export interface ParaphraseResult {
  original: string;
  text: string;
  status: "rewritten" | "kept_original";
  attempts: number;
  problems: string[];
  meaningChecked: boolean;
  /** Share of words changed, 0 to 1. */
  changed: number;
}

export interface ParaphraseOptions {
  style: ParaphraseStyle;
  strength: ParaphraseStrength;
  llm: LlmClient;
  /** Terms to keep exactly as written. */
  keep?: readonly string[];
  retries?: number;
  signal?: AbortSignal;
}

const PLACEHOLDER = /\{\{P(\d+)\}\}/g;

/** Mechanical checks: placeholders, numbers, length. */
function checkParaphrase(masked: string, output: string, style: ParaphraseStyle): string[] {
  const problems: string[] = [];
  const want = [...masked.matchAll(PLACEHOLDER)].map((m) => m[1]);
  const got = [...output.matchAll(PLACEHOLDER)].map((m) => m[1]);
  const missing = want.filter((id) => !got.includes(id));
  if (missing.length) problems.push(`placeholders ${missing.map((i) => `{{P${i}}}`).join(", ")} are missing`);
  if (got.some((id, i) => !want.includes(id) || got.indexOf(id) !== i)) problems.push("a placeholder was invented or repeated");
  const n = checkNumbersPreserved(masked.replace(PLACEHOLDER, " "), output.replace(/\{\{\s*P\d+\s*\}\}/g, " "));
  if (n.missing.length) problems.push(`the number(s) ${n.missing.join(", ")} were dropped or changed`);
  if (n.added.length) problems.push(`the number(s) ${n.added.join(", ")} were added`);
  const words = countWords(masked);
  const ratio = words ? countWords(output) / words : 1;
  const [lo, hi] = LENGTH[style];
  if (words >= 12 && (ratio < lo || ratio > hi)) problems.push(`the length is ${Math.round(ratio * 100)}% of the original, outside what this style allows`);
  if (/\*\*|^#+\s/m.test(output)) problems.push("it added markdown formatting");
  if (!output.trim()) problems.push("the reply was empty");
  return problems;
}

/** Paraphrases one paragraph. On repeated failures the original is kept, with the reasons. */
export async function paraphraseParagraph(paragraph: string, options: ParaphraseOptions): Promise<ParaphraseResult> {
  const { masked, spans } = protect(paragraph, { ...(options.keep?.length ? { keep: options.keep } : {}) });
  const system = paraphraseSystemPrompt(options.style, options.strength);
  const retries = Math.max(0, options.retries ?? 2);
  const feedback: string[] = [];
  const problems: string[] = [];
  let best: { output: string; attempt: number; checked: boolean; score: number } | null = null;
  const finish = (b: NonNullable<typeof best>): ParaphraseResult => {
    const text = restore(b.output, spans).text;
    return {
      original: paragraph,
      text,
      status: "rewritten",
      attempts: b.attempt,
      problems,
      meaningChecked: b.checked,
      changed: Math.round(changedShare(diffWords(paragraph, text)) * 100) / 100,
    };
  };
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    if (options.signal?.aborted) break;
    let reply: string;
    try {
      reply = await options.llm.chat({
        system,
        user: `Paragraph:\n${masked}${feedback.length ? `\n\nYour previous attempt was rejected because: ${feedback.join("; ")}. Fix this.` : ""}`,
        temperature: attempt === 1 ? 0.8 : 0.5,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (err) {
      problems.push(`attempt ${attempt}: ${err instanceof Error ? err.message : "the model call failed"}`);
      break;
    }
    const output = plainCleanup(cleanReply(reply));
    const hard = checkParaphrase(masked, output, options.style);
    if (hard.length) {
      problems.push(`attempt ${attempt}: ${hard.join("; ")}`);
      feedback.splice(0, feedback.length, ...hard);
      continue;
    }
    const meaning = await checkMeaning(options.llm, masked, output, options.signal);
    if (meaning && !meaning.same) {
      const why = meaning.problems.length ? meaning.problems : ["the meaning changed"];
      problems.push(`attempt ${attempt}: ${why.join("; ")}`);
      feedback.splice(0, feedback.length, ...why.map((p) => `the meaning changed: ${p}`));
      continue;
    }
    // Soft checks: too close to the original for the chosen strength, or inflated words.
    const soft: string[] = [];
    const changed = changedShare(diffWords(masked, output));
    if (changed < MIN_CHANGE[options.strength]) soft.push(`only ${Math.round(changed * 100)}% of the words changed; reword more`);
    const inflated = inflatedCount(output);
    if (inflated) soft.push("it uses inflated words; use plain ones");
    const score = soft.length + inflated;
    if (!best || score < best.score) best = { output, attempt, checked: meaning !== null, score };
    if (!soft.length || attempt === retries + 1) return finish(best);
    problems.push(`attempt ${attempt}: ${soft.join("; ")}`);
    feedback.splice(0, feedback.length, ...soft);
  }
  if (best) return finish(best);
  return { original: paragraph, text: paragraph, status: "kept_original", attempts: problems.length, problems, meaningChecked: false, changed: 0 };
}

/** Up to three other ways to say one sentence, in the chosen style; each keeps its citations and numbers. */
export async function sentenceAlternatives(
  sentence: string,
  context: string,
  options: { style: ParaphraseStyle; llm: LlmClient; keep?: readonly string[]; signal?: AbortSignal },
): Promise<string[]> {
  const { masked, spans } = protect(sentence, { ...(options.keep?.length ? { keep: options.keep } : {}) });
  const reply = await options.llm.chat({
    system: `${paraphraseSystemPrompt(options.style, "medium")}

Instead of one paragraph, you get one sentence and its paragraph for context. Give three different ways to write that sentence, each a complete sentence that fits its place in the paragraph. Reply with JSON only: {"options": ["...", "...", "..."]}`,
    user: `Paragraph (context only):\n${context.slice(0, 2_000)}\n\nSentence to rewrite:\n${masked}`,
    temperature: 0.9,
    json: true,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const parsed = extractJson<{ options?: unknown }>(reply);
  const list = Array.isArray(parsed?.options) ? parsed.options.filter((o): o is string => typeof o === "string") : [];
  const seen = new Set<string>();
  return list
    .map((o) => plainCleanup(cleanReply(o)))
    .filter((o) => checkParaphrase(masked, o, "standard").length === 0)
    .map((o) => restore(o, spans).text.trim())
    .filter((o) => o && o !== sentence.trim() && !seen.has(o) && seen.add(o))
    .slice(0, 3);
}

/** Words or short phrases that could replace `word` in this sentence without changing its meaning. */
export async function synonymsInContext(word: string, sentence: string, llm: LlmClient, signal?: AbortSignal): Promise<string[]> {
  const reply = await llm.chat({
    system:
      'You suggest replacements for one word in a sentence. Give up to 6 words or short phrases that fit grammatically in its place and keep the sentence\'s meaning, plainest first. Match the original form (tense, number, capitalisation). Reply with JSON only: {"options": ["..."]}',
    user: `Sentence: ${sentence.slice(0, 600)}\nWord: ${word}`,
    temperature: 0.3,
    json: true,
    ...(signal ? { signal } : {}),
  });
  const parsed = extractJson<{ options?: unknown }>(reply);
  const list = Array.isArray(parsed?.options) ? parsed.options.filter((o): o is string => typeof o === "string") : [];
  const lower = word.toLowerCase();
  const seen = new Set<string>();
  return list
    .map((o) => o.trim())
    .filter((o) => o && o.length <= 40 && o.toLowerCase() !== lower && !seen.has(o.toLowerCase()) && seen.add(o.toLowerCase()))
    .slice(0, 6);
}
