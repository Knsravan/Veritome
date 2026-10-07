import { FIGURE_HOSTS } from "@/core/images/figures";
import { BadRequest, route } from "@/server/api";

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Fetches a published figure so the browser can compare it with the paper's images (the image hosts do not allow
 * cross-site reads). Only the figure hosts used by /api/figures are allowed, only images, and only up to 4 MB.
 */
export const GET = route({ bucket: "figure-image", weight: 2 }, async ({ req }) => {
  const raw = new URL(req.url).searchParams.get("url") ?? "";
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new BadRequest("Give the figure's address.");
  }
  if (target.protocol !== "https:" || !(FIGURE_HOSTS as readonly string[]).includes(target.hostname) || target.username || target.port) throw new BadRequest("That address is not a figure host.");
  const res = await fetch(target, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: { accept: "image/*" } });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !/^image\/(jpeg|png|gif|webp)/.test(type)) throw new BadRequest("The figure could not be fetched.", 502);
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > MAX_BYTES) throw new BadRequest("The figure is too large.", 502);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new BadRequest("The figure is too large.", 502);
  return new Response(buf, { headers: { "content-type": type, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
});
