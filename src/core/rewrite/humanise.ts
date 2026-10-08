/**
 * The Humaniser: rewrites one paragraph at a time so it reads like a careful person wrote it, in the tone and
 * (optionally) the voice the user chooses. Citations, maths, links and numbers are locked, the length is kept in
 * proportion, and a second pass checks that the meaning did not change. It is a writing tool: it does nothing to
 * hide where text came from, and every result carries a disclosure note.
 */
import { proseRanges } from "../detector/breakdown.ts";
import type { LlmClient } from "../llm/client.ts";
import { extractJson } from "../llm/client.ts";
import { chunkBySentences } from "../text/chunk.ts";
import { changedShare, diffWords } from "../text/diff.ts";
import { checkNumbersPreserved, protect, restore } from "../text/protect.ts";
import { splitParagraphs } from "../text/sentences.ts";
import { countWords } from "../text/tokens.ts";
import { cleanReply } from "./prompts.ts";

export type HumaniseTone = "academic" | "natural" | "simple";
export type HumaniseStrength = "light" | "balanced" | "strong";

export const HUMANISE_TONES: ReadonlyArray<{ id: HumaniseTone; label: string; description: string }> = [
  { id: "academic", label: "Academic", description: "A journal's register, without the stiffness." },
  { id: "natural", label: "Natural", description: "Clear, direct professional prose." },
  { id: "simple", label: "Simple", description: "Plain words and shorter sentences." },
];

export const HUMANISE_STRENGTHS: ReadonlyArray<{ id: HumaniseStrength; label: string; description: string }> = [
  { id: "light", label: "Light", description: "Fixes the stiff phrases; keeps most of your wording." },
  { id: "balanced", label: "Balanced", description: "Rewrites sentences freely; keeps the paragraph's plan." },
  { id: "strong", label: "Strong", description: "Rebuilds the paragraph from scratch around the same content." },
];

const TONE: Record<HumaniseTone, string> = {
  academic:
    "Write in the register of a well-edited research journal: precise, measured and readable. Use the first person (we/I) only where the original does.",
  natural: "Write clear, direct professional prose, the way a thoughtful expert explains their work to a colleague.",
  simple:
    "Write in plain language with short sentences, so a reader outside the field can follow. Keep technical terms that have no plain equivalent and explain nothing that the original does not.",
};

const STRENGTH: Record<HumaniseStrength, string> = {
  light:
    "Make light edits: fix the habits listed below and awkward phrasing, but keep most of the author's wording and every sentence's structure where it already reads well.",
  balanced:
    "Rewrite sentence by sentence: change wording and structure freely, but keep the paragraph's order of ideas.",
  strong:
    "Rebuild the paragraph: you may reorder, merge and split sentences and choose new wording throughout, as long as every idea, claim and qualification survives.",
};

/** Accepted ratio of output to input words, by strength. */
export const HUMANISE_LENGTH: Record<HumaniseStrength, readonly [number, number]> = {
  light: [0.75, 1.25],
  balanced: [0.65, 1.35],
  strong: [0.55, 1.45],
};

/** Habits typical of machine-generated or over-polished prose that the rewrite removes. */
export const STIFF_HABITS = [
  "stock phrases such as 'delve into', 'plays a pivotal/crucial role', 'it is important to note', 'in today's rapidly evolving', 'a testament to', 'navigate the complexities', 'shed light on', 'bridging the gap', 'seamless(ly)', 'robust', 'leverage', 'harness', 'foster', 'multifaceted', 'transformative', 'cutting-edge', 'paving the way', 'underscores'",
  "sentences that open with 'Moreover', 'Furthermore', 'Additionally', 'In addition', 'Overall', 'In conclusion' or 'Notably' when the link is already clear",
  "lists of exactly three adjectives or phrases used for rhythm rather than meaning",
  "'not only ... but also' and 'It is not X, it is Y' constructions",
  "every sentence having the same length and shape; vary them",
  "a closing sentence that only restates the paragraph",
  "vague claims of importance ('crucial', 'vital', 'essential', 'significant') where the paragraph does not say why",
  "stacked hedges ('may potentially', 'could possibly') and empty intensifiers ('very', 'truly', 'highly')",
  "markdown, bold or italics added for emphasis, and em dashes used where a comma or full stop would do",
];

