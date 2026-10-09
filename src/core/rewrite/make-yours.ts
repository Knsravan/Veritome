/**
 * "Make it yours": helps an author turn a generic paragraph into their own. The model points out the vague,
 * generic sentences and asks the author a few questions only they can answer (what exactly they did, measured,
 * found, chose and why). The author answers in their own words, and the answers are written into the paragraph
 * with their phrasing kept. Nothing is added that the author did not say.
 */
import type { LlmClient } from "../llm/client.ts";
import { extractJson } from "../llm/client.ts";
import { checkNumbersPreserved, protect, restore } from "../text/protect.ts";
import { countWords } from "../text/tokens.ts";
import { cleanReply } from "./prompts.ts";
import { plainCleanup, type HumaniseTone } from "./humanise.ts";

export interface MakeYoursQuestion {
  /** The generic sentence or phrase the question is about, quoted from the paragraph. */
  quote: string;
  question: string;
  /** Why answering makes the paragraph better, in a few words. */
  why: string;
}

const ASK_SYSTEM = `You help a researcher make a paragraph of their manuscript genuinely their own. Find the places where the paragraph is generic: vague claims, stock statements that could appear in any paper, missing specifics. For each, ask the author one short, concrete question that only they can answer from their own work: what exactly they did, measured, observed or found, which numbers, settings, data or examples, what went wrong or surprised them, and why they made a choice.

Rules:
- Ask 2 or 3 questions, the most useful first. Never ask more than 3.
- Each question must be answerable in a sentence or two from the author's own knowledge. Do not ask for opinions about the field, and do not suggest answers.
- Quote the exact words from the paragraph that each question is about.
- If the paragraph is already specific, ask fewer questions.

Reply with JSON only: {"questions": [{"quote": "exact words from the paragraph", "question": "...", "why": "a few words on what it adds"}]}`;

/** Asks the model for questions that draw the author's own specifics into the paragraph. */
export async function makeYoursQuestions(paragraph: string, llm: LlmClient, signal?: AbortSignal): Promise<MakeYoursQuestion[]> {
  const reply = await llm.chat({
    system: ASK_SYSTEM,
    user: `Paragraph:\n${paragraph}`,
    temperature: 0.3,
    json: true,
    ...(signal ? { signal } : {}),
  });
  const parsed = extractJson<{ questions?: unknown }>(reply);
  const list = Array.isArray(parsed?.questions) ? parsed.questions : [];
  return list
    .filter((q): q is Record<string, unknown> => Boolean(q) && typeof q === "object")
    .map((q) => ({
      quote: typeof q.quote === "string" ? q.quote.slice(0, 300) : "",
      question: typeof q.question === "string" ? q.question.slice(0, 300) : "",
      why: typeof q.why === "string" ? q.why.slice(0, 160) : "",
    }))
    .filter((q) => q.question.trim())
    .slice(0, 3);
}

const TONE_NOTE: Record<HumaniseTone, string> = {
  academic: "Keep the paragraph's academic register, in plain, exact words.",
  natural: "Keep it clear and direct.",
  simple: "Keep it in plain language with short sentences.",
};

function weaveSystem(tone: HumaniseTone): string {
  return `You help a researcher put their own specifics into a paragraph of their manuscript. You get the paragraph and the author's answers to a few questions about it. Revise the paragraph so it includes what the author said.

Rules you must follow:
1. Use the author's own words from the answers wherever they work in the sentence; change them only as much as grammar needs. Their phrasing is the point.
2. Add only facts that are in the paragraph or in the answers. Do not invent details, numbers, results, examples, reasons or citations, and do not embellish what the author said.
3. Replace the generic wording the answers make unnecessary, and keep everything else in the paragraph.
4. Tokens such as {{P1}} stand for citations, equations or links. Copy every one exactly once, unchanged.
5. Keep every number from the paragraph and the answers exactly as written.
6. ${TONE_NOTE[tone]} Use the plainest accurate word; no fancy synonyms, no stock phrases.
7. Reply with the revised paragraph only.`;
}

const WEAVE_CHECK = `You check an edit of a paragraph from a research manuscript. The author answered some questions, and the edit should add what the author said to the paragraph and nothing else.

The edit fails if it adds any fact, number, result, example, reason or claim that is in neither the original paragraph nor the author's answers, drops a finding, qualification or citation placeholder (such as {{P3}}) from the original, or changes a number.

Reply with JSON only: {"ok": true or false, "problems": ["short description of each problem"]}`;

export interface MakeYoursAnswer {
  question: string;
  answer: string;
}

