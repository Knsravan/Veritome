import { checkPlagiarism } from "@/core/plagiarism/check";
import { llmTranslator } from "@/core/plagiarism/translated";
import { ownAuthor, hiddenRanges, libraryDocs, llmOverride, ndjsonStream, optionalBool, readJson, requireConsent, route, text } from "@/server/api";
import { fullTextFetcher, webPageFetcher, llmClient, ownWorks, plagiarismProviders, scholarlyHttp } from "@/server/deps";
import { loadLibrary } from "@/server/library";

export const runtime = "nodejs";
export const maxDuration = 300;

const OWN_MISSING = "Your earlier papers could not be found (check the ORCID iD or name, or try again later), so the self-plagiarism check did not run.";

export const POST = route({ bucket: "plagiarism", weight: 0.25 }, async ({ cfg, req }) => {
  const body = await readJson(req);
  const input = text(body);
  const external = optionalBool(body, "external", true);
  if (external) requireConsent(body);
  const library = [...(await loadLibrary(cfg.libraryDir)), ...libraryDocs(body)];
  const http = scholarlyHttp(cfg);
  const providers = external ? plagiarismProviders(cfg, http, { web: optionalBool(body, "web", true) }) : [];
  const llm = external && optionalBool(body, "useLlm", true) ? await llmClient(cfg, llmOverride(body)) : undefined;
  const own = external ? await ownWorks(cfg, http, ownAuthor(body), req.signal) : undefined;
  const options = {
    ...(own ? { own } : ownAuthor(body) && external ? { notes: [OWN_MISSING] } : {}),
    providers,
    library,
    ...(external ? { fullText: fullTextFetcher(cfg, http), webPage: webPageFetcher(cfg) } : {}),
    ...(llm ? { translate: llmTranslator(llm) } : {}),
    excludeQuotes: optionalBool(body, "excludeQuotes", true),
    excludeReferences: optionalBool(body, "excludeReferences", true),
    hiddenText: hiddenRanges(body, input.length),
    signal: req.signal,
  };
  if (body.stream !== true) return checkPlagiarism(input, options);
  return ndjsonStream(
    "plagiarism",
    (send) => checkPlagiarism(input, { ...options, onProgress: (done, total) => send({ type: "step", done, total }) }),
    (report) => ({ report }),
  );
});
