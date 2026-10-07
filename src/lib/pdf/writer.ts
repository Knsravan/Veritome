import type { jsPDF } from "jspdf";

/** Light-mode chart and status colours, matching the page (see globals.css). */
export const PDF_COLORS = {
  ink: "#1c2733",
  soft: "#4a5868",
  faint: "#6b7787",
  rule: "#d5dce5",
  track: "#e6eaef",
  action: "#1d4e89",
  critical: "#d03b3b",
  serious: "#ec835a",
  warning: "#fab219",
  neutral: "#c9cfd6",
  seq: "#2a78d6",
  ai: "#b8338a",
  human: "#2a78d6",
  // Highlight tints for the marked-up text.
  tintCritical: "#f7d4d4",
  tintSerious: "#fbe0d3",
  tintWarning: "#fdeec7",
  tintNeutral: "#e6e9ee",
} as const;

let unicode = false;

/** The standard PDF fonts only cover Latin-1 plus a few typographic marks; anything else becomes "?". With the
 * embedded DejaVu fonts loaded (see loadUnicodeFonts), Greek letters, maths symbols and most scripts print as they are. */
export function pdfSafe(s: string): string {
  if (unicode) return s.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "");
  return s
    .replace(/[‐‑‒]/g, "-")
    .replace(/ /g, " ")
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff–—‘’“”…•]/g, "?");
}

const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const FONT_FILES: Array<[file: string, family: string, style: string]> = [
  ["DejaVuSans.ttf", "DejaVuSans", "normal"],
  ["DejaVuSans-Bold.ttf", "DejaVuSans", "bold"],
  ["DejaVuSans-Oblique.ttf", "DejaVuSans", "italic"],
  ["DejaVuSerif.ttf", "DejaVuSerif", "normal"],
  ["DejaVuSerif-Italic.ttf", "DejaVuSerif", "italic"],
];

