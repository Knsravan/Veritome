/**
 * Writes new text for whole paragraphs into the original PDF, keeping everything else as it was: the pages, the
 * layout, figures, tables, headers and the fonts. For each paragraph the old text is taken out of the page's
 * content stream and the new text is set in the same place, in the same font, size, colour, line spacing and
 * alignment. The PDF's own embedded font is reused for every character it already draws somewhere in the file;
 * any other character uses the closest standard font. Italic or other specially set words that are still in the
 * new text keep their font.
 *
 * A paragraph is left as it was (and counted in `skipped`) when it cannot be replaced safely: its text is drawn
 * inside a form or rotated, it shares lines with other text, the new text does not fit, or a character cannot be
 * shown in any available font.
 */
import { PDFDict, PDFDocument, PDFFont, PDFName, PDFRef, StandardFonts, type PDFPage } from "pdf-lib";
import type { PdfModel } from "./model";
import { pageContent, pageFonts, readPageText, type FontInfo, type PageText, type Show } from "./pdf-content";

export interface PdfEdit {
  /** Offsets of the paragraph in the document's checked text. */
  start: number;
  end: number;
  text: string;
}

export interface PdfRewriteResult {
  bytes: Uint8Array;
  applied: number;
  skipped: number;
  /** Why each skipped paragraph was left, by its start offset (for tests and debugging). */
  reasons: Map<number, string>;
}

interface Line {
  page: number;
  /** Baseline and horizontal extent, in PDF user space. */
  y: number;
  left: number;
  right: number;
  size: number;
  /** Characters in the piece that set the size. */
  chars: number;
}

interface Slot {
  page: number;
  x: number;
  y: number;
  width: number;
}

interface Style {
  font: FontInfo | null;
  /** Font size relative to the paragraph's main size, and baseline shift in points. */
  scale: number;
  rise: number;
}

interface Glyphs {
  /** "pdf:<key>" for a font of the file, "std:<name>" for a standard font. */
  font: string;
  size: number;
  rise: number;
  hex: string;
  width: number;
}

const nonSpace = (s: string) => s.replace(/\s+/g, "").length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

