import { TextBuilder, type PdfItem, type PdfModel, type PdfPage } from "./model";

interface RawItem {
  str: string;
  x: number;
  /** Baseline, from the top of the page. */
  base: number;
  w: number;
  h: number;
  eol: boolean;
}

const norm = (s: string) => s.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();

/** Groups a page's items into lines by baseline. */
function lines(items: RawItem[]): RawItem[][] {
  const out: RawItem[][] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    const ref = last?.[last.length - 1];
    if (ref && Math.abs(ref.base - it.base) < Math.max(2, Math.min(ref.h, it.h) * 0.5)) last!.push(it);
    else out.push([it]);
  }
  return out;
}

/** The pages' first and last lines that repeat on most pages (running heads, footers) or are bare page numbers. */
function furniture(pages: RawItem[][][]): Set<RawItem> {
  const skip = new Set<RawItem>();
  const edge = (ls: RawItem[][]) => [ls[0], ls[1], ls[ls.length - 2], ls[ls.length - 1]].filter(Boolean) as RawItem[][];
  const counts = new Map<string, number>();
  for (const ls of pages) for (const k of new Set(edge(ls).map((l) => norm(l.map((i) => i.str).join(" "))))) counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const ls of pages) {
    for (const l of edge(ls)) {
      const t = l.map((i) => i.str).join(" ").trim();
      const k = norm(t);
      const pageNumber = /^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i.test(t);
      if (pageNumber || (pages.length >= 3 && k.length > 0 && (counts.get(k) ?? 0) >= Math.max(2, pages.length * 0.5))) for (const i of l) skip.add(i);
    }
  }
  return skip;
}

/**
 * Reads a PDF in the browser: its text, in reading order, and where every piece of it sits on each page, so
 * findings can be drawn over the original pages. Running headers, footers and page numbers are left out of the
 * checked text; a hyphen that splits a word across lines is dropped so the word still matches.
 */
