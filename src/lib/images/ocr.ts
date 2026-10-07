/**
 * Reads text inside images in the browser with Tesseract (open source OCR). The OCR engine and English language
 * data download from a CDN the first time they are needed; images never leave the browser.
 */
import type { Worker } from "tesseract.js";

export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrLine {
  words: OcrWord[];
}

export interface OcrResult {
  text: string;
  confidence: number;
  /** Paragraphs of lines of words, with pixel boxes, for laying text over scanned pages. */
  paragraphs: OcrLine[][];
}

let worker: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!worker) {
    worker = import("tesseract.js").then(({ createWorker }) => createWorker("eng"));
    worker.catch(() => {
      worker = null;
    });
  }
  return worker;
}

type Ocrable = HTMLCanvasElement | Blob | HTMLImageElement;

export async function recognize(image: Ocrable): Promise<OcrResult> {
  const w = await getWorker();
  const { data } = await w.recognize(image, {}, { text: true, blocks: true });
  const paragraphs: OcrLine[][] = [];
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs) {
      paragraphs.push(
        p.lines.map((l) => ({
          words: l.words.filter((x) => x.text.trim() && x.confidence > 30).map((x) => ({ text: x.text, x0: x.bbox.x0, y0: x.bbox.y0, x1: x.bbox.x1, y1: x.bbox.y1 })),
        })),
      );
    }
  }
  return { text: data.text ?? "", confidence: data.confidence ?? 0, paragraphs };
}

export async function stopOcr() {
  const w = worker;
  worker = null;
  if (w) (await w.catch(() => null))?.terminate();
}