const STD: Record<FontInfo["family"], [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

const reverse = new WeakMap<FontInfo, Map<string, number>>();
/** The code that draws a character in this font, if the file's embedded font surely has its glyph. */
function codeFor(font: FontInfo, ch: string): number | undefined {
  let m = reverse.get(font);
  if (!m) {
    m = new Map();
    for (const code of font.used) {
      const u = font.unicode.get(code);
      if (u && [...u].length === 1 && !m.has(u) && font.width(code) > 0) m.set(u, code);
    }
    reverse.set(font, m);
  }
  return m.get(ch);
}

const hexOf = (codes: number[], bytes: 1 | 2) => `<${codes.map((c) => c.toString(16).padStart(bytes * 2, "0")).join("")}>`;
const fmt = (n: number) => (Math.abs(n) < 1e-4 ? "0" : n.toFixed(3).replace(/\.?0+$/, ""));

export async function rewritePdf(doc: PdfModel, edits: readonly PdfEdit[]): Promise<PdfRewriteResult> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(doc.data.slice(), { updateMetadata: false });
  } catch (err) {
    throw new Error(
      /encrypt/i.test(String(err)) ? "This PDF is locked against changes, so a humanised copy of it cannot be made." : "This PDF could not be opened for editing.",
    );
  }
  const ctx = pdf.context;
  const pages = pdf.getPages();
  const fontCache = new Map<string, FontInfo>();
  const refs = new Map<string, PDFRef>();
  const reasons = new Map<number, string>();

  // Read every page first, so each font's set of drawn characters is complete.
  const read: Array<(PageText & { fonts: Map<string, FontInfo>; x0: number; y1: number }) | null> = pages.map((p) => {
    if (p.getRotation().angle % 360 !== 0) return null;
    const res = p.node.Resources();
    const fonts = pageFonts(ctx, res, fontCache);
    const raw = res?.get(PDFName.of("Font"));
    const dict = raw instanceof PDFRef ? ctx.lookup(raw) : raw;
    if (dict instanceof PDFDict) for (const [, v] of dict.entries()) if (v instanceof PDFRef) refs.set(v.toString(), v);
    const bytes = pageContent(ctx, p.node.Contents());
    if (!bytes) return null;
    const box = p.getCropBox();
    return { ...readPageText(bytes, fonts), fonts, x0: box.x, y1: box.y + box.height };
  });

  const std = new Map<StandardFonts, PDFFont>();
  const stdFont = async (f: FontInfo | null, main: FontInfo | null): Promise<PDFFont> => {
    const like = f ?? main;
    const set = STD[like?.family ?? "serif"];
    const which = set[(like?.bold ? 1 : 0) + (like?.italic ? 2 : 0)]!;
    let font = std.get(which);
    if (!font) {
      font = await pdf.embedFont(which);
      std.set(which, font);
    }
    return font;
  };

  const claimed = new Set<string>();
  const removals = new Map<number, Set<number>>();
  const drawing = new Map<number, string[]>();
  const stdUsed = new Map<number, Map<string, PDFFont>>();
  let applied = 0;

  for (const edit of edits) {
    const fail = (why: string) => {
      reasons.set(edit.start, why);
    };
    // 1. Where the paragraph sits, from the reading model.
    const lines: Line[] = [];
    let bad = "";
    doc.pages.forEach((pg, pi) => {
      const r = read[pi];
      const inPara = pg.items.filter((it) => !it.skipped && it.chars > 0 && it.end > edit.start && it.start < edit.end);
      if (!inPara.length) return;
      if (!r) {
        bad = "the page is rotated or unreadable";
        return;
      }
      if (inPara.some((it) => it.start < edit.start - 1 || it.end > edit.end + 1)) bad = "the paragraph shares text with another";
      // Full-size text sets the lines; smaller pieces (subscripts, superscripts, footnote marks) join the line
      // they sit on.
      const top = Math.max(...inPara.map((it) => it.h));
      const ordered = [...inPara.filter((it) => it.h >= top * 0.85), ...inPara.filter((it) => it.h < top * 0.85)];
      for (const it of ordered) {
        // The reader stores the top of the text (baseline - 0.85 size) and 1.1 times the size.
        const size = it.h / 1.1;
        const y = r.y1 - (it.y + size * 0.85);
        const x = it.x + r.x0;
        const small = it.h < top * 0.85;
        const line = lines.find(
          (l) =>
            l.page === pi &&
            Math.abs(l.y - y) < (small ? 0.7 * l.size : Math.max(1.5, 0.5 * Math.min(l.size, size))) &&
            x < l.right + size * 3 &&
            x + it.w > l.left - size * 3,
        );
        if (line) {
          line.left = Math.min(line.left, x);
          line.right = Math.max(line.right, x + it.w);
          // The line's size and baseline are those of its longest full-size piece.
          if (!small && it.chars > line.chars) {
            line.size = size;
            line.y = y;
            line.chars = it.chars;
          }
        } else lines.push({ page: pi, y, left: x, right: x + it.w, size, chars: small ? 0 : it.chars });
      }
      // Other text on the same lines (a run-in heading, a margin note) would be overwritten.
      for (const it of pg.items) {
        if (it.skipped || it.chars === 0 || !doc.text.slice(it.start, it.end).trim()) continue;
        if (it.end > edit.start && it.start < edit.end) continue;
        const y = r.y1 - (it.y + (it.h / 1.1) * 0.85);
        const x = it.x + r.x0;
        if (lines.some((l) => l.page === pi && Math.abs(l.y - y) < 0.5 * l.size && x < l.right - 0.5 && x + it.w > l.left + 0.5)) bad = "another piece of text shares its lines";
      }
    });
    if (bad) {
      fail(bad);
      continue;
    }
    if (!lines.length) {
      fail("the paragraph was not found on the pages");
      continue;
    }
    const sizes = lines.map((l) => l.size);
    if (Math.max(...sizes) > Math.min(...sizes) * 1.12) {
      fail("it mixes text of different sizes (a heading with its paragraph)");
      continue;
    }

    // 2. The drawing operators that put its text on the page.
    const shows: Array<Show & { page: number; line: Line }> = [];
    for (const l of lines) {
      const r = read[l.page]!;
      let found = 0;
      for (const s of r.shows) {
        if (!s.codes || !s.upright) continue;
        if (Math.abs(s.y - l.y) > 0.6 * l.size || s.x < l.left - 1.5 || s.x > l.right + 0.5) continue;
        if (s.x2 > l.right + Math.max(3, l.size * 2)) {
          bad = "its text is drawn together with other text";
          break;
        }
        const id = `${l.page}:${s.index}`;
        if (claimed.has(id)) {
          bad = "its text is drawn together with another paragraph";
          break;
        }
        if (s.text.trim()) found++;
        shows.push({ ...s, page: l.page, line: l });
      }
      if (!found) bad ||= "its text is not drawn where the reader found it (it may be inside a form)";
    }
    if (bad) {
      fail(bad);
      continue;
    }
    const original = doc.text.slice(edit.start, edit.end);
    const drawn = shows.reduce((t, s) => t + nonSpace(s.text), 0);
    const want = nonSpace(original);
    if (Math.abs(drawn - want) > Math.max(4, want * 0.06)) {
      fail(`the drawn text (${drawn} characters) does not match the paragraph (${want})`);
      continue;
    }

    // 3. The paragraph's main font, size and colour, and specially set words to keep.
    const byFont = new Map<string, number>();
    for (const s of shows) byFont.set(s.font?.key ?? "", (byFont.get(s.font?.key ?? "") ?? 0) + nonSpace(s.text));
    const mainKey = [...byFont].sort((a, b) => b[1] - a[1])[0]![0];
    const mainShows = shows.filter((s) => (s.font?.key ?? "") === mainKey);
    const main = mainShows[0]!.font ?? null;
    const size = median(mainShows.map((s) => s.size)) || median(lines.map((l) => l.size));
    const fill = mainShows[0]!.fill;
    const text = edit.text.replace(/\s+/g, " ").trim();
    const styleAt: Style[] = Array.from(text, () => ({ font: main, scale: 1, rise: 0 }));
    let cursor = 0;
    for (const s of shows) {
      const sameFont = (s.font?.key ?? "") === mainKey;
      const rise = s.y - s.line.y;
      const scale = s.size / size;
      if (sameFont && Math.abs(rise) < 0.5 && Math.abs(scale - 1) < 0.08) continue;
      const t = s.text.trim();
      if (!t || t.includes("�")) continue;
      const at = text.indexOf(t, cursor);
      if (at < 0) continue;
      for (let k = at; k < at + t.length; k++) styleAt[k] = { font: s.font ?? null, scale: Math.abs(scale - 1) < 0.08 ? 1 : scale, rise: Math.abs(rise) < 0.5 ? 0 : rise };
      cursor = at + t.length;
    }

    // 4. Glyphs for each word, in the file's fonts where possible.
    const words: Glyphs[][] = [];
    const paraFonts = [...new Set(shows.map((s) => s.font).filter((f): f is FontInfo => Boolean(f)))];
    let unshowable = "";
    const pending: Array<{ ch: string; style: Style }> = [];
    const wordsText: Array<Array<{ ch: string; style: Style }>> = [];
    [...text].forEach((ch, k) => {
      if (ch === " ") {
        if (pending.length) wordsText.push(pending.splice(0));
      } else pending.push({ ch, style: styleAt[k] ?? styleAt[0]! });
    });
    if (pending.length) wordsText.push(pending.splice(0));
    // [...text] splits by code point while styleAt is by UTF-16 unit; they agree for text without astral characters.
    for (const w of wordsText) {
      const runs: Glyphs[] = [];
      for (const { ch, style } of w) {
        const sz = size * style.scale;
        let font = "";
        let hex = "";
        let width = 0;
        // The style's own font, then any font of this paragraph, then any font of the file that already draws
        // the character (maths symbols, Greek letters), then a standard font.
        const source = [style.font, ...paraFonts, ...fontCache.values()].find(
          (f): f is FontInfo => Boolean(f?.writable && refs.has(f.key) && codeFor(f, ch) !== undefined),
        );
        if (source) {
          const code = codeFor(source, ch)!;
          font = `pdf:${source.key}`;
          hex = hexOf([code], source.bytes);
          width = source.width(code) * sz;
        } else {
          const f = await stdFont(style.font, main);
          try {
            hex = f.encodeText(ch).toString();
            width = f.widthOfTextAtSize(ch, sz);
            font = `std:${f.name}`;
          } catch {
            unshowable = ch;
            break;
          }
        }
        const last = runs[runs.length - 1];
        if (last && last.font === font && last.size === sz && last.rise === style.rise) {
          last.hex = last.hex.slice(0, -1) + hex.slice(1);
          last.width += width;
        } else runs.push({ font, size: sz, rise: style.rise, hex, width });
      }
      if (unshowable) break;
      words.push(runs);
    }
    if (unshowable) {
      fail(`the character "${unshowable}" cannot be shown in this PDF's fonts`);
      continue;
    }
    const spaceCode = main?.writable ? codeFor(main, " ") : undefined;
    const space = spaceCode !== undefined && main ? main.width(spaceCode) * size : (await stdFont(main, main)).widthOfTextAtSize(" ", size);

    // 5. Lines to fill: the paragraph's own lines, split into segments by column and page.
    const segs: Line[][] = [];
    for (const l of lines) {
      const cur = segs[segs.length - 1];
      const prev = cur?.[cur.length - 1];
      if (prev && prev.page === l.page && l.y < prev.y - 0.5 && l.left < prev.right) cur!.push(l);
      else segs.push([l]);
    }
    const leads = segs.flatMap((s) => s.slice(1).map((l, k) => s[k]!.y - l.y)).filter((d) => d > 0);
    const leading = median(leads) || size * 1.2;
    // Every line but the paragraph's last is set full width when the paragraph is justified.
    const nonLast = lines.slice(0, -1);
    const segRight = (s: Line[]) => Math.max(...s.map((l) => l.right));
    const segLeft = (s: Line[]) => Math.min(...s.map((l) => l.left));
    const justified =
      lines.length >= 2 &&
      nonLast.filter((l) => {
        const s = segs.find((g) => g.includes(l))!;
        return segRight(s) - l.right < Math.max(1.5, (segRight(s) - segLeft(s)) * 0.012);
      }).length >= Math.max(1, nonLast.length * 0.7);

    // Lines after the first start where the paragraph's own continuation lines do (a hanging indent in a list).
    const contLeft = (s: Line[]) => {
      const rest = s.filter((l) => l !== lines[0]);
      return rest.length ? median(rest.map((l) => l.left)) : segLeft(s);
    };
    const slotsAt = (scale: number): Slot[] => {
      const out: Slot[] = [];
      for (const s of segs) {
        const right = segRight(s);
        const left = contLeft(s);
        const first = s[0]!;
        const last = s[s.length - 1]!;
        const step = scale === 1 ? 0 : leading * scale;
        const ys = scale === 1 ? s.map((l) => l.y) : [];
        if (scale !== 1) for (let y = first.y; y >= last.y - 0.01; y -= step) ys.push(y);
        ys.forEach((y, k) => {
          const x = k === 0 && first === lines[0] ? first.left : left;
          out.push({ page: first.page, x, y, width: right - x });
        });
      }
      return out;
    };
    const wordWidth = (w: Glyphs[], scale: number) => w.reduce((t, g) => t + g.width, 0) * scale;
    let layout: { slots: Slot[]; rows: number[][]; scale: number } | null = null;
    for (const scale of [1, 0.97, 0.94, 0.91, 0.88]) {
      const slots = slotsAt(scale);
      const rows: number[][] = [];
      let k = 0;
      let ok = true;
      for (const slot of slots) {
        const row: number[] = [];
        let used = 0;
        while (k < words.length) {
          const ww = wordWidth(words[k]!, scale);
          const add = (row.length ? space * scale : 0) + ww;
          if (row.length && used + add > slot.width + 0.5) break;
          if (!row.length && ww > slot.width + 0.5 && slot !== slots[slots.length - 1]) {
            ok = false;
            break;
          }
          row.push(k++);
          used += add;
        }
        rows.push(row);
        if (!ok) break;
      }
      if (ok && k === words.length) {
        layout = { slots, rows, scale };
        break;
      }
    }
    if (!layout) {
      fail("the new text does not fit in the paragraph's space");
      continue;
    }

    // 6. Commit: remove the old operators and draw the new lines.
    for (const s of shows) {
      claimed.add(`${s.page}:${s.index}`);
      let set = removals.get(s.page);
      if (!set) removals.set(s.page, (set = new Set()));
      set.add(s.index);
    }
    const lastRow = layout.rows.reduce((last, r, k) => (r.length ? k : last), -1);
    for (let k = 0; k < layout.slots.length; k++) {
      const slot = layout.slots[k]!;
      const row = layout.rows[k] ?? [];
      if (!row.length) continue;
      const r = read[slot.page]!;
      const page = pages[slot.page]!;
      const nameOf = (font: string): string => {
        if (font.startsWith("pdf:")) {
          const key = font.slice(4);
          for (const [name, info] of r.fonts) if (info.key === key) return name;
          const added = page.node.newFontDictionary("VtR", refs.get(key)!).decodeText();
          r.fonts.set(added, fontCache.get(key)!);
          return added;
        }
        let names = stdUsed.get(slot.page);
        if (!names) stdUsed.set(slot.page, (names = new Map()));
        const stdName = font.slice(4);
        const pdfFont = [...std.values()].find((f) => f.name === stdName)!;
        const known = [...names].find(([, f]) => f === pdfFont)?.[0];
        if (known) return known;
        const added = page.node.newFontDictionary("VtF", pdfFont.ref).decodeText();
        names.set(added, pdfFont);
        return added;
      };
      const natural = row.reduce((t, w, j) => t + wordWidth(words[w]!, layout.scale) + (j ? space * layout.scale : 0), 0);
      let gap = space * layout.scale;
      const stretch = justified && k !== lastRow && row.length > 1 ? (slot.width - natural) / (row.length - 1) : 0;
      if (stretch > 0 && stretch < space * 3) gap += stretch;
      const parts: string[] = [`BT`, `1 0 0 1 ${fmt(slot.x)} ${fmt(slot.y)} Tm`];
      let curFont = "";
      let curSize = -1;
      let curRise = 0;
      row.forEach((w, j) => {
        words[w]!.forEach((g, gi) => {
          const sz = g.size * layout.scale;
          const name = nameOf(g.font);
          if (name !== curFont || sz !== curSize) {
            parts.push(`/${name} ${fmt(sz)} Tf`);
            curFont = name;
            curSize = sz;
          }
          if (g.rise !== curRise) {
            parts.push(`${fmt(g.rise * layout.scale)} Ts`);
            curRise = g.rise;
          }
          const lead = j > 0 && gi === 0 ? `${fmt((-gap * 1000) / sz)} ` : "";
          parts.push(`[${lead}${g.hex}] TJ`);
        });
      });
      if (curRise) parts.push("0 Ts");
      parts.push("ET");
      let list = drawing.get(slot.page);
      if (!list) drawing.set(slot.page, (list = []));
      list.push(["q", fill, ...parts, "Q"].filter(Boolean).join("\n"));
    }
    applied++;
  }

  // 7. Write the changed pages.
  for (const [pi, set] of removals) {
    const r = read[pi]!;
    const page: PDFPage = pages[pi]!;
    const out: Uint8Array[] = [];
    const enc = new TextEncoder();
    let at = 0;
    for (const [index, o] of r.ops.entries()) {
      if (!set.has(index)) continue;
      out.push(r.bytes.subarray(at, o.start));
      const a = o.args;
      out.push(enc.encode(o.op === "'" ? " T* " : o.op === '"' ? ` ${a[0]} Tw ${a[1]} Tc T* ` : " "));
      at = o.end;
    }
    out.push(r.bytes.subarray(at));
    out.unshift(enc.encode("q\n"));
    out.push(enc.encode(`\nQ\n${(drawing.get(pi) ?? []).join("\n")}\n`));
    const total = out.reduce((t, b) => t + b.length, 0);
    const bytes = new Uint8Array(total);
    let p = 0;
    for (const b of out) {
      bytes.set(b, p);
      p += b.length;
    }
    page.node.set(PDFName.of("Contents"), ctx.register(ctx.flateStream(bytes)));
  }

  const bytes = await pdf.save();
  return { bytes, applied, skipped: edits.length - applied, reasons };
}
