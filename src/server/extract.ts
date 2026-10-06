import "server-only";
import { cleanPdfText, latexToText } from "../core/text/latex.ts";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_TEXT_CHARS = 400_000;

export type DocumentKind = "txt" | "md" | "tex" | "docx" | "pdf";

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

export interface ExtractedDocument {
  kind: DocumentKind;
  text: string;
  words: number;
  truncated: boolean;
  warnings: string[];
}

/** Picks the parser from the file's first bytes, falling back to the extension. */
export function detectKind(name: string, bytes: Uint8Array): DocumentKind {
  const head = String.fromCharCode(...bytes.slice(0, 5));
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (head.startsWith("%PDF")) return "pdf";
  if (head.startsWith("PK")) {
    if (ext === "docx" || ext === "") return "docx";
    throw new ExtractionError("Only .docx files are supported among zipped formats.");
  }
  if (ext === "tex" || ext === "latex") return "tex";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "txt" || ext === "text" || ext === "") return "txt";
  if (ext === "doc") throw new ExtractionError("Old .doc files are not supported. Save the file as .docx or PDF.");
  if (ext === "docx" || ext === "pdf") throw new ExtractionError(`The file does not look like a valid .${ext} file.`);
  throw new ExtractionError(`Unsupported file type ".${ext}". Use .docx, .pdf, .tex, .md or .txt.`);
}

function decodeText(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^﻿/, "");
  if (text.includes("\u0000")) throw new ExtractionError("The file appears to be binary, not text.");
  return text;
}

/** Extracts plain text from an uploaded document. The file is processed in memory and never stored. */
export async function extractDocument(name: string, data: ArrayBuffer | Uint8Array): Promise<ExtractedDocument> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength === 0) throw new ExtractionError("The file is empty.");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new ExtractionError(`Files up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB are supported.`);
  const kind = detectKind(name, bytes);
  const warnings: string[] = [];
  let text: string;

  switch (kind) {
    case "txt":
    case "md":
      text = decodeText(bytes).replace(/\r\n?/g, "\n");
      break;
    case "tex":
      text = latexToText(decodeText(bytes));
      warnings.push("LaTeX was converted to plain text; macros defined in the preamble are not expanded.");
      break;
    case "docx": {
      const mammoth = await import("mammoth");
      try {
        const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
        text = result.value.replace(/\n{3,}/g, "\n\n").trim();
      } catch {
        throw new ExtractionError("The .docx file could not be read. It may be damaged or password-protected.");
      }
      break;
    }
    case "pdf": {
      const { extractText, getDocumentProxy } = await import("unpdf");
      try {
        const pdf = await getDocumentProxy(new Uint8Array(bytes));
        const { text: pages } = await extractText(pdf, { mergePages: false });
        text = cleanPdfText((pages as string[]).join("\n\n"));
      } catch {
        throw new ExtractionError("The PDF could not be read. It may be damaged, encrypted or a scanned image.");
      }
      warnings.push("Text extracted from PDF can contain layout artefacts such as headers, footers and broken lines.");
      if (text.replace(/\s/g, "").length < 50) {
        throw new ExtractionError("No text was found in the PDF. Scanned PDFs need OCR before they can be checked.");
      }
      break;
    }
  }

  let truncated = false;
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    truncated = true;
    warnings.push(`The document was cut to the first ${MAX_TEXT_CHARS.toLocaleString("en")} characters.`);
  }
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  if (words === 0) throw new ExtractionError("No readable text was found in the file.");
  return { kind, text, words, truncated, warnings };
}
