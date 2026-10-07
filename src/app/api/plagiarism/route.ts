import { checkPlagiarism } from "@/core/plagiarism/check";
import { libraryDocs, ndjsonStream, optionalBool, readJson, requireConsent, route, text } from "@/server/api";
import { plagiarismProviders, scholarlyHttp } from "@/server/deps";
import { loadLibrary } from "@/server/library";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = route({ bucket: "plagiarism", weight: 0.25 }, async ({ cfg, req }) => {
  const body = await readJson(req);
  const input = text(body);
  const external = optionalBool(body, "external", true);
  if (external) requireConsent(body);
  const library = [...(await loadLibrary(cfg.libraryDir)), ...libraryDocs(body)];
  const providers = external ? plagiarismProviders(cfg, scholarlyHttp(cfg), { web: optionalBool(body, "web", true) }) : [];
  const options = {
    providers,
    library,
    excludeQuotes: optionalBool(body, "excludeQuotes", true),
    excludeReferences: optionalBool(body, "excludeReferences", true),
    signal: req.signal,
  };
  if (body.stream !== true) return checkPlagiarism(input, options);
  return ndjsonStream(
    "plagiarism",
    (send) => checkPlagiarism(input, { ...options, onProgress: (done, total) => send({ type: "step", done, total }) }),
    (report) => ({ report }),
  );
});
