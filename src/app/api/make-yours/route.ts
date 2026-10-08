import { LlmNotConfiguredError } from "@/core/llm/client";
import type { HumaniseTone } from "@/core/rewrite/humanise";
import { makeYoursQuestions, makeYoursWeave, type MakeYoursAnswer } from "@/core/rewrite/make-yours";
import { BadRequest, clientKey, llmOverride, oneOf, readJson, route, text } from "@/server/api";
import { llmClient } from "@/server/deps";
import { spendHumaniseWords } from "@/server/humanise-usage";

export const runtime = "nodejs";
export const maxDuration = 120;

const TONES = ["academic", "natural", "simple"] as const satisfies readonly HumaniseTone[];

function readAnswers(body: Record<string, unknown>): MakeYoursAnswer[] {
  const v = body.answers;
  if (!Array.isArray(v)) throw new BadRequest('"answers" must be a list.');
  return v
    .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
    .map((a) => ({
      question: typeof a.question === "string" ? a.question.slice(0, 300) : "",
      answer: typeof a.answer === "string" ? a.answer.slice(0, 2_000) : "",
    }))
    .slice(0, 3);
}

/** "Make it yours": `ask` returns questions about a paragraph; `write` puts the author's answers into it. */
export const POST = route({ bucket: "humanise", weight: 2 }, async ({ cfg, req }) => {
  const body = await readJson(req);
  const paragraph = text(body, "text", { max: 6_000 });
  const action = oneOf(body, "action", ["ask", "write"] as const);
  const llm = await llmClient(cfg, llmOverride(body));
  if (!llm) throw new LlmNotConfiguredError();
  const visitor = clientKey(req, cfg.trustProxy);
  if (action === "ask") {
    spendHumaniseWords(visitor, paragraph);
    return { questions: await makeYoursQuestions(paragraph, llm, req.signal) };
  }
  const answers = readAnswers(body);
  spendHumaniseWords(visitor, `${paragraph} ${answers.map((a) => a.answer).join(" ")}`);
  return makeYoursWeave(paragraph, answers, { tone: oneOf(body, "tone", TONES, "academic"), llm, signal: req.signal });
});
