import { BadRequest, route } from "@/server/api";
import { extractDocument, tooLargeMessage } from "@/server/extract";

export const runtime = "nodejs";

export const POST = route({ bucket: "extract" }, async ({ cfg, req }) => {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > cfg.maxUploadBytes + 64_000) throw new BadRequest(tooLargeMessage(cfg.maxUploadBytes), 413);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new BadRequest("Upload the file as multipart form data.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new BadRequest("Choose a file to upload.");
  const doc = await extractDocument(file.name, new Uint8Array(await file.arrayBuffer()), cfg.maxUploadBytes);
  return { name: file.name, ...doc };
});
