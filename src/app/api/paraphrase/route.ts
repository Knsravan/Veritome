import { LlmNotConfiguredError } from "@/core/llm/client";
import {
  paraphraseParagraph,
  sentenceAlternatives,
  synonymsInContext,
  type ParaphraseStrength,
  type ParaphraseStyle,
} from "@/core/rewrite/paraphrase";
import { clientKey, llmOverride, oneOf, readJson, route, text } from "@/server/api";
import { llmClient } from "@/server/deps";
import { spendHumaniseWords } from "@/server/humanise-usage";

export const runtime = "nodejs";
export const maxDuration = 120;

const STYLES = ["standard", "fluent", "academic", "formal", "simple", "shorter", "longer"] as const satisfies readonly ParaphraseStyle[];
const STRENGTHS = ["light", "medium", "strong"] as const satisfies readonly ParaphraseStrength[];

const keepList = (body: Record<string, unknown>) =>
  Array.isArray(body.keep)
    ? body.keep.filter((k): k is string => typeof k === "string" && k.trim().length > 0).map((k) => k.slice(0, 80)).slice(0, 30)
    : [];

/**
 * The Paraphraser. `paraphrase` rewords one paragraph (the browser sends the text paragraph by paragraph);
 * `alternatives` gives other ways to say one sentence; `synonyms` gives words that fit in place of one word.
 */
export const POST = route({ bucket: "humanise", weight: 1 }, async ({ cfg, req }) => {
  const body = await readJson(req);
  const action = oneOf(body, "action", ["paraphrase", "alternatives", "synonyms"] as const, "paraphrase");
  const llm = await llmClient(cfg, llmOverride(body));
  if (!llm) throw new LlmNotConfiguredError();
  const visitor = clientKey(req, cfg.trustProxy);
  const style = oneOf(body, "style", STYLES, "standard");
  const keep = keepList(body);
  if (action === "synonyms") {
    const word = text(body, "word", { max: 60 });
    const sentence = text(body, "sentence", { max: 1_000 });
    spendHumaniseWords(visitor, word);
    return { options: await synonymsInContext(word, sentence, llm, req.signal) };
  }
  if (action === "alternatives") {
    const sentence = text(body, "sentence", { max: 1_500 });
    const context = typeof body.context === "string" ? body.context.slice(0, 2_000) : sentence;
    spendHumaniseWords(visitor, sentence);
    return { options: await sentenceAlternatives(sentence, context, { style, llm, keep, signal: req.signal }) };
  }
  const paragraph = text(body, "text", { max: 6_000 });
  spendHumaniseWords(visitor, paragraph);
  return paraphraseParagraph(paragraph, {
    style,
    strength: oneOf(body, "strength", STRENGTHS, "medium"),
    llm,
    keep,
    signal: req.signal,
  });
});
