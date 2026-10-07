/**
 * A document read in the browser with its layout kept, so a report can show the paper as it looks while the
 * checks run on its plain text. Every piece of text carries its offsets into `text`, the exact string that was
 * checked, so findings can be drawn back onto the original layout.
 */

export interface Run {
  text: string;
  start: number;
  end: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  script?: "sup" | "sub";
  /** In the file but invisible on the page (hidden, white or tiny text). */
  hidden?: boolean;
  href?: string;
}

export type ParagraphStyle = "title" | "h1" | "h2" | "h3" | "h4" | "normal" | "caption" | "quote";

export interface Paragraph {
  kind: "p";
  style: ParagraphStyle;
  align?: "center" | "right" | "justify";
  list?: { ordered: boolean; level: number };
  runs: Run[];
}

export interface Table {
  kind: "table";
  /** Rows of cells; each cell holds paragraphs. */
  rows: Paragraph[][][];
}

export interface Figure {
  kind: "image";
  imageId: string;
}

export type Block = Paragraph | Table | Figure;

export interface DocImage {
  id: string;
  /** A URL the browser can show (object or data URL), or empty when the format cannot be shown. */
  src: string;
  mime: string;
  /** Raw file bytes, for image checks. */
  bytes: Uint8Array;
  name: string;
  /** PDF page the image is on. */
  page?: number;
}

export interface DocxModel {
  kind: "docx";
  name: string;
  /** The original file, to show it in its exact layout. */
  data?: Uint8Array;
  text: string;
  blocks: Block[];
  images: DocImage[];
  hidden: Array<{ start: number; end: number }>;
  warnings: string[];
}

/** One run of text on a PDF page, in PDF points with the origin at the top left. */
export interface PdfItem {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Offsets of this item's characters in the checked text; end - start may be shorter than the item when a line-end hyphen was dropped. */
  start: number;
  end: number;
  /** Number of characters the item shows on the page. */
  chars: number;
  /** Repeated header, footer or page number, left out of the checked text. */
  skipped?: boolean;
}

export interface PdfPage {
  number: number;
  width: number;
  height: number;
  items: PdfItem[];
}

export interface PdfModel {
  kind: "pdf";
  name: string;
  text: string;
  pages: PdfPage[];
  images: DocImage[];
  hidden: Array<{ start: number; end: number }>;
  warnings: string[];
  /** The original file, to draw the pages. */
  data: Uint8Array;
}

export type DocModel = DocxModel | PdfModel;

/** Builds the checked text piece by piece, handing back each piece's offsets. */
export class TextBuilder {
  private parts: string[] = [];
  length = 0;
  add(s: string): { start: number; end: number } {
    const start = this.length;
    this.parts.push(s);
    this.length += s.length;
    return { start, end: this.length };
  }
  /** Ends the current block: blocks are separated by one blank line. */
  breakBlock() {
    if (this.length === 0) return;
    const tail = this.parts[this.parts.length - 1] ?? "";
    if (tail.endsWith("\n\n")) return;
    this.add(tail.endsWith("\n") ? "\n" : "\n\n");
  }
  toString() {
    return this.parts.join("");
  }
}

export function imageUrl(bytes: Uint8Array, mime: string): string {
  if (!/^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/.test(mime)) return "";
  const blob = new Blob([bytes as BlobPart], { type: mime });
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    try {
      return URL.createObjectURL(blob);
    } catch {
      // Fall through to a data URL.
    }
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

export const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  emf: "image/emf",
  wmf: "image/wmf",
};
