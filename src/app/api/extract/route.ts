import { BadRequest, route } from "@/server/api";
import { extractDocument, MAX_UPLOAD_BYTES } from "@/server/extract";

export const runtime = "nodejs";

export const POST = route({ bucket: "extract" }, async ({ req }) => {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_UPLOAD_BYTES + 64_000) throw new BadRequest("Files up to 15 MB are supported.", 413);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new BadRequest("Upload the file as multipart form data.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new BadRequest("Choose a file to upload.");
  const doc = await extractDocument(file.name, new Uint8Array(await file.arrayBuffer()));
  return { name: file.name, ...doc };
});
