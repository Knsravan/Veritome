import { imageUrl, type DocImage, type PdfModel } from "../doc/model";

function toCanvas(img: { data: Uint8ClampedArray; width: number; height: number; channels: 1 | 3 | 4 }): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d")!;
  const rgba = new Uint8ClampedArray(img.width * img.height * 4);
  for (let i = 0, j = 0; i < img.width * img.height; i++, j += img.channels) {
    const r = img.data[j]!;
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = img.channels === 1 ? r : img.data[j + 1]!;
    rgba[i * 4 + 2] = img.channels === 1 ? r : img.data[j + 2]!;
    rgba[i * 4 + 3] = img.channels === 4 ? img.data[j + 3]! : 255;
  }
  ctx.putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
  return c;
}

/** The pictures embedded in a PDF, page by page, as PNGs. Small images (icons, rules) and repeats (logos) are skipped. */
export async function pdfImages(model: PdfModel, max = 40): Promise<DocImage[]> {
  const { getDocumentProxy, extractImages } = await import("unpdf");
  const pdf = await getDocumentProxy(model.data.slice());
  const out: DocImage[] = [];
  const seen = new Set<string>();
  for (let n = 1; n <= pdf.numPages && out.length < max; n++) {
    let imgs: Awaited<ReturnType<typeof extractImages>> = [];
    try {
      imgs = await extractImages(pdf, n);
    } catch {
      continue;
    }
    for (const img of imgs) {
      if (out.length >= max) break;
      if (img.width < 48 || img.height < 48 || seen.has(img.key)) continue;
      seen.add(img.key);
      const canvas = toCanvas(img);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      out.push({ id: `p${n}-${out.length + 1}`, src: imageUrl(bytes, "image/png"), mime: "image/png", bytes, name: `Page ${n} image`, page: n });
    }
  }
  return out;
}
