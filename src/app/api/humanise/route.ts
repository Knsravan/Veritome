import {
  humaniseParagraph,
  type HumaniseStrength,
  type HumaniseTone,
} from "@/core/rewrite/humanise";
import { LlmNotConfiguredError } from "@/core/llm/client";
import {
  clientKey,
  llmOverride,
  oneOf,
  readJson,
  route,
  text,
} from "@/server/api";
import { llmClient } from "@/server/deps";
import { spendHumaniseWords } from "@/server/humanise-usage";

export const runtime = "nodejs";
export const maxDuration = 120;

const TONES = [
  "academic",
  "natural",
  "simple",
] as const satisfies readonly HumaniseTone[];
const STRENGTHS = [
  "light",
  "balanced",
  "strong",
] as const satisfies readonly HumaniseStrength[];

const optional = (body: Record<string, unknown>, key: string, max: number) => {
  const v = body[key];
  return typeof v === "string" && v.trim() ? v.slice(0, max) : undefined;
};

/** Humanises one paragraph. The browser sends the paper paragraph by paragraph, so long papers never time out. */
export const POST = route(
  { bucket: "humanise", weight: 2 },
  async ({ cfg, req }) => {
    const body = await readJson(req);
    const paragraph = text(body, "text", { max: 6_000 });
    const tone = oneOf(body, "tone", TONES, "academic");
    const strength = oneOf(body, "strength", STRENGTHS, "balanced");
    const llm = await llmClient(cfg, llmOverride(body));
    if (!llm) throw new LlmNotConfiguredError();
    spendHumaniseWords(clientKey(req, cfg.trustProxy), paragraph);
    const voice = optional(body, "voice", 12_000);
    const before = optional(body, "before", 1_500);
    const after = optional(body, "after", 1_500);
    return humaniseParagraph(paragraph, {
      tone,
      strength,
      llm,
      ...(voice ? { voice } : {}),
      context: { ...(before ? { before } : {}), ...(after ? { after } : {}) },
      signal: req.signal,
    });
  },
);
