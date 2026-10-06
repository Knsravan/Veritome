import { findClaimsNeedingCitations, suggestCitations } from "@/core/citations/finder";
import { BadRequest, readJson, requireConsent, route, text } from "@/server/api";
import { finderDeps, scholarlyHttp } from "@/server/deps";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * {text} returns sentences that may need a citation (offline).
 * {claim, consent: true} searches scholarly databases for supporting papers.
 */
export const POST = route({ bucket: "find", weight: 0.5 }, async ({ cfg, req }) => {
  const body = await readJson(req);
  if (typeof body.claim === "string") {
    const claim = text(body, "claim", { max: 2000 });
    requireConsent(body);
    const yearFrom = Number(body.yearFrom);
    return suggestCitations(claim, finderDeps(cfg, scholarlyHttp(cfg)), {
      limit: 8,
      ...(Number.isInteger(yearFrom) && yearFrom > 1800 ? { yearFrom } : {}),
    });
  }
  if (typeof body.text !== "string") throw new BadRequest("Send either a text to scan or a claim to search for.");
  return { claims: findClaimsNeedingCitations(text(body)) };
});
