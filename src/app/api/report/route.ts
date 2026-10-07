import { buildPaperReport, TOOL_IDS, type ReportDeps, type ReportEvent, type ToolId } from "@/core/report/report";
import { hiddenRanges, libraryDocs, llmOverride, ndjsonStream, optionalBool, readJson, requireConsent, route, text } from "@/server/api";
import { finderDeps, languageToolOptions, llmClient, plagiarismProviders, scholarlyHttp, verifierDeps } from "@/server/deps";
import { loadLibrary } from "@/server/library";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  const deps: ReportDeps = {
    library: [...(await loadLibrary(cfg.libraryDir)), ...libraryDocs(body)],
    ...(external
      ? { providers: plagiarismProviders(cfg, http, { web: optionalBool(body, "web", true) }), verifier: verifierDeps(cfg, http), finder: finderDeps(cfg, http) }
      : {}),
    ...(llm ? { llm } : {}),
    ...(lt ? { languageTool: lt } : {}),
  };
  const exclude = {
    excludeQuotes: optionalBool(body, "excludeQuotes", true),
    excludeReferences: optionalBool(body, "excludeReferences", true),
    hiddenText: hiddenRanges(body, input.length),
  };
  if (body.stream !== true) return buildPaperReport(input, deps, { tools, ...exclude, signal: req.signal });

  // Streamed as newline-delimited JSON so the page can show each check's progress while the report is built.
  return ndjsonStream(
    "report",
    (send) =>
      buildPaperReport(input, deps, {
        tools,
        ...exclude,
        signal: req.signal,
        onProgress: (tool, state) => send({ type: "progress", tool, state } satisfies ReportEvent),
        onStep: (tool, done, total) => send({ type: "step", tool, done, total } satisfies ReportEvent),
      }),
    (report) => ({ report }),
  );
});
