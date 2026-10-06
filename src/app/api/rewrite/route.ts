import { rewriteText } from "@/core/rewrite/rewrite";
import { llmOverride, oneOf, readJson, route, text } from "@/server/api";
import { llmClient } from "@/server/deps";

export const runtime = "nodejs";
export const maxDuration = 300;

const MODES = ["academic", "simple", "concise", "expand", "humanise"] as const;

export const POST = route({ bucket: "rewrite", weight: 0.5 }, async ({ cfg, req }) => {
  const body = await readJson(req);
  const input = text(body, "text", { max: 60_000 });
  const mode = oneOf(body, "mode", MODES, "academic");
  const llm = await llmClient(cfg, llmOverride(body));
  return rewriteText(input, { mode, ...(llm ? { llm } : {}), signal: req.signal });
});