export function humaniseSystemPrompt(tone: HumaniseTone, strength: HumaniseStrength, voice?: string): string {
  const voiceBlock = voice?.trim()
    ? `\n\nThe author supplied a sample of their own writing, between <voice> tags. Match its voice: sentence length and variety, vocabulary level, use of the first person, how it opens sentences and its punctuation habits. Do not copy its content or phrases.\n<voice>\n${voice.trim()}\n</voice>`
    : "";
  return `You are an experienced academic editor. You revise one paragraph of a manuscript so it reads as if a careful, skilled human writer wrote it.

Tone: ${TONE[tone]}
How much to change: ${STRENGTH[strength]}

Remove these habits wherever they appear:
${STIFF_HABITS.map((h) => `- ${h}`).join("\n")}

Rules you must follow:
1. Tokens such as {{P1}} or {{P12}} stand for citations, equations, URLs, DOIs or cross-references. Copy every one of them exactly once, unchanged, at the right place. Never invent or drop one.
2. Keep every number, percentage, unit, statistic, name and technical term exactly as written.
3. Keep the meaning: do not add facts, examples, claims, hedges, opinions or conclusions, and do not remove any finding, qualification or caveat. Keep the level of certainty the same.
4. Keep the language and its spelling variety (British or American).
5. Do not add slang, deliberate errors, typos or personal anecdotes.
6. Reply with the revised paragraph only: no preface, no notes, no quotation marks around it.${voiceBlock}`;
}

