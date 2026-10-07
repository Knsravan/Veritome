import { buildPaperReport, TOOL_IDS, type ReportDeps, type ReportEvent, type ToolId } from "@/core/report/report";
import { libraryDocs, llmOverride, optionalBool, readJson, requireConsent, route, text } from "@/server/api";
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
  if (body.stream !== true) return buildPaperReport(input, deps, { tools, signal: req.signal });

  // Streamed as newline-delimited JSON so the page can show each check's progress while the report is built.
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ReportEvent) => {
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The client went away; the abort signal stops the remaining work.
        }
      };
      try {
        const report = await buildPaperReport(input, deps, {
          tools,
          signal: req.signal,
          onProgress: (tool, state) => send({ type: "progress", tool, state }),
          onStep: (tool, done, total) => send({ type: "step", tool, done, total }),
        });
        send({ type: "result", report });
      } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError";
        if (!aborted) console.error(`[veritome] report failed: ${err instanceof Error ? err.name : "unknown error"}`);
        send({ type: "error", error: aborted ? "The request was cancelled." : "Something went wrong on the server. Try again, or with a shorter text." });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
});
