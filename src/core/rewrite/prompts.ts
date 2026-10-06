import type { RewriteMode } from "./types.ts";

export const MODE_INSTRUCTIONS: Record<RewriteMode, string> = {
  academic:
    "Rephrase the passage in a clear, formal academic register. Vary sentence structure and word choice, but keep the meaning, the hedging and the level of certainty exactly as they are.",
  simple:
    "Rewrite the passage in plainer language with shorter sentences, so a reader outside the field can follow it. Keep technical terms that have no plain equivalent.",
  concise:
    "Make the passage about 30% shorter by removing redundancy and wordiness. Do not drop any claim, result, qualification or citation.",
  expand:
    "Make the passage clearer by spelling out implicit steps and connections, up to about 40% longer. Do not add new facts, results, examples or claims.",
  humanise:
    "Revise the passage so it reads as if a careful human researcher wrote it: vary sentence length and rhythm, prefer concrete verbs, and remove stock phrases (for example 'delve into', 'plays a pivotal role', 'it is important to note') and formulaic connectives ('Moreover', 'Furthermore', 'Additionally') where they add nothing. Keep the academic register. Do not add slang, deliberate errors, personal anecdotes or opinions.",
};

/** Accepted ratio of output words to input words, per mode. */
export const LENGTH_BOUNDS: Record<RewriteMode, readonly [number, number]> = {
  academic: [0.6, 1.6],
  simple: [0.5, 1.7],
  concise: [0.35, 1.05],
  expand: [0.9, 2.3],
  humanise: [0.6, 1.5],
};

export function systemPrompt(mode: RewriteMode): string {
  return `You edit passages from research manuscripts.

Task: ${MODE_INSTRUCTIONS[mode]}

Rules you must follow:
1. Tokens such as {{P1}} or {{P12}} stand for citations, equations, URLs, DOIs or cross-references. Copy every one of them exactly once, unchanged, at a sensible place. Never invent new ones or remove any.
2. Keep every number, percentage, unit and statistical value exactly as written.
3. Do not add facts, claims, citations, hedges or conclusions that are not in the passage, and do not remove findings.
4. Keep the original language and spelling variety (British or American).
5. Reply with the rewritten passage only: no preface, no quotation marks around it, no notes.`;
}

export function userPrompt(passage: string, feedback: readonly string[]): string {
  const retry = feedback.length
    ? `\n\nYour previous attempt was rejected because: ${feedback.join("; ")}. Fix this and follow the rules exactly.`
    : "";
  return `Passage:\n${passage}${retry}`;
}

/** Strips code fences, prefaces such as "Here is the rewritten passage:" and wrapping quotes. */
export function cleanReply(reply: string): string {
  let out = reply.trim();
  const fenced = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(out);
  if (fenced?.[1] !== undefined) out = fenced[1].trim();
  out = out.replace(/^(?:sure[,!.]?\s*)?(?:here(?:'s| is) (?:the |a |your )?(?:rewritten|revised|paraphrased|edited|simplified|expanded|condensed|shortened)[^\n:]*:)\s*/i, "");
  out = out.replace(/^(?:rewritten|revised) (?:passage|text|version):\s*/i, "");
  if (/^["“][\s\S]*["”]$/.test(out) && !/["“”]/.test(out.slice(1, -1))) out = out.slice(1, -1).trim();
  return out;
}

export const PARAPHRASE_MODES: ReadonlyArray<{ id: RewriteMode; label: string; description: string }> = [
  { id: "academic", label: "Academic", description: "Formal rephrasing that keeps meaning and certainty." },
  { id: "simple", label: "Simple", description: "Plainer words and shorter sentences." },
  { id: "concise", label: "Concise", description: "About 30% shorter, no claims dropped." },
  { id: "expand", label: "Expand", description: "Spells out implicit steps; needs a language model." },
];
