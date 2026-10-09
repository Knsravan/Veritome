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
    "Academic, but the way good researchers actually write: plain, exact words and direct statements, not ornate or formal-sounding phrasing. Use the first person (we/I) only where the original does.",
  natural:
    "Clear, direct prose, the way a thoughtful expert explains their work to a colleague. Contractions (it's, don't, we've) are fine where they sound natural.",
  simple:
    "Plain language with short sentences, so a reader outside the field can follow. Contractions are fine. Keep technical terms that have no plain equivalent and explain nothing that the original does not.",
};

const STRENGTH: Record<HumaniseStrength, string> = {
  light:
    "Make light edits only: fix the habits listed below and genuinely awkward phrasing, and leave every other word as the author wrote it.",
  balanced:
    "Rewrite where it helps: change wording and structure where a sentence is stiff or formulaic, keep the author's wording where it already reads well, and keep the paragraph's order of ideas.",
  strong:
    "Rebuild the paragraph: you may reorder, merge and split sentences and choose new wording throughout, as long as every idea, claim and qualification survives.",
};

/** How people actually write, which over-polished and machine-written prose lacks. */
const PLAIN_STYLE = [
  "Use the plainest accurate word. Never replace a plain word with a fancier synonym (keep 'uses', not 'utilizes'; 'is based on', not 'relies upon'; 'shows', not 'demonstrates'; 'at once', not 'concurrently').",
  "Avoid formal connectors and filler such as 'whereas', 'thereby', 'whereby', 'thus', 'hence', 'in turn', 'notably', 'consequently' unless the logic truly needs them.",
  "Prefer verbs to nouns made from verbs ('we measured', not 'the measurement of ... was performed').",
  "Let sentence length vary naturally: some short and direct, some longer. Do not polish every sentence to the same smooth rhythm or make each one a perfect summary.",
  "Keep the author's own words and quirks wherever they are already clear; a revision should sound like the same person on a good day, not like a different, more formal writer.",
  "Prefer the active voice with a clear subject ('we tested', 'the model predicts') where the original's meaning allows it.",
  "Say things once and directly. Cut words that add nothing ('in order to' → 'to', 'due to the fact that' → 'because', 'a large number of' → 'many').",
  "Do not start neighbouring sentences the same way, and do not open sentences with linking words such as 'Moreover', 'Furthermore' or 'Additionally'; most sentences need no link word at all.",
  "Prefer short, common words that a reader in a hurry understands at once. Use a technical term only when it is the right term.",
  "Write it the way the author would explain it out loud to a colleague: concrete and specific, with no grand opening line ('In recent years...', 'In today's world...') and no closing line that sums up or praises the work.",
  "Real writing is a little uneven: a short sentence after a long one, an occasional sentence that starts with 'But' or 'So', a plain 'we' or 'this' instead of a long noun phrase. Do not make every sentence balanced and complete-sounding.",
];

/**
 * Inflated words and phrases with the plain words people use instead. The rewrite must not contain these; the
 * prompt lists them and a check sends the paragraph back when one slips through.
 */
