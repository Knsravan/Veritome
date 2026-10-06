import { checkGrammar } from "@/core/grammar/check";
import { optionalBool, readJson, route, stringList, text } from "@/server/api";
import { languageToolOptions } from "@/server/deps";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = route({ bucket: "grammar" }, async ({ cfg, req }) => {
  const body = await readJson(req);
  const input = text(body);
  const lt = optionalBool(body, "languageTool", true) ? languageToolOptions(cfg) : undefined;
  return checkGrammar(input, {
    ignoreWords: stringList(body, "ignoreWords"),
    disabledRules: stringList(body, "disabledRules"),
    ...(lt ? { languageTool: { ...lt, language: typeof body.language === "string" ? body.language.slice(0, 10) : "en-US", signal: req.signal } } : {}),
  });
});
