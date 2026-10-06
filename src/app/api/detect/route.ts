import { detectAiText } from "@/core/detector/detect";
import { llmOverride, optionalBool, readJson, route, text } from "@/server/api";
import { llmClient } from "@/server/deps";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = route({ bucket: "detect" }, async ({ cfg, req }) => {
  const body = await readJson(req);
  const input = text(body);
  const llm = optionalBool(body, "useLlm") ? await llmClient(cfg, llmOverride(body)) : undefined;
  const result = await detectAiText(input, { ...(llm ? { llm } : {}), signal: req.signal });
  if (optionalBool(body, "useLlm") && !llm) result.warnings.push("No language model is configured, so only statistical signals were used.");
  return result;
});