export function humaniseUserPrompt(paragraph: string, context: { before?: string; after?: string }, feedback: readonly string[]): string {
  const ctx = [
    context.before ? `Previous paragraph (context only, do not rewrite):\n${context.before}` : "",
    context.after ? `Next paragraph (context only, do not rewrite):\n${context.after}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const retry = feedback.length
    ? `\n\nYour previous attempt was rejected because: ${feedback.join("; ")}. Fix this and follow the rules exactly.`
    : "";
  return `${ctx ? `${ctx}\n\n` : ""}Paragraph to revise:\n${paragraph}${retry}`;
}

const CHECK_SYSTEM = `You compare an original paragraph from a research manuscript with an edited version and decide whether the edit kept the meaning.

The meaning changed if the edit adds or removes a fact, claim, result, example, qualification, caveat or citation placeholder (such as {{P3}}), changes a number or name, changes how certain a claim is, or changes who did what. Changes of wording, sentence order and style are fine.

Reply with JSON only: {"same_meaning": true or false, "problems": ["short description of each change in meaning"]}`;

/** Asks the model whether the rewrite kept the meaning. Null when the check itself could not run. */
export async function checkMeaning(
  llm: LlmClient,
  original: string,
  rewritten: string,
  signal?: AbortSignal,
): Promise<{ same: boolean; problems: string[] } | null> {
  try {
    const reply = await llm.chat({
      system: CHECK_SYSTEM,
      user: `Original:\n${original}\n\nEdited:\n${rewritten}`,
      temperature: 0,
      json: true,
      ...(signal ? { signal } : {}),
    });
    const parsed = extractJson<{ same_meaning?: unknown; problems?: unknown }>(reply);
    if (!parsed || typeof parsed.same_meaning !== "boolean") return null;
    const problems = Array.isArray(parsed.problems) ? parsed.problems.filter((p): p is string => typeof p === "string").slice(0, 5) : [];
    return { same: parsed.same_meaning, problems };
  } catch {
    return null;
  }
}

const PLACEHOLDER_ID = /\{\{P(\d+)\}\}/g;

/** Mechanical checks on a rewrite of a masked paragraph: placeholders, numbers, length and leftover formatting. */
export function checkRewrite(
  maskedOriginal: string,
  output: string,
  strength: HumaniseStrength,
): string[] {
  const problems: string[] = [];
  const want = [...maskedOriginal.matchAll(PLACEHOLDER_ID)].map((m) => m[1]).sort();
  const got = [...output.matchAll(PLACEHOLDER_ID)].map((m) => m[1]).sort();
  const missing = want.filter((id) => !got.includes(id));
  const extra = got.filter((id, i) => !want.includes(id) || got.indexOf(id) !== i);
  if (missing.length) problems.push(`placeholders ${missing.map((i) => `{{P${i}}}`).join(", ")} are missing`);
  if (extra.length) problems.push(`placeholders ${extra.map((i) => `{{P${i}}}`).join(", ")} were invented or repeated`);
  const numbers = checkNumbersPreserved(maskedOriginal.replace(PLACEHOLDER_ID, " "), output.replace(/\{\{\s*P\d+\s*\}\}/g, " "));
  if (numbers.missing.length) problems.push(`the number(s) ${numbers.missing.join(", ")} were dropped or changed`);
  if (numbers.added.length) problems.push(`the number(s) ${numbers.added.join(", ")} were added`);
  const inWords = countWords(maskedOriginal);
  const ratio = inWords === 0 ? 1 : countWords(output) / inWords;
  const [lo, hi] = HUMANISE_LENGTH[strength];
  if (inWords >= 12 && (ratio < lo || ratio > hi)) problems.push(`the length changed too much (${Math.round(ratio * 100)}% of the original)`);
  if (/\*\*|__|^#+\s/m.test(output)) problems.push("it added markdown formatting");
  if (!output.trim()) problems.push("the reply was empty");
  return problems;
}

export interface HumaniseParagraphOptions {
  tone: HumaniseTone;
  strength: HumaniseStrength;
  llm: LlmClient;
  voice?: string;
  context?: { before?: string; after?: string };
  /** Extra attempts after the first when a check fails. Default 2. */
  retries?: number;
  signal?: AbortSignal;
}

export interface HumaniseParagraphResult {
  original: string;
  text: string;
  status: "rewritten" | "kept_original";
  attempts: number;
  /** Why attempts were rejected, in plain language. */
  problems: string[];
  /** Whether the meaning check ran and passed on the returned text. */
  meaningChecked: boolean;
  /** Share of words changed, 0 to 1. */
  changed: number;
}

/** Humanises one paragraph. On repeated failures the original is kept, with the reasons. */
export async function humaniseParagraph(paragraph: string, options: HumaniseParagraphOptions): Promise<HumaniseParagraphResult> {
  const { masked, spans } = protect(paragraph);
  const ctx = {
    ...(options.context?.before ? { before: options.context.before.slice(-1500) } : {}),
    ...(options.context?.after ? { after: options.context.after.slice(0, 1500) } : {}),
  };
  const system = humaniseSystemPrompt(options.tone, options.strength, options.voice?.slice(0, 12_000));
  const retries = Math.max(0, options.retries ?? 2);
  const feedback: string[] = [];
  const problems: string[] = [];
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    if (options.signal?.aborted) break;
    let reply: string;
    try {
      reply = await options.llm.chat({
        system,
        user: humaniseUserPrompt(masked, ctx, feedback),
        temperature: attempt === 1 ? 0.8 : 0.4,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (err) {
      problems.push(`attempt ${attempt}: ${err instanceof Error ? err.message : "the model call failed"}`);
      break;
    }
    const output = cleanReply(reply);
    const mechanical = checkRewrite(masked, output, options.strength);
    if (mechanical.length) {
      problems.push(`attempt ${attempt}: ${mechanical.join("; ")}`);
      feedback.splice(0, feedback.length, ...mechanical);
      continue;
    }
    const meaning = await checkMeaning(options.llm, masked, output, options.signal);
    if (meaning && !meaning.same) {
      const why = meaning.problems.length ? meaning.problems : ["the meaning changed"];
      problems.push(`attempt ${attempt}: ${why.join("; ")}`);
      feedback.splice(0, feedback.length, ...why.map((p) => `the meaning changed: ${p}`));
      continue;
    }
    const text = restore(output, spans).text;
    return {
      original: paragraph,
      text,
      status: "rewritten",
      attempts: attempt,
      problems,
      meaningChecked: meaning !== null,
      changed: Math.round(changedShare(diffWords(paragraph, text)) * 100) / 100,
    };
  }
  return { original: paragraph, text: paragraph, status: "kept_original", attempts: problems.length, problems, meaningChecked: false, changed: 0 };
}

export interface PlannedParagraph {
  start: number;
  end: number;
  text: string;
  /** False for titles, headings, captions, short list items and the reference list, which are left as they are. */
  rewrite: boolean;
}

/** Longest piece sent in one request; longer paragraphs are split between sentences. */
export const MAX_PIECE_CHARS = 2500;

/**
 * Splits a text into paragraphs (long ones into sentence-aligned pieces) and marks which are running prose worth
 * rewriting. Joining every piece's text with the original text between pieces gives back the whole text.
 */
export function planParagraphs(text: string): PlannedParagraph[] {
  const prose = proseRanges(text);
  const whole = prose.length === 1 && prose[0]!.start === 0 && prose[0]!.end === text.length;
  const out: PlannedParagraph[] = [];
  for (const p of splitParagraphs(text)) {
    const rewrite = (whole ? countWords(p.text) >= 12 : prose.some((r) => r.start <= p.start && p.end <= r.end)) && countWords(p.text) >= 8;
    const parts = rewrite && p.text.length > MAX_PIECE_CHARS ? chunkBySentences(p.text, MAX_PIECE_CHARS) : [{ start: 0, end: p.text.length }];
    for (const c of parts) {
      const raw = p.text.slice(c.start, c.end);
      const lead = raw.length - raw.trimStart().length;
      const t = raw.trim();
      if (t) out.push({ start: p.start + c.start + lead, end: p.start + c.start + lead + t.length, text: t, rewrite });
    }
  }
  return out;
}

/** Puts the text back together with each piece replaced by its new version (same order as planParagraphs). */
export function assemble(text: string, pieces: readonly PlannedParagraph[], replacements: readonly string[]): string {
  let out = "";
  let cursor = 0;
  pieces.forEach((p, i) => {
    out += text.slice(cursor, p.start) + (replacements[i] ?? p.text);
    cursor = p.end;
  });
  return out + text.slice(cursor);
}

export const HUMANISE_DISCLOSURE =
  "The authors used an AI language tool to improve the readability of parts of this manuscript, and take full responsibility for its content.";
