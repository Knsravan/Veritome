import type { DocImage, DocModel } from "../doc/model";
import { compareHashes, decodeImage, hashImage, SAME_IMAGE, type ImageHash, type Transform } from "./hash";
import type { PlagiarismReport } from "@/core/plagiarism/types";
import type { SourceFigure } from "@/core/images/figures";

export interface AnalyzedImage {
  id: string;
  label: string;
  src: string;
  page?: number;
  width?: number;
  height?: number;
  /** Text read from the image, when it holds enough to matter. */
  text?: string;
  /** Offset of this image's text inside the combined text that was checked for plagiarism. */
  textStart?: number;
  readable: boolean;
}

export type ImageFindingKind = "duplicate" | "source_figure" | "text_match";

export interface ImageFinding {
  id: string;
  kind: ImageFindingKind;
  imageId: string;
  /** For duplicates: the other image. */
  otherId?: string;
  transform?: Transform;
  /** Hash distance out of 64; lower is closer. */
  distance?: number;
  source?: { id: string; title: string; url?: string; figure: SourceFigure; thumb: string };
  /** For text in images: words that match a source, and the source title. */
  words?: number;
  sourceTitle?: string;
}

export interface ImageReport {
  images: AnalyzedImage[];
  findings: ImageFinding[];
  /** The plagiarism check of the text read from images, if any was found. */
  textCheck?: PlagiarismReport;
  /** Figures of matched sources that were compared. */
  figuresCompared: number;
  notes: string[];
}

export interface AnalyzeOptions {
  /** Matched sources from the main check, to compare figures with. */
  sources?: Array<{ id: string; title: string; url?: string; doi?: string }>;
  /** Search outside services (consent already given). */
  external: boolean;
  web?: boolean;
  onStep?: (text: string) => void;
  signal?: AbortSignal;
  /** Injection points for tests. */
  ocr?: (canvas: HTMLCanvasElement) => Promise<{ text: string; confidence: number }>;
  fetchJson?: <T>(url: string, body: unknown) => Promise<T>;
}

const words = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;

