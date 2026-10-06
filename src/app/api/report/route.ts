import { buildPaperReport, TOOL_IDS, type ToolId } from "@/core/report/report";
import { libraryDocs, llmOverride, optionalBool, readJson, requireConsent, route, text } from "@/server/api";
import { finderDeps, languageToolOptions, llmClient, plagiarismProviders, scholarlyHttp, verifierDeps } from "@/server/deps";
import { loadLibrary } from "@/server/library";

export const runtime = "nodejs";
export const maxDuration = 600;

export const POST = route({ bucket: "report", weight: 0.1 }, async ({ cfg, req }) => {
  const body = await readJson(req);
  const input = text(body);
  const external = optionalBool(body, "external", true);
  if (external) requireConsent(body);
  const tools: Partial<Record<ToolId, boolean>> = {};
  if (body.tools && typeof body.tools === "object") {
    for (const id of TOOL_IDS) {
      const v = (body.tools as Record<string, unknown>)[id];
      if (typeof v === "boolean") tools[id] = v;
    }
  }
  const http = scholarlyHttp(cfg);
  const llm = optionalBool(body, "useLlm", true) ? await llmClient(cfg, llmOverride(body)) : undefined;
  const lt = languageToolOptions(cfg);
  return buildPaperReport(
    input,
    {
      library: [...(await loadLibrary(cfg.libraryDir)), ...libraryDocs(body)],
      ...(external
        ? { providers: plagiarismProviders(cfg, http, { web: optionalBool(body, "web", true) }), verifier: verifierDeps(cfg, http), finder: finderDeps(cfg, http) }
        : {}),
      ...(llm ? { llm } : {}),
      ...(lt ? { languageTool: lt } : {}),
    },
    { tools, signal: req.signal },
  );
});
