/**
 * Perceptual image hashes, so the same picture is recognised after resizing, recompression or format changes.
 * A difference hash (dHash) compares neighbouring pixel brightness on a 9x8 grid: 64 bits that change little when
 * an image is scaled or re-saved. Hashes of the flipped and rotated image are kept too, because reused figures
 * are sometimes mirrored or turned to hide the reuse.
 */

export type Transform = "same" | "flipped" | "flipped vertically" | "rotated 90°" | "rotated 180°" | "rotated 270°";

export interface ImageHash {
  /** 64-bit dHash as 16 hex digits, for the image as it is. */
  hash: string;
  /** The same for each transformed version. */
  variants: Array<{ transform: Transform; hash: string }>;
  width: number;
  height: number;
  /** Too small or too plain to compare meaningfully (icons, lines, blank boxes). */
  trivial: boolean;
}

/** dHash of a grayscale grid of (w+1) x h values, row by row. */
export function dhashFromGray(gray: ArrayLike<number>, w = 8, h = 8): string {
  let bits = "";
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bits += gray[y * (w + 1) + x]! > gray[y * (w + 1) + x + 1]! ? "1" : "0";
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** At most this many differing bits out of 64 counts as the same picture. */
export const SAME_IMAGE = 8;

/** The closest match between two hashed images, trying every transform of `b`. */
export function compareHashes(a: ImageHash, b: ImageHash): { distance: number; transform: Transform } {
  let best = { distance: hamming(a.hash, b.hash), transform: "same" as Transform };
  for (const v of b.variants) {
    const d = hamming(a.hash, v.hash);
    if (d < best.distance) best = { distance: d, transform: v.transform };
  }
  return best;
}

type Drawable = CanvasImageSource & { width: number; height: number };

function grid(img: Drawable, transform: Transform): Float64Array {
  const W = 9;
  const H = 8;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  if (transform === "flipped") ctx.scale(-1, 1);
  if (transform === "flipped vertically") ctx.scale(1, -1);
  if (transform === "rotated 90°") ctx.rotate(Math.PI / 2);
  if (transform === "rotated 180°") ctx.rotate(Math.PI);
  if (transform === "rotated 270°") ctx.rotate(-Math.PI / 2);
  const sideways = transform === "rotated 90°" || transform === "rotated 270°";
  const dw = sideways ? H : W;
  const dh = sideways ? W : H;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  const data = ctx.getImageData(0, 0, W, H).data;
  const gray = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) gray[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  return gray;
}

export function hashImage(img: Drawable): ImageHash {
  const g = grid(img, "same");
  const mean = g.reduce((a, b) => a + b, 0) / g.length;
  const spread = Math.sqrt(g.reduce((a, b) => a + (b - mean) ** 2, 0) / g.length);
  const transforms: Transform[] = ["flipped", "flipped vertically", "rotated 90°", "rotated 180°", "rotated 270°"];
  return {
    hash: dhashFromGray(g),
    variants: transforms.map((t) => ({ transform: t, hash: dhashFromGray(grid(img, t)) })),
    width: img.width,
    height: img.height,
    trivial: img.width < 48 || img.height < 48 || spread < 6,
  };
}

/** Decodes image bytes the browser can read. Returns null for formats it cannot (EMF, TIFF in most browsers). */
export async function decodeImage(bytes: Uint8Array, mime: string): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    return await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  } catch {
    return null;
  }
}