function canvasOf(bmp: ImageBitmap, maxSide = 2000): HTMLCanvasElement {
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Checks the paper's images, entirely in the browser apart from the searches:
 * the same picture used twice (also when flipped or rotated), pictures that match a figure in a matched source,
 * and text inside pictures (read by OCR and checked for plagiarism like the rest of the paper).
 */
export async function analyzeImages(doc: DocModel, options: AnalyzeOptions): Promise<ImageReport> {
  const notes: string[] = [];
  const step = options.onStep ?? (() => {});
  let raw: DocImage[] = doc.images;
  if (doc.kind === "pdf" && !raw.length) {
    step("Finding the pictures in the PDF");
    const { pdfImages } = await import("./pdf-images");
    raw = await pdfImages(doc).catch(() => []);
  }
  const images: AnalyzedImage[] = [];
  const hashes = new Map<string, ImageHash>();
  const canvases = new Map<string, HTMLCanvasElement>();
  let figure = 0;
  for (const img of raw) {
    figure++;
    const label = img.page ? `Image ${figure} (page ${img.page})` : `Image ${figure}`;
    const bmp = await decodeImage(img.bytes, img.mime);
    if (!bmp) {
      images.push({ id: img.id, label, src: img.src, ...(img.page ? { page: img.page } : {}), readable: false });
      continue;
    }
    const h = hashImage(bmp);
    hashes.set(img.id, h);
    canvases.set(img.id, canvasOf(bmp));
    images.push({ id: img.id, label, src: img.src, ...(img.page ? { page: img.page } : {}), width: bmp.width, height: bmp.height, readable: true });
    bmp.close?.();
  }
  const unreadable = images.filter((i) => !i.readable).length;
  if (unreadable) notes.push(`${unreadable} image${unreadable === 1 ? " is" : "s are"} in a format the browser cannot read (such as EMF or TIFF), so ${unreadable === 1 ? "it was" : "they were"} not checked.`);
  const findings: ImageFinding[] = [];

  // 1. The same picture twice.
  step("Comparing the pictures with each other");
  const usable = images.filter((i) => hashes.get(i.id) && !hashes.get(i.id)!.trivial);
  for (let a = 0; a < usable.length; a++)
    for (let b = a + 1; b < usable.length; b++) {
      const m = compareHashes(hashes.get(usable[a]!.id)!, hashes.get(usable[b]!.id)!);
      if (m.distance <= SAME_IMAGE) findings.push({ id: `dup-${usable[a]!.id}-${usable[b]!.id}`, kind: "duplicate", imageId: usable[b]!.id, otherId: usable[a]!.id, transform: m.transform, distance: m.distance });
    }

  // 2. Text inside pictures.
  const ocrable = usable.filter((i) => (i.width ?? 0) >= 160 && (i.height ?? 0) >= 60).slice(0, 15);
  if (ocrable.length) {
    const ocr = options.ocr ?? (async (c: HTMLCanvasElement) => (await import("./ocr")).recognize(c));
    let n = 0;
    for (const img of ocrable) {
      if (options.signal?.aborted) break;
      step(`Reading text inside pictures (${++n} of ${ocrable.length})`);
      try {
        const r = await ocr(canvases.get(img.id)!);
        const text = r.text.replace(/\s+\n/g, "\n").trim();
        if (r.confidence >= 55 && words(text) >= 12) img.text = text;
      } catch {
        notes.push("Text inside pictures could not be read in this browser (the reader could not be loaded).");
        break;
      }
    }
  }
  const withText = images.filter((i) => i.text);
  let textCheck: PlagiarismReport | undefined;
  if (withText.length) {
    step("Checking the text found in pictures");
    let combined = "";
    for (const i of withText) {
      i.textStart = combined.length;
      combined += `${i.text}\n\n`;
    }
    try {
      const fetchJson = options.fetchJson ?? ((u, b) => postJson(u, b, options.signal));
      textCheck = await fetchJson<PlagiarismReport>("/api/plagiarism", { text: combined, external: options.external, consent: options.external, web: options.web ?? true, excludeReferences: false });
      for (const i of withText) {
        const from = i.textStart!;
        const to = from + i.text!.length;
        const spans = textCheck.spans.filter((s) => s.start >= from && s.end <= to && s.sourceIds[0] !== "self");
        const w = spans.reduce((n, s) => n + s.words, 0);
        if (w >= 8) {
          const src = textCheck.sources.find((s) => s.id === spans[0]!.sourceIds[0]);
          findings.push({ id: `text-${i.id}`, kind: "text_match", imageId: i.id, words: w, ...(src ? { sourceTitle: src.title } : {}) });
        }
      }
    } catch {
      notes.push("The text found in pictures could not be checked against sources this time.");
    }
  }

  // 3. Figures in matched sources.
  let figuresCompared = 0;
  const sources = (options.sources ?? []).filter((s) => s.doi || /^doi:|^wikipedia:/.test(s.id)).slice(0, 6);
  if (options.external && usable.length && sources.length) {
    step("Comparing your pictures with figures in matched papers");
    try {
      const fetchJson = options.fetchJson ?? ((u, b) => postJson(u, b, options.signal));
      const res = await fetchJson<{ sources: Array<{ id: string; figures: SourceFigure[] }> }>("/api/figures", {
        consent: true,
        sources: sources.map((s) => ({ id: s.id, ...(s.doi ? { doi: s.doi } : {}) })),
      });
      for (const s of res.sources) {
        const meta = sources.find((x) => x.id === s.id);
        for (const fig of s.figures.slice(0, 12)) {
          if (options.signal?.aborted) break;
          const thumb = `/api/figure-image?url=${encodeURIComponent(fig.url)}`;
          try {
            const r = await fetch(thumb, options.signal ? { signal: options.signal } : {});
            if (!r.ok) continue;
            const bmp = await decodeImage(new Uint8Array(await r.arrayBuffer()), r.headers.get("content-type") ?? "image/jpeg");
            if (!bmp) continue;
            const fh = hashImage(bmp);
            bmp.close?.();
            figuresCompared++;
            if (fh.trivial) continue;
            for (const img of usable) {
              const m = compareHashes(fh, hashes.get(img.id)!);
              if (m.distance <= SAME_IMAGE && !findings.some((f) => f.kind === "source_figure" && f.imageId === img.id))
                findings.push({
                  id: `fig-${img.id}-${s.id}`,
                  kind: "source_figure",
                  imageId: img.id,
                  transform: m.transform,
                  distance: m.distance,
                  source: { id: s.id, title: meta?.title ?? s.id, ...(meta?.url ? { url: meta.url } : {}), figure: fig, thumb },
                });
            }
          } catch {
            // Skip a figure that cannot be fetched.
          }
        }
      }
    } catch {
      notes.push("Figures in the matched papers could not be fetched this time.");
    }
  }
  return { images, findings, ...(textCheck ? { textCheck } : {}), figuresCompared, notes };
}