export const PLAIN_WORDS: ReadonlyArray<readonly [RegExp, string, string]> = [
  [/\butili[sz](?:e|es|ed|ing|ation)\b/gi, "utilize, utilization", "use"],
  [/\bleverag(?:e|es|ed|ing)\b/gi, "leverage", "use"],
  [/\bfacilitat(?:e|es|ed|ing)\b/gi, "facilitate", "help, allow"],
  [/\bdelv(?:e|es|ed|ing)\b/gi, "delve", "look at, study"],
  [/\b(?:pivotal|paramount)\b/gi, "pivotal, paramount", "main, key, or say why it matters"],
  [/\bunderscor(?:e|es|ed|ing)\b/gi, "underscore", "show"],
  [/\bshowcas(?:e|es|ed|ing)\b/gi, "showcase", "show"],
  [/\bcommenc(?:e|es|ed|ing)\b/gi, "commence", "start"],
  [/\bendeavou?rs?\b/gi, "endeavour", "try, work"],
  [/\b(?:myriad|plethora)\b/gi, "myriad, plethora", "many"],
  [/\btapestry\b/gi, "tapestry", "mix"],
  [/\brealm\b/gi, "realm", "field, area"],
  [/\bholistic(?:ally)?\b/gi, "holistic", "whole, complete"],
  [/\bseamless(?:ly)?\b/gi, "seamless(ly)", "smooth, easy"],
  [/\bmultifaceted\b/gi, "multifaceted", "complex, with several sides"],
  [/\b(?:ever-evolving|rapidly evolving|ever-changing) landscape\b/gi, "ever-evolving landscape", "field"],
  [/\btestament to\b/gi, "a testament to", "shows"],
  [/\bit is (?:important|worth|crucial) (?:to note|noting)(?: that)?\b/gi, "it is important to note that", "(just say it)"],
  [/\bshed(?:s|ding)? light on\b/gi, "shed light on", "explain, show"],
  [/\bpav(?:e|es|ed|ing) the way\b/gi, "pave the way", "make possible"],
  [/\bnavigat(?:e|es|ed|ing) the complexities\b/gi, "navigate the complexities", "deal with"],
  [/\bin the realm of\b/gi, "in the realm of", "in"],
  [/\baforementioned\b/gi, "aforementioned", "this, these"],
  [/\bnotwithstanding\b/gi, "notwithstanding", "despite"],
  [/\bheretofore\b/gi, "heretofore", "until now"],
  [/\bwherein\b/gi, "wherein", "where, in which"],
  [/\bbolster(?:s|ed|ing)?\b/gi, "bolster", "support, strengthen"],
  [/\bstreamlin(?:e|es|ed|ing)\b/gi, "streamline", "simplify"],
  [/\bascertain(?:s|ed|ing)?\b/gi, "ascertain", "find out"],
  [/\bharness(?:es|ed|ing)?\b/gi, "harness", "use"],
  [/\bfoster(?:s|ed|ing)?\b/gi, "foster", "encourage, build"],
  [/\bcutting-edge\b/gi, "cutting-edge", "new, latest"],
  [/\bgame-chang(?:er|ing)\b/gi, "game-changer", "major"],
];

/**
 * Wordy phrases with a plain equivalent that means exactly the same, replaced after the rewrite. Only phrases whose
 * swap can never change the meaning or the grammar are here.
 */
const WORDY: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bin order to\b/gi, "to"],
  [/\bdue to the fact that\b/gi, "because"],
  [/\bowing to the fact that\b/gi, "because"],
  [/\bin spite of the fact that\b/gi, "although"],
  [/\bdespite the fact that\b/gi, "although"],
  [/\bat this point in time\b/gi, "now"],
  [/\bat the present time\b/gi, "now"],
  [/\bin the event that\b/gi, "if"],
  [/\bprior to\b/gi, "before"],
  [/\bsubsequent to\b/gi, "after"],
  [/\ba (?:large|great) number of\b/gi, "many"],
  [/\bthe (?:vast )?majority of\b/gi, "most"],
  [/\ba small number of\b/gi, "a few"],
  [/\bis able to\b/gi, "can"],
  [/\bare able to\b/gi, "can"],
  [/\bhas the ability to\b/gi, "can"],
  [/\bhave the ability to\b/gi, "can"],
  [/\bfor the purpose of\b/gi, "for"],
  [/\bwith the exception of\b/gi, "except"],
  [/\bin close proximity to\b/gi, "near"],
  [/\ba total of (?=\d)/gi, ""],
];

const keepCase = (match: string, plain: string) =>
  plain && match[0] === match[0]!.toUpperCase() && match[0] !== match[0]!.toLowerCase() ? plain[0]!.toUpperCase() + plain.slice(1) : plain;

/** Replaces wordy phrases with their plain equivalents (only swaps that keep the meaning and the grammar). */
export function plainCleanup(text: string): string {
  let out = text;
  for (const [re, plain] of WORDY) out = out.replace(re, (m) => keepCase(m, plain));
  return out.replace(/ {2,}/g, " ");
}

