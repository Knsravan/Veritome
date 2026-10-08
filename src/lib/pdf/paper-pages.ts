/**
 * The paper's own pages, with findings underlined, for the downloadable report:
 * - a PDF keeps its original pages; underlines are drawn onto them as vector lines;
 * - a Word file is laid out exactly (docx-preview) with its underlines, and photographed page by page.
 * Underline colours and styles match the screen (solid copied, dotted reworded, wavy AI, dashed citation,
 * thin grammar, double hidden copying).
 */
import type { DocxModel, PdfModel } from "../doc/model";
import type { ExactMark } from "../doc/docx-exact";

type Rgb = [number, number, number];
const hex = (c: string): Rgb => {
  const n = parseInt(c.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const SRC = ["#e0a100", "#3a8ee6", "#2fa36b", "#ee7a2f", "#d6539b", "#13a3b5"];

export type LineStyle =
  | "solid"
  | "dotted"
  | "wavy"
  | "dashed"
  | "thin"
  | "double";

/** Colour and line style for a mark, as on screen. */
export function markStyle(m: Pick<ExactMark, "className" | "group">): {
  color: string;
  style: LineStyle;
} {
  const c = m.className;
  const src = m.group ? SRC[(m.group - 1) % SRC.length]! : "#e0a100";
  if (c.includes("mark-flag")) return { color: "#dc2626", style: "double" };
  if (c.includes("mark-ai")) return { color: "#8b5cf6", style: "wavy" };
  if (c.includes("mark-grammar")) return { color: "#e5484d", style: "thin" };
  if (c.includes("mark-cite")) return { color: "#0f9f8f", style: "dashed" };
  if (c.includes("mark-para")) return { color: src, style: "dotted" };
  return { color: src, style: "solid" };
}

function zigzag(
  x0: number,
  x1: number,
  y: number,
  amp: number,
  step: number,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  let up = true;
  for (let x = x0; x <= x1; x += step) {
    pts.push([x, y + (up ? -amp : amp)]);
    up = !up;
  }
  return pts;
}

/**
 * A Word file laid out exactly and underlined, as one picture per page (JPEG data URLs with their size in points).
 */
export async function wordPages(
  doc: DocxModel,
  text: string,
  marks: ExactMark[],
): Promise<Array<{ url: string; width: number; height: number }>> {
  if (!doc.data) return [];
  const [{ renderDocx, drawMarks }, { default: html2canvas }] =
    await Promise.all([import("../doc/docx-exact"), import("html2canvas-pro")]);
  const host = document.createElement("div");
  host.className = "docx-exact docx-capture";
  // Laid out on the page (so it can be photographed) but behind everything and never seen.
  host.style.cssText =
    "position:fixed;left:0;top:0;z-index:-1000;pointer-events:none;";
  document.body.appendChild(host);
  try {
    await renderDocx(host, doc.data);
    drawMarks(host, text, marks, false);
    await document.fonts?.ready;
    const out: Array<{ url: string; width: number; height: number }> = [];
    for (const section of Array.from(
      host.querySelectorAll<HTMLElement>("section.docx"),
    )) {
      const box = section.getBoundingClientRect();
      // The underlines are part of the page as laid out, so the picture shows them in their own styles.
      const canvas = await html2canvas(section, {
        scale: 2,
        backgroundColor: "#ffffff",
        logging: false,
        useCORS: true,
      });
      out.push({
        url: canvas.toDataURL("image/jpeg", 0.88),
        width: box.width * 0.75,
        height: box.height * 0.75,
      });
    }
    return out;
  } finally {
    host.remove();
  }
}

/** A mark for the file itself: the finding's number is drawn as a badge where it starts. */
export type NumberedMark = Pick<
  ExactMark,
  "id" | "start" | "end" | "className" | "group"
> & { n?: number };

/** Curve settings per line style: every finding is drawn as a wave, heavier for copying, lighter for notes. */
const WAVE: Record<
  LineStyle,
  { amp: number; step: number; thickness: number; twice?: boolean }
> = {
  solid: { amp: 0.9, step: 1.8, thickness: 1.25 },
  dotted: { amp: 0.7, step: 1.6, thickness: 0.8 },
  wavy: { amp: 0.9, step: 1.8, thickness: 1.0 },
  dashed: { amp: 0.7, step: 2.2, thickness: 0.9 },
  thin: { amp: 0.6, step: 1.5, thickness: 0.6 },
  double: { amp: 0.7, step: 1.6, thickness: 0.7, twice: true },
};

/**
 * The original PDF with every finding underlined on its pages by a coloured curve (vector lines, so the text stays
 * sharp and selectable) and numbered where it starts, matching the numbers in the report. The pages themselves are
 * not changed in any other way. Returns the marked file's bytes.
 */
export async function annotatePdf(
  doc: PdfModel,
  marks: NumberedMark[],
): Promise<Uint8Array> {
  const [{ PDFDocument, rgb, StandardFonts }, { segmentMarks }] =
    await Promise.all([import("pdf-lib"), import("@/components/DocumentView")]);
  const pdf = await PDFDocument.load(doc.data.slice(), {
    ignoreEncryption: true,
  });
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const segs = segmentMarks(
    marks.map((m) => ({ ...m, label: "" })),
    doc.text.length,
  );
  const color = (c: string) => {
    const [r, g, b] = hex(c);
    return rgb(r, g, b);
  };
  const badged = new Set<string>();
  doc.pages.forEach((p, i) => {
    if (i >= pdf.getPageCount()) return;
    const page = pdf.getPage(i);
    if ((page.getRotation().angle ?? 0) % 360 !== 0) return;
    const crop = page.getCropBox();
    const sx = crop.width / p.width;
    const sy = crop.height / p.height;
    for (const it of p.items) {
      if (it.skipped || it.end <= it.start) continue;
      const span = it.end - it.start;
      for (const s of segs) {
        if (s.end <= it.start || s.start >= it.end || !s.marks.length) continue;
        const a = Math.max(s.start, it.start);
        const b = Math.min(s.end, it.end);
        const x0 = crop.x + (it.x + ((a - it.start) / span) * it.w) * sx;
        const x1 = crop.x + (it.x + ((b - it.start) / span) * it.w) * sx;
        s.marks.forEach((m, depth) => {
          const st = markStyle(m);
          const wave = WAVE[st.style];
          const y =
            crop.y + crop.height - (it.y + it.h * 0.95) * sy - depth * 2.4;
          const opts = { color: color(st.color), thickness: wave.thickness };
          for (const off of wave.twice ? [0, 1.8] : [0]) {
            const pts = zigzag(x0, x1, y - off, wave.amp, wave.step);
            for (let k = 1; k < pts.length; k++)
              page.drawLine({
                start: { x: pts[k - 1]![0], y: pts[k - 1]![1] },
                end: { x: pts[k]![0], y: pts[k]![1] },
                ...opts,
              });
          }
          // The finding's number, in a small badge just before where it starts.
          const nm = m as NumberedMark;
          if (nm.n !== undefined && !badged.has(nm.id) && a === nm.start) {
            badged.add(nm.id);
            const label = String(nm.n);
            const size = 5.5;
            const w = font.widthOfTextAtSize(label, size) + 4;
            const cx = Math.max(crop.x + w / 2 + 1, x0 - w / 2 - 1.5);
            const cy = crop.y + crop.height - (it.y + it.h * 0.45) * sy;
            page.drawRectangle({
              x: cx - w / 2,
              y: cy - 4,
              width: w,
              height: 8,
              color: color(st.color),
              opacity: 0.95,
            });
            page.drawText(label, {
              x: cx - w / 2 + 2,
              y: cy - 2,
              size,
              font,
              color: rgb(1, 1, 1),
            });
          }
        });
      }
    }
  });
  return pdf.save();
}

/** Puts the summary pages (made with jsPDF) and the annotated original pages together in one file. */
export async function joinPdfs(
  first: ArrayBuffer | Uint8Array,
  second: ArrayBuffer | Uint8Array,
): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (const bytes of [first, second]) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    for (const p of await out.copyPages(src, src.getPageIndices()))
      out.addPage(p);
  }
  return out.save();
}
