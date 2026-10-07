import type { DocModel } from "./model";

export type { DocModel } from "./model";

/** Largest file read in the browser. Only the text is sent to the server, so this can be far above the upload limit. */
export const MAX_LOCAL_BYTES = 60 * 1024 * 1024;

/**
 * Reads a .docx or .pdf file in the browser, keeping its layout. Returns null for other formats, which are
 * converted on the server instead.
 */
export async function readDocument(file: File): Promise<DocModel | null> {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = String.fromCharCode(...bytes.slice(0, 5));
  if (head.startsWith("%PDF")) {
    const { readPdf } = await import("./pdf");
    return readPdf(file.name, bytes);
  }
  if (head.startsWith("PK") && (ext === "docx" || ext === "")) {
    const { readDocx } = await import("./docx");
    return readDocx(file.name, bytes);
  }
  return null;
}