function base64(bytes: ArrayBuffer): string {
  const u = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Embeds fonts that cover Greek, maths symbols and most scripts, so a paper's μ, ν, ≤ or names in other
 * alphabets print correctly. Falls back to the standard fonts (with "?" for such characters) if they cannot load.
 */
export async function loadUnicodeFonts(doc: jsPDF, baseUrl = "/fonts/"): Promise<boolean> {
  unicode = false;
  if (typeof fetch !== "function") return false;
  try {
    const files = await Promise.all(FONT_FILES.map(async ([f]) => {
      const r = await fetch(`${baseUrl}${f}`);
      if (!r.ok) throw new Error(f);
      return r.arrayBuffer();
    }));
    FONT_FILES.forEach(([f, family, style], i) => {
      doc.addFileToVFS(f, base64(files[i]!));
      doc.addFont(f, family, style);
    });
    unicode = true;
  } catch {
    unicode = false;
  }
  return unicode;
}

export interface Mark {
  start: number;
  end: number;
  /** Background tint behind the words. */
  fill?: string;
  /** A short tag printed after the passage, such as a source number. */
  tag?: string;
  tagColor?: string;
}

/** A small layout engine over jsPDF: flowing text, headings, tables and simple charts with page breaks. */
export class PdfWriter {
  readonly doc: jsPDF;
  readonly margin = 48;
  y: number;
  readonly width: number;
  readonly height: number;

  constructor(doc: jsPDF) {
    this.doc = doc;
    this.width = doc.internal.pageSize.getWidth();
    this.height = doc.internal.pageSize.getHeight();
    this.y = this.margin;
  }

  get content() {
    return this.width - this.margin * 2;
  }

  ensure(h: number) {
    if (this.y + h > this.height - this.margin - 14) {
      this.doc.addPage();
      this.y = this.margin;
    }
  }

  color(c: string) {
    this.doc.setTextColor(...hex(c));
  }

  fill(c: string) {
    this.doc.setFillColor(...hex(c));
  }

  font(size: number, style: "normal" | "bold" | "italic" = "normal", family: "helvetica" | "times" = "helvetica") {
    if (unicode) {
      // DejaVu has no bold serif in this set; bold text uses the sans.
      const fam = family === "times" && style !== "bold" ? "DejaVuSerif" : "DejaVuSans";
      this.doc.setFont(fam, style);
    } else this.doc.setFont(family, style);
    this.doc.setFontSize(size);
  }

  space(h: number) {
    this.y += h;
  }

  heading(text: string, size = 15) {
    this.ensure(size * 2.4);
    this.space(size * 0.6);
    this.font(size, "bold");
    this.color(PDF_COLORS.ink);
    this.doc.text(pdfSafe(text), this.margin, this.y + size);
    this.y += size * 1.5;
  }

  /** Wrapped paragraph text. */
  text(text: string, opts: { size?: number; color?: string; style?: "normal" | "bold" | "italic"; family?: "helvetica" | "times"; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const indent = opts.indent ?? 0;
    this.font(size, opts.style ?? "normal", opts.family ?? "helvetica");
    this.color(opts.color ?? PDF_COLORS.ink);
    const lines = this.doc.splitTextToSize(pdfSafe(text), this.content - indent) as string[];
    const lh = size * 1.35;
    for (const line of lines) {
      this.ensure(lh);
      this.doc.text(line, this.margin + indent, this.y + size);
      this.y += lh;
    }
    this.y += opts.gap ?? 4;
  }

  rule() {
    this.ensure(10);
    this.doc.setDrawColor(...hex(PDF_COLORS.rule));
    this.doc.setLineWidth(0.6);
    this.doc.line(this.margin, this.y + 4, this.width - this.margin, this.y + 4);
    this.y += 10;
  }

  /** Big headline number with a caption, at x within the current row. */
  figure(x: number, value: string, label: string, caption: string, width = this.content / 2 - 12) {
    this.font(30, "bold");
    this.color(PDF_COLORS.ink);
    this.doc.text(pdfSafe(value), x, this.y + 28);
    this.font(10, "bold");
    this.doc.text(pdfSafe(label), x, this.y + 44);
    this.font(8.5);
    this.color(PDF_COLORS.soft);
    const lines = this.doc.splitTextToSize(pdfSafe(caption), width) as string[];
    lines.forEach((l, i) => this.doc.text(l, x, this.y + 56 + i * 11));
  }

  /** Part-to-whole bar with a legend; values are percentages of 100. */
  stackedBar(segments: Array<{ label: string; value: number; color: string }>) {
    this.ensure(46);
    const h = 9;
    const x0 = this.margin;
    this.fill(PDF_COLORS.track);
    this.doc.roundedRect(x0, this.y, this.content, h, 4.5, 4.5, "F");
    let x = x0;
    const shown = segments.filter((s) => s.value > 0);
    shown.forEach((s, i) => {
      const w = Math.max(1.5, (s.value / 100) * this.content - (i < shown.length - 1 ? 2 : 0));
      this.fill(s.color);
      this.doc.rect(x, this.y, w, h, "F");
      x += w + 2;
    });
    this.y += h + 8;
    let lx = x0;
    this.font(8.5);
    for (const s of segments) {
      const label = pdfSafe(`${s.label}: ${Math.round(s.value * 10) / 10}%`);
      const w = this.doc.getTextWidth(label) + 18;
      if (lx + w > this.width - this.margin) {
        lx = x0;
        this.y += 13;
      }
      this.fill(s.color);
      this.doc.circle(lx + 3.5, this.y + 3.5, 3.5, "F");
      this.color(PDF_COLORS.ink);
      this.doc.text(label, lx + 10, this.y + 6.5);
      lx += w;
    }
    this.y += 18;
  }

  /** One column per item along the document, with an optional threshold line. Values are 0 to 1. */
  columns(title: string, values: number[], color: string, threshold?: number) {
    const h = 56;
    this.ensure(h + 34);
    this.font(9, "bold");
    this.color(PDF_COLORS.ink);
    this.doc.text(pdfSafe(title), this.margin, this.y + 9);
    this.y += 16;
    const base = this.y + h;
    const slot = this.content / Math.max(1, values.length);
    const bw = Math.min(14, Math.max(2, slot - 2));
    values.forEach((v, i) => {
      const bh = Math.max(v > 0 ? 2 : 0.8, v * h);
      this.fill(v > 0 ? color : PDF_COLORS.rule);
      this.doc.rect(this.margin + i * slot + (slot - bw) / 2, base - bh, bw, bh, "F");
    });
    this.doc.setDrawColor(...hex(PDF_COLORS.rule));
    this.doc.setLineWidth(0.6);
    this.doc.line(this.margin, base, this.width - this.margin, base);
    if (threshold !== undefined) {
      this.doc.setDrawColor(...hex(PDF_COLORS.faint));
      this.doc.setLineDashPattern([2, 2], 0);
      this.doc.line(this.margin, base - threshold * h, this.width - this.margin, base - threshold * h);
      this.doc.setLineDashPattern([], 0);
    }
    this.font(7.5);
    this.color(PDF_COLORS.faint);
    this.doc.text("Start", this.margin, base + 10);
    this.doc.text("End of text", this.width - this.margin, base + 10, { align: "right" });
    this.y = base + 20;
  }

  /** A simple table with wrapped cells. */
  table(headers: string[], rows: string[][], widths: number[]) {
    const size = 8.5;
    const lh = size * 1.3;
    const total = widths.reduce((a, b) => a + b, 0);
    const cols = widths.map((w) => (w / total) * this.content);
    const drawRow = (cells: string[], bold: boolean) => {
      this.font(size, bold ? "bold" : "normal");
      const wrapped = cells.map((c, i) => this.doc.splitTextToSize(pdfSafe(c), (cols[i] as number) - 6) as string[]);
      const hRow = Math.max(...wrapped.map((w) => w.length)) * lh + 6;
      this.ensure(hRow);
      let x = this.margin;
      wrapped.forEach((lines, i) => {
        this.color(bold ? PDF_COLORS.soft : PDF_COLORS.ink);
        lines.forEach((l, k) => this.doc.text(l, x + 3, this.y + size + 2 + k * lh));
        x += cols[i] as number;
      });
      this.y += hRow;
      this.doc.setDrawColor(...hex(PDF_COLORS.rule));
      this.doc.setLineWidth(0.4);
      this.doc.line(this.margin, this.y, this.width - this.margin, this.y);
    };
    drawRow(headers, true);
    for (const r of rows) drawRow(r, false);
    this.y += 8;
  }

  /**
   * The user's text, word by word, with marked passages tinted and tagged, and an optional coloured bar in the
   * left margin beside lines inside `sideBars` ranges (used for AI-like paragraphs).
   */
  markedText(text: string, marks: Mark[], sideBars: Array<{ start: number; end: number; color: string }> = []) {
    const size = 9.5;
    const lh = size * 1.45;
    this.font(size, "normal", "times");
    const parts = text.split(/(\s+)/);
    let pos = 0;
    let x = this.margin;
    const right = this.width - this.margin;
    this.ensure(lh);
    const markAt = (i: number) => marks.find((m) => i >= m.start && i < m.end);
    const barAt = (i: number) => sideBars.find((b) => i >= b.start && i < b.end);
    const newline = (extra = 0) => {
      x = this.margin;
      this.y += lh + extra;
      this.ensure(lh);
    };
    for (const part of parts) {
      const start = pos;
      pos += part.length;
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        const breaks = (part.match(/\n/g) ?? []).length;
        if (breaks >= 2) newline(lh * 0.5);
        else if (breaks === 1) newline();
        else if (x > this.margin) x += this.doc.getTextWidth(" ");
        continue;
      }
      const word = pdfSafe(part);
      const w = this.doc.getTextWidth(word);
      if (x + w > right && x > this.margin) newline();
      const m = markAt(start);
      if (m?.fill) {
        this.fill(m.fill);
        const next = markAt(start + part.length + 1) === m;
        this.doc.rect(x - 0.5, this.y + 1.5, w + (next ? this.doc.getTextWidth(" ") + 1 : 1), lh - 1, "F");
      }
      const bar = barAt(start);
      if (bar) {
        this.fill(bar.color);
        this.doc.rect(this.margin - 10, this.y + 1, 3, lh, "F");
      }
      this.color(PDF_COLORS.ink);
      this.font(size, "normal", "times");
      this.doc.text(word, x, this.y + size + 1);
      x += w;
      // A tag (such as a source number) after the last word of a marked passage.
      if (m?.tag && start + part.length >= m.end - 1) {
        this.font(6.5, "bold");
        this.color(m.tagColor ?? PDF_COLORS.action);
        const t = `[${m.tag}]`;
        this.doc.text(t, x + 1, this.y + 5);
        x += this.doc.getTextWidth(t) + 2;
        this.font(size, "normal", "times");
      }
    }
    this.y += lh + 6;
  }

  /** Page numbers and a short footer on every page. */
  footer(left: string) {
    const n = this.doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      this.doc.setPage(i);
      this.font(7.5);
      this.color(PDF_COLORS.faint);
      this.doc.text(pdfSafe(left), this.margin, this.height - 24);
      this.doc.text(`Page ${i} of ${n}`, this.width - this.margin, this.height - 24, { align: "right" });
    }
  }
}
