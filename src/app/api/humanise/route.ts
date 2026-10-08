import {
  humaniseParagraph,
  type HumaniseStrength,
  type HumaniseTone,
} from "@/core/rewrite/humanise";
import { LlmNotConfiguredError } from "@/core/llm/client";
import {
  BadRequest,
  clientKey,
  llmOverride,
  oneOf,
  readJson,
  route,
  text,
} from "@/server/api";
import { llmClient } from "@/server/deps";

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

/** Words each visitor may humanise per day on this server instance, so a public site's model bill stays bounded. */
const DAILY_WORDS =
  Number(process.env.HUMANISE_DAILY_WORDS) > 0
    ? Number(process.env.HUMANISE_DAILY_WORDS)
    : 30_000;
const g = globalThis as typeof globalThis & {
  __veritomeHumaniseUse?: Map<string, number>;
};
const use = (g.__veritomeHumaniseUse ??= new Map<string, number>());

function spend(key: string, words: number): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const k = `${day}|${key}`;
  if (use.size > 50_000) use.clear();
  const used = use.get(k) ?? 0;
  if (used + words > DAILY_WORDS) return false;
  use.set(k, used + words);
  return true;
}

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
    const words = paragraph.split(/\s+/).filter(Boolean).length;
    if (!spend(clientKey(req, cfg.trustProxy), words)) {
      throw new BadRequest(
        `The daily limit of ${DAILY_WORDS.toLocaleString("en")} words for the Humaniser has been reached. Try again tomorrow.`,
        429,
      );
    }
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