export async function readPdf(name: string, data: Uint8Array): Promise<PdfModel> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data.slice());
  const pages: Array<{ width: number; height: number; lines: RawItem[][] }> = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: RawItem[] = [];
    for (const raw of content.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number; hasEOL?: boolean }>) {
      if (typeof raw.str !== "string" || !raw.transform) continue;
      const [, , c = 0, d = 0, e = 0, f = 0] = raw.transform;
      const h = Math.hypot(c, d) || raw.height || 10;
      // Convert from PDF space (origin bottom left, possibly offset by a crop box) to the viewport.
      const [vx, vy] = vp.convertToViewportPoint(e, f) as [number, number];
      items.push({ str: raw.str, x: vx, base: vy, w: (raw.width ?? 0) * (vp.scale ?? 1), h, eol: Boolean(raw.hasEOL) });
    }
    const ls = lines(items.filter((i) => i.str.length > 0 || i.eol));
    // Some files (justified text from Word, often) report spaces hundreds of points wide. An item never reaches past
    // the next one on its line or off the page, so underlines stop where the words do.
    for (const l of ls)
      l.forEach((it, k) => {
        const next = l[k + 1];
        if (next && next.x > it.x) it.w = Math.min(it.w, next.x - it.x);
        else if (!it.str.trim()) it.w = Math.min(it.w, it.h * 0.5);
        it.w = Math.max(0, Math.min(it.w, vp.width - it.x));
      });
    pages.push({ width: vp.width, height: vp.height, lines: ls });
  }

  const skip = furniture(pages.map((p) => p.lines));
  const tb = new TextBuilder();
  const out: PdfPage[] = [];
  let prevLine: { base: number; h: number; end: string } | null = null;
  pages.forEach((p, pi) => {
    const pageItems: PdfItem[] = [];
    for (const line of p.lines) {
      const kept = line.filter((i) => !skip.has(i) && i.str.length > 0);
      for (const i of line.filter((x) => skip.has(x) && x.str.trim())) {
        const r = { start: tb.length, end: tb.length };
        pageItems.push({ x: i.x, y: i.base - i.h * 0.85, w: i.w, h: i.h * 1.1, ...r, chars: i.str.length, skipped: true });
      }
      if (!kept.length) continue;
      const lineText = kept.map((i) => i.str).join("");
      if (!lineText.trim()) continue;
      if (prevLine) {
        const lh = Math.max(prevLine.h, kept[0]!.h);
        const gap = kept[0]!.base - prevLine.base;
        const newPage = gap < 0 || (pi > 0 && pageItems.every((x) => x.skipped));
        const hyphen = /[A-Za-z]-$/.test(prevLine.end) && /^[a-z]/.test(lineText.trimStart());
        // A hyphen that splits a word is followed by a bare newline; finish() removes both.
        if (hyphen) tb.add("\n");
        else if (!newPage && gap > lh * 1.9) tb.breakBlock();
        else if (newPage && /[.!?:]["”)]?$/.test(prevLine.end.trimEnd()) && /^[A-Z0-9]/.test(lineText.trimStart())) tb.breakBlock();
        else if (!/\s$/.test(prevLine.end)) tb.add("\n");
      }
      kept.forEach((i, k) => {
        if (k > 0) {
          const prev = kept[k - 1]!;
          const gap = i.x - (prev.x + prev.w);
          if (gap > i.h * 0.15 && !/\s$/.test(prev.str) && !/^\s/.test(i.str)) tb.add(" ");
        }
        const r = tb.add(i.str);
        pageItems.push({ x: i.x, y: i.base - i.h * 0.85, w: i.w, h: i.h * 1.1, ...r, chars: i.str.length });
      });
      prevLine = { base: kept[kept.length - 1]!.base, h: kept[0]!.h, end: lineText };
    }
    out.push({ number: pi + 1, width: p.width, height: p.height, items: pageItems });
  });
  return finish(name, data, out, tb.toString());
}

/** Removes hyphens that split words across lines, shifting the offsets of everything after them. */
function finish(name: string, data: Uint8Array, pages: PdfPage[], raw: string): PdfModel {
  const cuts: number[] = [];
  for (const m of raw.matchAll(/([A-Za-z])-\n([a-z])/g)) cuts.push(m.index + 1, m.index + 2); // the hyphen and the newline
  // Single newlines that are not hyphen breaks stay; they read as spaces to the checks.
  const removed = new Set<number>();
  for (let i = 0; i < cuts.length; i += 2) {
    removed.add(cuts[i]!);
    removed.add(cuts[i + 1]!);
  }
  if (!removed.size) return { kind: "pdf", name, text: raw.replace(/\s+$/, ""), pages, images: [], hidden: [], warnings: [], data };
  const shift = new Int32Array(raw.length + 1);
  let d = 0;
  let text = "";
  for (let i = 0; i <= raw.length; i++) {
    shift[i] = i - d;
    if (i < raw.length) {
      if (removed.has(i)) d++;
      else text += raw[i];
    }
  }
  for (const p of pages) for (const it of p.items) {
    it.start = shift[it.start]!;
    it.end = shift[it.end]!;
  }
  return { kind: "pdf", name, text: text.replace(/\s+$/, ""), pages, images: [], hidden: [], warnings: [], data };
}

/**
 * Reads a scanned PDF (pages that are pictures, with no text layer) by OCR in the browser. Each word keeps its
 * position on the page, so findings are still drawn over the original pages.
 */
export async function ocrPdf(model: PdfModel, onProgress?: (done: number, total: number) => void, maxPages = 30): Promise<PdfModel> {
  const { getDocumentProxy } = await import("unpdf");
  const { recognize } = await import("../images/ocr");
  const pdf = await getDocumentProxy(model.data.slice());
  const total = Math.min(pdf.numPages, maxPages);
  const tb = new TextBuilder();
  const pages: PdfPage[] = [];
  const scale = 2;
  for (let n = 1; n <= total; n++) {
    onProgress?.(n - 1, total);
    const page = await pdf.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp, canvas } as Parameters<typeof page.render>[0]).promise;
    const result = await recognize(canvas);
    const items: PdfItem[] = [];
    for (const para of result.paragraphs) {
      const lines = para.filter((l) => l.words.length);
      if (!lines.length) continue;
      lines.forEach((l, li) => {
        if (li > 0) tb.add("\n");
        l.words.forEach((w, wi) => {
          if (wi > 0) tb.add(" ");
          const r = tb.add(w.text);
          items.push({ x: w.x0 / scale, y: w.y0 / scale, w: (w.x1 - w.x0) / scale, h: (w.y1 - w.y0) / scale, ...r, chars: w.text.length });
        });
      });
      tb.breakBlock();
    }
    pages.push({ number: n, width: vp1.width, height: vp1.height, items });
  }
  onProgress?.(total, total);
  const out = finish(model.name, model.data, pages, tb.toString());
  out.warnings.push(
    "This PDF is a scan, so its text was read by OCR. OCR can misread words, which can hide or invent matches; check anything important against the page.",
    ...(pdf.numPages > maxPages ? [`Only the first ${maxPages} of ${pdf.numPages} pages were read.`] : []),
  );
  return out;
}
