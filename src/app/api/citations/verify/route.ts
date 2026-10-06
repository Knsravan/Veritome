import { crossCheckCitations } from "@/core/citations/intext";
import { parseReferenceList } from "@/core/citations/parse";
import { verifyReferences } from "@/core/citations/verify";
import { splitReferences } from "@/core/text/sections";
import { BadRequest, readJson, requireConsent, route, text } from "@/server/api";
import { scholarlyHttp, verifierDeps } from "@/server/deps";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Body: {references: string, body?: string} or {text: string} with a reference list inside. */
export const POST = route({ bucket: "citations", weight: 0.25 }, async ({ cfg, req }) => {
  const body = await readJson(req);
  let refsText: string;
  let bodyText = "";
  if (typeof body.references === "string" && body.references.trim()) {
    refsText = text(body, "references", { max: 200_000 });
    if (typeof body.body === "string") bodyText = text(body, "body");
  } else {
    const split = splitReferences(text(body));
    if (!split.references) throw new BadRequest("No reference list was found. Paste the references on their own, or include a “References” heading.");
    refsText = split.references;
    bodyText = split.body;
  }
  const refs = parseReferenceList(refsText);
  if (refs.length === 0) throw new BadRequest("No references could be read from the text.");
  if (refs.length > 300) throw new BadRequest("Check up to 300 references at a time.", 413);
  requireConsent(body);
  const verification = await verifyReferences(refs, verifierDeps(cfg, scholarlyHttp(cfg)));
  return { ...verification, crossCheck: bodyText.trim() ? crossCheckCitations(bodyText, refs) : null };
});