const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?])\s+(?=[A-Z{"“(])/)
    .map((s) => s.trim())
    .filter((s) => countWords(s) >= 3);

/** How many inflated words a text uses. */
export function inflatedCount(text: string): number {
  return PLAIN_WORDS.reduce((n, [re]) => n + (text.match(re)?.length ?? 0), 0);
}

/**
 * Style problems in a rewrite, as feedback for another attempt: inflated words, stock sentence openers the original
 * did not use, every sentence the same length, and dashes the original did not have. None of these is a reason to
 * keep the original; the attempt with the fewest is used.
 */
export function styleIssues(original: string, output: string): string[] {
  const issues: string[] = [];
  const inflated: string[] = [];
  for (const [re, , plain] of PLAIN_WORDS) {
    const found = output.match(re);
    if (found) inflated.push(`"${found[0]}" (write ${plain})`);
  }
  if (inflated.length) issues.push(`it uses inflated words: ${inflated.join(", ")}`);
  const opener = /^(?:Moreover|Furthermore|Additionally|In addition|Notably|Importantly|Overall|In conclusion|Ultimately|Consequently),/;
  const openers = sentencesOf(output).filter((s) => opener.test(s)).length;
  const before = sentencesOf(original).filter((s) => opener.test(s)).length;
  if (openers > 0 && openers >= before) issues.push("sentences still open with connectors such as 'Moreover', 'Furthermore' or 'Additionally'; drop them or join the sentences");
  const lengths = sentencesOf(output).map(countWords);
  if (lengths.length >= 4) {
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const sd = Math.sqrt(lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length);
    if (sd / mean < 0.22) issues.push("every sentence is about the same length; make some shorter and let others run longer");
  }
  const dashes = (s: string) => (s.match(/—|\s–\s/g) ?? []).length;
  if (dashes(output) > dashes(original)) issues.push("it adds dashes; use commas or full stops instead");
  if (/\bnot only\b[^.]*\bbut also\b/i.test(output) && !/\bnot only\b/i.test(original)) issues.push("it adds a 'not only ... but also' construction");
  return issues;
}

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
  return `You are an experienced editor of research writing. You revise one paragraph so it reads the way a careful person writes: clear, plain and natural, never ornate.

Tone: ${TONE[tone]}
How much to change: ${STRENGTH[strength]}

How to write:
${PLAIN_STYLE.map((h) => `- ${h}`).join("\n")}

Never use these inflated words; write the plain word instead:
${PLAIN_WORDS.map(([, word, plain]) => `- ${word} → ${plain}`).join("\n")}

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
  // The best attempt that passed every hard check, kept in case later attempts only differ in style.
  let best: { output: string; attempt: number; meaningChecked: boolean; issues: string[]; score: number } | null = null;
  const done = (b: NonNullable<typeof best>): HumaniseParagraphResult => {
    const text = restore(b.output, spans).text;
    return {
      original: paragraph,
      text,
      status: "rewritten",
      attempts: b.attempt,
      problems,
      meaningChecked: b.meaningChecked,
      changed: Math.round(changedShare(diffWords(paragraph, text)) * 100) / 100,
    };
  };
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
    const output = plainCleanup(cleanReply(reply));
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
    // Passed: still send it back once more if it reads stiffly, but keep the best version so far.
    const issues = styleIssues(masked, output);
    const score = issues.length + inflatedCount(output);
    if (!best || score < best.score) best = { output, attempt, meaningChecked: meaning !== null, issues, score };
    if (!issues.length || attempt === retries + 1) return done(best);
    problems.push(`attempt ${attempt}: ${issues.join("; ")}`);
    feedback.splice(0, feedback.length, ...issues);
  }
  if (best) return done(best);
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
  for (const p of splitParagraphs(text).flatMap(peelHeadings).flatMap(splitDisplayLines)) {
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

/**
 * A heading on its own line at the top of a paragraph ("I. INTRODUCTION", "2.1 Data Collection") that a PDF reader
 * joined to the text below it: split off, so it is left as it is and stays on its own line.
 */
function peelHeadings(p: { text: string; start: number; end: number }): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = [];
  let cur = p;
  for (let k = 0; k < 3; k++) {
    const nl = cur.text.indexOf("\n");
    if (nl < 0) break;
    const line = cur.text.slice(0, nl).trim();
    const words = line.replace(/^(?:[IVX]+|[A-Z]|\d+(?:\.\d+)*)[.)]?\s+/, "").split(/\s+/).filter(Boolean);
    const letters = words.filter((w) => /\p{L}/u.test(w));
    const caps = letters.length > 0 && letters.every((w) => w === w.toUpperCase());
    const title = letters.length > 0 && letters.every((w) => w.replace(/^\P{L}+/u, "").length < 4 || /^\P{L}*\p{Lu}/u.test(w));
    if (!letters.length || words.length > 12 || /[.,;:!?]$/.test(line) || !(caps || title)) break;
    out.push({ text: line, start: cur.start, end: cur.start + line.length });
    const rest = cur.text.slice(nl + 1);
    const lead = rest.length - rest.trimStart().length;
    cur = { text: rest.trim(), start: cur.start + nl + 1 + lead, end: cur.end };
  }
  out.push(cur);
  return out;
}

/** A displayed equation on its own line: maths symbols and, usually, an equation number at the end. */
function isDisplayLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 160) return false;
  const maths = (t.match(/[=≤≥≈≠∑∏∫√∞∂∇±×÷⟨⟩|]|[\u{1D400}-\u{1D7FF}]|[\u0370-\u03FF]/gu) ?? []).length;
  const numbered = /\(\d{1,3}[a-z]?\)$/.test(t);
  const words = (t.match(/\p{L}{3,}/gu) ?? []).length;
  return (numbered && maths > 0) || (maths >= 1 && words === 0) || (maths >= 2 && words <= 2) || (maths >= 3 && words <= 4);
}

/** Splits displayed equations out of a paragraph, so they are left exactly as they are. */
function splitDisplayLines(p: { text: string; start: number; end: number }): Array<{ text: string; start: number; end: number }> {
  if (!p.text.includes("\n")) return [p];
  const out: Array<{ text: string; start: number; end: number }> = [];
  let from = 0;
  let at = 0;
  const flush = (end: number) => {
    const raw = p.text.slice(from, end);
    const t = raw.trim();
    if (t) {
      const s = p.start + from + (raw.length - raw.trimStart().length);
      out.push({ text: t, start: s, end: s + t.length });
    }
  };
  for (const line of p.text.split("\n")) {
    const end = at + line.length;
    if (isDisplayLine(line)) {
      flush(at);
      from = at;
      flush(end);
      from = end + 1;
    }
    at = end + 1;
  }
  flush(p.text.length);
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

/**
 * Whole-paragraph edits for writing back into a file: pieces of one paragraph (a long paragraph is revised in
 * parts) are joined into one edit. Paragraphs with no change are left out.
 */
export function paragraphEdits(
  text: string,
  pieces: readonly PlannedParagraph[],
  replacements: readonly string[],
): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string; changed: boolean }> = [];
  pieces.forEach((p, i) => {
    const next = (replacements[i] ?? p.text).replace(/\s+/g, " ").trim();
    const changed = next !== p.text.replace(/\s+/g, " ").trim();
    const last = out[out.length - 1];
    if (last && !/\n\s*\n/.test(text.slice(last.end, p.start)) && pieces[i - 1]?.rewrite && p.rewrite) {
      last.end = p.end;
      last.text += ` ${next}`;
      last.changed ||= changed;
    } else out.push({ start: p.start, end: p.end, text: next, changed });
  });
  return out.filter((e) => e.changed).map(({ start, end, text: t }) => ({ start, end, text: t }));
}

export const HUMANISE_DISCLOSURE =
  "The authors used an AI language tool to improve the readability of parts of this manuscript, and take full responsibility for its content.";
