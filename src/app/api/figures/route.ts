import { findSourceFigures, type FigureQuery } from "@/core/images/figures";
import { BadRequest, readJson, requireConsent, route } from "@/server/api";
import { scholarlyHttp } from "@/server/deps";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Published figures of the matched sources, so the browser can compare them with the paper's images. */
export const POST = route({ bucket: "figures", weight: 0.25 }, async ({ cfg, req }) => {
  const body = await readJson(req);
  requireConsent(body);
  if (!Array.isArray(body.sources)) throw new BadRequest("Send the matched sources.");
  const sources: FigureQuery[] = [];
  for (const s of body.sources.slice(0, 6)) {
    if (!s || typeof s !== "object") continue;
    const { id, doi } = s as { id?: unknown; doi?: unknown };
    if (typeof id !== "string" || id.length > 300) continue;
    sources.push({ id, ...(typeof doi === "string" && doi.length < 300 ? { doi } : {}) });
  }
  return { sources: await findSourceFigures(sources, scholarlyHttp(cfg)) };
});