export interface MakeYoursResult {
  text: string;
  status: "rewritten" | "kept_original";
  problems: string[];
}

/** Writes the author's answers into the paragraph, checking that nothing else was added. */
export async function makeYoursWeave(
  paragraph: string,
  answers: readonly MakeYoursAnswer[],
  options: { tone: HumaniseTone; llm: LlmClient; retries?: number; signal?: AbortSignal },
): Promise<MakeYoursResult> {
  const given = answers.filter((a) => a.answer.trim());
  if (!given.length) return { text: paragraph, status: "kept_original", problems: ["No answers were given."] };
  const { masked, spans } = protect(paragraph);
  const answersBlock = given.map((a, i) => `Q${i + 1}: ${a.question}\nAuthor's answer: ${a.answer.trim()}`).join("\n\n");
  const answerText = given.map((a) => a.answer).join(" ");
  const feedback: string[] = [];
  const problems: string[] = [];
  const retries = Math.max(0, options.retries ?? 2);
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    if (options.signal?.aborted) break;
    const retry = feedback.length ? `\n\nYour previous attempt was rejected because: ${feedback.join("; ")}. Fix this.` : "";
    let reply: string;
    try {
      reply = await options.llm.chat({
        system: weaveSystem(options.tone),
        user: `Paragraph:\n${masked}\n\nThe author's answers:\n${answersBlock}${retry}`,
        temperature: attempt === 1 ? 0.5 : 0.3,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (err) {
      problems.push(err instanceof Error ? err.message : "The model call failed.");
      break;
    }
    const output = plainCleanup(cleanReply(reply));
    const mechanical: string[] = [];
    const want = [...masked.matchAll(/\{\{P(\d+)\}\}/g)].map((m) => m[1]);
    const got = [...output.matchAll(/\{\{P(\d+)\}\}/g)].map((m) => m[1]);
    const lost = want.filter((id) => !got.includes(id));
    if (lost.length) mechanical.push(`placeholders ${lost.map((i) => `{{P${i}}}`).join(", ")} are missing`);
    if (got.some((id, i) => !want.includes(id) || got.indexOf(id) !== i)) mechanical.push("a placeholder was invented or repeated");
    // Numbers may come from the paragraph or the answers, and none from the paragraph may be lost.
    const fromSources = checkNumbersPreserved(`${masked} ${answerText}`.replace(/\{\{P\d+\}\}/g, " "), output.replace(/\{\{P\d+\}\}/g, " "));
    if (fromSources.added.length) mechanical.push(`the number(s) ${fromSources.added.join(", ")} are not in the paragraph or the answers`);
    const kept = checkNumbersPreserved(masked.replace(/\{\{P\d+\}\}/g, " "), output.replace(/\{\{P\d+\}\}/g, " "));
    if (kept.missing.length) mechanical.push(`the number(s) ${kept.missing.join(", ")} were dropped`);
    if (countWords(output) < countWords(masked) * 0.6) mechanical.push("too much of the paragraph was removed");
    if (mechanical.length) {
      problems.push(`attempt ${attempt}: ${mechanical.join("; ")}`);
      feedback.splice(0, feedback.length, ...mechanical);
      continue;
    }
    const verdict = await checkWeave(options.llm, masked, answersBlock, output, options.signal);
    if (verdict && !verdict.ok) {
      const why = verdict.problems.length ? verdict.problems : ["it added something the author did not say"];
      problems.push(`attempt ${attempt}: ${why.join("; ")}`);
      feedback.splice(0, feedback.length, ...why);
      continue;
    }
    return { text: restore(output, spans).text, status: "rewritten", problems };
  }
  return { text: paragraph, status: "kept_original", problems };
}

async function checkWeave(
  llm: LlmClient,
  original: string,
  answers: string,
  edited: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; problems: string[] } | null> {
  try {
    const reply = await llm.chat({
      system: WEAVE_CHECK,
      user: `Original paragraph:\n${original}\n\nThe author's answers:\n${answers}\n\nEdited paragraph:\n${edited}`,
      temperature: 0,
      json: true,
      ...(signal ? { signal } : {}),
    });
    const parsed = extractJson<{ ok?: unknown; problems?: unknown }>(reply);
    if (!parsed || typeof parsed.ok !== "boolean") return null;
    return {
      ok: parsed.ok,
      problems: Array.isArray(parsed.problems) ? parsed.problems.filter((p): p is string => typeof p === "string").slice(0, 5) : [],
    };
  } catch {
    return null;
  }
}
