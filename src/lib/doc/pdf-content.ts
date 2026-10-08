/**
 * Reads PDF page content streams: a tokenizer for the content-stream syntax, the fonts a page uses (codes, widths,
 * the Unicode text of each code) and a small interpreter that finds where every piece of text is drawn. Used to
 * rewrite paragraphs of a PDF in place.
 */
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFContext,
  type PDFObject,
} from "pdf-lib";
import { Encodings } from "@pdf-lib/standard-fonts";

export type Operand =
  | number
  | boolean
  | null
  | { t: "name"; v: string }
  | { t: "str"; v: Uint8Array }
  | { t: "arr"; v: Operand[] }
  | { t: "dict" };

export interface Op {
  op: string;
  args: Operand[];
  /** Byte range of the operator and its operands. */
  start: number;
  end: number;
}

const isWhite = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDelim = (c: number) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;

/** Splits a content stream into operators with their operands and byte ranges. */
export function tokenize(b: Uint8Array): Op[] {
  const ops: Op[] = [];
  let i = 0;
  let args: Operand[] = [];
  let argStart = -1;
  const stack: Operand[][] = [];
  const skipWhite = () => {
    while (i < b.length) {
      if (isWhite(b[i]!)) i++;
      else if (b[i] === 37) while (i < b.length && b[i] !== 10 && b[i] !== 13) i++;
      else break;
    }
  };
  const push = (v: Operand, at: number) => {
    if (stack.length) stack[stack.length - 1]!.push(v);
    else {
      if (argStart < 0) argStart = at;
      args.push(v);
    }
  };
  while (true) {
    skipWhite();
    if (i >= b.length) break;
    const at = i;
    const c = b[i]!;
    if (c === 40) {
      // Literal string, with nested parentheses and escapes.
      i++;
      let depth = 1;
      const out: number[] = [];
      while (i < b.length) {
        const ch = b[i++]!;
        if (ch === 92) {
          const n = b[i++];
          if (n === undefined) break;
          const map: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
          if (map[n] !== undefined) out.push(map[n]!);
          else if (n >= 48 && n <= 55) {
            let v = n - 48;
            for (let k = 0; k < 2 && b[i]! >= 48 && b[i]! <= 55; k++) v = v * 8 + (b[i++]! - 48);
            out.push(v & 255);
          } else if (n === 13) {
            if (b[i] === 10) i++;
          } else if (n !== 10) out.push(n);
        } else if (ch === 40) {
          depth++;
          out.push(ch);
        } else if (ch === 41) {
          if (--depth === 0) break;
          out.push(ch);
        } else out.push(ch);
      }
      push({ t: "str", v: Uint8Array.from(out) }, at);
    } else if (c === 60 && b[i + 1] === 60) {
      // Dictionary (marked-content properties or inline image parameters): skipped, kept as a placeholder.
      let depth = 0;
      while (i < b.length) {
        if (b[i] === 60 && b[i + 1] === 60) {
          depth++;
          i += 2;
        } else if (b[i] === 62 && b[i + 1] === 62) {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else if (b[i] === 40) {
          // A string inside the dictionary may hold brackets.
          let d = 0;
          while (i < b.length) {
            const ch = b[i++]!;
            if (ch === 92) i++;
            else if (ch === 40) d++;
            else if (ch === 41 && --d === 0) break;
          }
        } else i++;
      }
      push({ t: "dict" }, at);
    } else if (c === 60) {
      i++;
      const hex: number[] = [];
      while (i < b.length && b[i] !== 62) {
        const ch = b[i++]!;
        if (!isWhite(ch)) hex.push(ch);
      }
      i++;
      if (hex.length % 2) hex.push(48);
      const out = new Uint8Array(hex.length / 2);
      for (let k = 0; k < out.length; k++) out[k] = parseInt(String.fromCharCode(hex[2 * k]!, hex[2 * k + 1]!), 16) || 0;
      push({ t: "str", v: out }, at);
    } else if (c === 91) {
      i++;
      if (!stack.length && argStart < 0) argStart = at;
      stack.push([]);
    } else if (c === 93) {
      i++;
      const arr = stack.pop() ?? [];
      push({ t: "arr", v: arr }, at);
    } else if (c === 47) {
      i++;
      let s = "";
      while (i < b.length && !isWhite(b[i]!) && !isDelim(b[i]!)) s += String.fromCharCode(b[i++]!);
      push({ t: "name", v: s.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))) }, at);
    } else if (c === 41 || c === 62 || c === 123 || c === 125) {
      i++; // Stray delimiter: ignore.
    } else {
      let s = "";
      while (i < b.length && !isWhite(b[i]!) && !isDelim(b[i]!)) s += String.fromCharCode(b[i++]!);
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) push(Number(s), at);
      else if (s === "true" || s === "false") push(s === "true", at);
      else if (s === "null") push(null, at);
      else if (stack.length) {
        // An operator inside an array is malformed; drop the array.
        stack.length = 0;
        args = [];
        argStart = -1;
      } else {
        ops.push({ op: s, args, start: argStart < 0 ? at : argStart, end: i });
        args = [];
        argStart = -1;
        if (s === "ID") {
          // Inline image data runs to "EI" between whitespace.
          i++;
          while (i < b.length - 1 && !(b[i] === 69 && b[i + 1] === 73 && isWhite(b[i - 1]!) && (i + 2 >= b.length || isWhite(b[i + 2]!)))) i++;
          i += 2;
          ops[ops.length - 1]!.end = i;
        }
      }
    }
  }
  return ops;
}

// ---------------------------------------------------------------- fonts

/** Glyph name to Unicode for the names simple fonts commonly use. */
const GLYPHS: Map<string, string> = (() => {
  const m = new Map<string, string>();
  const enc = Encodings.WinAnsi as unknown as { supportedCodePoints: number[]; encodeUnicodeCodePoint: (cp: number) => { code: number; name: string } };
  for (const cp of enc.supportedCodePoints) m.set(enc.encodeUnicodeCodePoint(cp).name, String.fromCodePoint(cp));
  const extra: Record<string, string> = { fi: "fi", fl: "fl", ff: "ff", ffi: "ffi", ffl: "ffl", dotlessi: "ı", minus: "−", quotesingle: "'", grave: "`", nbspace: " ", sfthyphen: "-" };
  for (const [k, v] of Object.entries(extra)) m.set(k, v);
  return m;
})();

const WIN_ANSI: Map<number, string> = (() => {
  const m = new Map<number, string>();
  const enc = Encodings.WinAnsi as unknown as { supportedCodePoints: number[]; encodeUnicodeCodePoint: (cp: number) => { code: number; name: string } };
  for (const cp of enc.supportedCodePoints) m.set(enc.encodeUnicodeCodePoint(cp).code, String.fromCodePoint(cp));
  return m;
})();

function glyphToUnicode(name: string): string | undefined {
  const known = GLYPHS.get(name);
  if (known) return known;
  const uni = /^uni([0-9A-Fa-f]{4})$/.exec(name) ?? /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (uni) return String.fromCodePoint(parseInt(uni[1]!, 16));
  const base = name.split(".")[0]!;
  return base !== name ? GLYPHS.get(base) : undefined;
}

export interface FontInfo {
  key: string;
  baseName: string;
  /** Bytes per character code. */
  bytes: 1 | 2;
  /** Whether codes and widths are understood well enough to write new text in this font. */
  writable: boolean;
  /** Glyph advance in text space (1 = the font size). */
  width(code: number): number;
  /** Unicode text of a code, when known. */
  unicode: Map<number, string>;
  /** Codes drawn somewhere in the document: their glyphs are surely in the embedded font. */
  used: Set<number>;
  /** Whether the code is a single-byte space, which word spacing applies to. */
  bold: boolean;
  italic: boolean;
  family: "serif" | "sans" | "mono";
}

const num = (o: PDFObject | undefined): number | undefined => (o instanceof PDFNumber ? o.asNumber() : undefined);

function look(ctx: PDFContext, o: PDFObject | undefined): PDFObject | undefined {
  return o instanceof PDFRef ? ctx.lookup(o) : o;
}

function streamBytes(s: PDFObject | undefined): Uint8Array | null {
  if (s instanceof PDFRawStream) {
    try {
      return decodePDFRawStream(s).decode();
    } catch {
      return null;
    }
  }
  if (s instanceof PDFStream) {
    try {
      return s.getContents();
    } catch {
      return null;
    }
  }
  return null;
}

const ascii = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
};

/** Parses a ToUnicode CMap (bfchar and bfrange sections). */
export function parseToUnicode(src: string): Map<number, string> {
  const map = new Map<number, string>();
  const hexText = (h: string) => {
    let s = "";
    for (let k = 0; k + 4 <= h.length; k += 4) s += String.fromCharCode(parseInt(h.slice(k, k + 4), 16));
    if (h.length % 4 === 2) s += String.fromCharCode(parseInt(h.slice(-2), 16));
    return s;
  };
  for (const sec of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of sec[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1]!, 16), hexText(m[2]!));
  for (const sec of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of sec[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]*)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(m[1]!, 16);
      const hi = Math.min(parseInt(m[2]!, 16), lo + 65535);
      if (m[4] !== undefined) {
        const base = hexText(m[4]);
        const last = base.charCodeAt(base.length - 1);
        for (let c = lo; c <= hi; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(last + (c - lo)));
      } else {
        const list = [...m[5]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => hexText(x[1]!));
        list.forEach((s, k) => map.set(lo + k, s));
      }
    }
  }
  return map;
}

/** Reads what is needed of a font dictionary. */
export function readFont(ctx: PDFContext, key: string, dict: PDFDict): FontInfo {
  const name = (k: string) => {
    const v = look(ctx, dict.get(PDFName.of(k)));
    return v instanceof PDFName ? v.decodeText() : undefined;
  };
  const subtype = name("Subtype") ?? "";
  const baseName = (name("BaseFont") ?? "").replace(/^[A-Z]{6}\+/, "");
  const unicode = new Map<number, string>();
  const toUni = streamBytes(look(ctx, dict.get(PDFName.of("ToUnicode"))));
  if (toUni) for (const [k, v] of parseToUnicode(ascii(toUni))) unicode.set(k, v);

  let descriptor: PDFDict | undefined;
  let bytes: 1 | 2 = 1;
  let writable = true;
  let width: (code: number) => number;

  if (subtype === "Type0") {
    bytes = 2;
    const enc = name("Encoding");
    if (enc !== "Identity-H") writable = false;
    const desc = look(ctx, (look(ctx, dict.get(PDFName.of("DescendantFonts"))) as PDFArray | undefined)?.get(0));
    const widths = new Map<number, number>();
    let dw = 1000;
    if (desc instanceof PDFDict) {
      descriptor = look(ctx, desc.get(PDFName.of("FontDescriptor"))) as PDFDict | undefined;
      dw = num(look(ctx, desc.get(PDFName.of("DW")))) ?? 1000;
      const w = look(ctx, desc.get(PDFName.of("W")));
      if (w instanceof PDFArray) {
        const items = w.asArray().map((x) => look(ctx, x));
        for (let k = 0; k < items.length; ) {
          const first = num(items[k]);
          const next = items[k + 1];
          if (first === undefined) break;
          if (next instanceof PDFArray) {
            next.asArray().forEach((x, j) => widths.set(first + j, num(look(ctx, x)) ?? dw));
            k += 2;
          } else {
            const last = num(next) ?? first;
            const v = num(items[k + 2]) ?? dw;
            for (let c = first; c <= last && c - first < 65536; c++) widths.set(c, v);
            k += 3;
          }
        }
      }
    } else writable = false;
    width = (c) => (widths.get(c) ?? dw) / 1000;
    if (!unicode.size) writable = false;
  } else {
    descriptor = look(ctx, dict.get(PDFName.of("FontDescriptor"))) as PDFDict | undefined;
    const first = num(look(ctx, dict.get(PDFName.of("FirstChar")))) ?? 0;
    const wArr = look(ctx, dict.get(PDFName.of("Widths")));
    const ws = wArr instanceof PDFArray ? wArr.asArray().map((x) => num(look(ctx, x)) ?? 0) : null;
    const missing = descriptor ? (num(look(ctx, descriptor.get(PDFName.of("MissingWidth")))) ?? 0) : 0;
    let scale = 1 / 1000;
    if (subtype === "Type3") {
      const fm = look(ctx, dict.get(PDFName.of("FontMatrix")));
      scale = fm instanceof PDFArray ? (num(look(ctx, fm.get(0))) ?? 0.001) : 0.001;
    }
    if (!ws) writable = false;
    width = (c) => {
      const w = ws?.[c - first];
      return (w ?? missing) * scale;
    };
    // Codes the ToUnicode map leaves out come from the encoding.
    const enc = look(ctx, dict.get(PDFName.of("Encoding")));
    const base = new Map<number, string>(subtype === "TrueType" || enc ? WIN_ANSI : []);
    if (enc instanceof PDFDict) {
      const diffs = look(ctx, enc.get(PDFName.of("Differences")));
      if (diffs instanceof PDFArray) {
        let code = 0;
        for (const x of diffs.asArray().map((y) => look(ctx, y))) {
          if (x instanceof PDFNumber) code = x.asNumber();
          else if (x instanceof PDFName) {
            const u = glyphToUnicode(x.decodeText());
            if (u) base.set(code, u);
            else base.delete(code);
            code++;
          }
        }
      }
    } else if (!enc && subtype === "Type1" && !unicode.size) {
      // A Type 1 font's built-in encoding is usually Standard; letters and digits match WinAnsi.
      for (const [k, v] of WIN_ANSI) if (k < 128) base.set(k, v);
    }
    for (const [k, v] of base) if (!unicode.has(k)) unicode.set(k, v);
    if (!unicode.size) writable = false;
  }

  const flags = descriptor ? (num(look(ctx, descriptor.get(PDFName.of("Flags")))) ?? 0) : 0;
  const lower = baseName.toLowerCase();
  const family: FontInfo["family"] = /courier|mono|consol|menlo|typewriter|cmtt/.test(lower) || flags & 1
    ? "mono"
    : /arial|helvet|sans|calibri|carlito|verdana|segoe|tahoma|gill|futura|roboto|lato|open|inter|cmss/.test(lower)
      ? "sans"
      : "serif";
  return {
    key,
    baseName,
    bytes,
    writable,
    width,
    unicode,
    used: new Set(),
    bold: /bold|black|heavy|semibold|demi|cmbx/.test(lower) || Boolean(flags & 262144),
    italic: /italic|oblique|cmti|cmmi/.test(lower) || Boolean(flags & 64),
    family,
  };
}

/** Character codes in a string drawn with the font. */
export function codesOf(font: FontInfo | undefined, s: Uint8Array): number[] {
  const out: number[] = [];
  if (font?.bytes === 2) for (let k = 0; k + 1 < s.length; k += 2) out.push((s[k]! << 8) | s[k + 1]!);
  else for (const c of s) out.push(c);
  return out;
}

// ---------------------------------------------------------------- interpreter

type M = [number, number, number, number, number, number];
export const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];
const ID: M = [1, 0, 0, 1, 0, 0];

export interface Show {
  /** Index of the operator in the page's ops. */
  index: number;
  /** Start of the text on the page, in user space. */
  x: number;
  y: number;
  /** Where the text ends horizontally. */
  x2: number;
  /** Font size on the page. */
  size: number;
  /** Resource name and the font it names. */
  fontName: string;
  font: FontInfo | undefined;
  text: string;
  codes: number;
  rise: number;
  /** The fill-colour operators in force, as content-stream text. */
  fill: string;
  /** Whether the text is drawn upright (no rotation or skew). */
  upright: boolean;
  /** Text render mode (3 is invisible). */
  render: number;
}

export interface PageText {
  ops: Op[];
  bytes: Uint8Array;
  shows: Show[];
}

/** The page's fonts by resource name. */
export function pageFonts(ctx: PDFContext, resources: PDFDict | undefined, cache: Map<string, FontInfo>): Map<string, FontInfo> {
  const out = new Map<string, FontInfo>();
  const fonts = resources ? look(ctx, resources.get(PDFName.of("Font"))) : undefined;
  if (!(fonts instanceof PDFDict)) return out;
  for (const [k, v] of fonts.entries()) {
    const key = v instanceof PDFRef ? v.toString() : `${k.decodeText()}@inline`;
    let info = cache.get(key);
    if (!info) {
      const d = look(ctx, v);
      if (!(d instanceof PDFDict)) continue;
      info = readFont(ctx, key, d);
      cache.set(key, info);
    }
    out.set(k.decodeText(), info);
  }
  return out;
}

/** Runs the page's content stream and records every piece of text drawn, with its position. */
export function readPageText(bytes: Uint8Array, fonts: Map<string, FontInfo>): PageText {
  const ops = tokenize(bytes);
  const shows: Show[] = [];
  interface GS {
    ctm: M;
    fontName: string;
    size: number;
    tc: number;
    tw: number;
    th: number;
    tl: number;
    rise: number;
    render: number;
    fill: string[];
  }
  let gs: GS = { ctm: ID, fontName: "", size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, render: 0, fill: [] };
  const stack: GS[] = [];
  let tm: M = ID;
  let tlm: M = ID;
  const text = (s: Uint8Array): string => ascii(s);
  const src = (o: Op) => text(bytes.subarray(o.start, o.end));

  const show = (index: number, parts: Operand[]) => {
    const font = fonts.get(gs.fontName);
    const trm = mul(tm, gs.ctm);
    const [x, y] = [gs.rise * trm[2] + trm[4], gs.rise * trm[3] + trm[5]];
    const size = gs.size * Math.sqrt(Math.abs(trm[0] * trm[3] - trm[1] * trm[2]));
    let str = "";
    let count = 0;
    for (const p of parts) {
      if (typeof p === "number") {
        const tx = (-p / 1000) * gs.size * gs.th;
        tm = mul([1, 0, 0, 1, tx, 0], tm);
      } else if (typeof p === "object" && p && p.t === "str") {
        for (const code of codesOf(font, p.v)) {
          count++;
          font?.used.add(code);
          str += font?.unicode.get(code) ?? (font ? "�" : String.fromCharCode(code));
          const w = font ? font.width(code) : 0.5;
          const spaceAdj = (font?.bytes ?? 1) === 1 && code === 32 ? gs.tw : 0;
          tm = mul([1, 0, 0, 1, (w * gs.size + gs.tc + spaceAdj) * gs.th, 0], tm);
        }
      }
    }
    const end = mul(tm, gs.ctm);
    shows.push({
      index,
      x,
      y,
      x2: end[4],
      size,
      fontName: gs.fontName,
      font,
      text: str,
      codes: count,
      rise: gs.rise,
      fill: gs.fill.join("\n"),
      upright: Math.abs(trm[1]) < 1e-6 && Math.abs(trm[2]) < 1e-6 && trm[0] > 0 && trm[3] > 0,
      render: gs.render,
    });
  };

  ops.forEach((o, index) => {
    const a = o.args;
    const n = (k: number) => (typeof a[k] === "number" ? (a[k] as number) : 0);
    switch (o.op) {
      case "q":
        stack.push({ ...gs, fill: [...gs.fill] });
        break;
      case "Q":
        gs = stack.pop() ?? gs;
        break;
      case "cm":
        gs.ctm = mul([n(0), n(1), n(2), n(3), n(4), n(5)], gs.ctm);
        break;
      case "g":
      case "rg":
      case "k":
        gs.fill = [src(o)];
        break;
      case "cs":
        gs.fill = [src(o)];
        break;
      case "sc":
      case "scn":
        gs.fill = [...gs.fill.filter((f) => / cs$/.test(f)), src(o)];
        break;
      case "BT":
        tm = ID;
        tlm = ID;
        break;
      case "Tf": {
        const f = a[0];
        if (f && typeof f === "object" && f.t === "name") gs.fontName = f.v;
        gs.size = n(1);
        break;
      }
      case "Tc":
        gs.tc = n(0);
        break;
      case "Tw":
        gs.tw = n(0);
        break;
      case "Tz":
        gs.th = n(0) / 100;
        break;
      case "TL":
        gs.tl = n(0);
        break;
      case "Ts":
        gs.rise = n(0);
        break;
      case "Tr":
        gs.render = n(0);
        break;
      case "Td":
        tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm);
        tm = tlm;
        break;
      case "TD":
        gs.tl = -n(1);
        tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm);
        tm = tlm;
        break;
      case "Tm":
        tlm = [n(0), n(1), n(2), n(3), n(4), n(5)];
        tm = tlm;
        break;
      case "T*":
        tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm);
        tm = tlm;
        break;
      case "Tj":
        show(index, a.slice(0, 1));
        break;
      case "TJ": {
        const arr = a[0];
        if (arr && typeof arr === "object" && arr.t === "arr") show(index, arr.v);
        break;
      }
      case "'":
        tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm);
        tm = tlm;
        show(index, a.slice(0, 1));
        break;
      case '"':
        gs.tw = n(0);
        gs.tc = n(1);
        tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm);
        tm = tlm;
        show(index, a.slice(2, 3));
        break;
    }
  });
  return { ops, bytes, shows };
}

/** The page's content streams, decoded and joined. */
export function pageContent(ctx: PDFContext, contents: PDFObject | undefined): Uint8Array | null {
  const c = look(ctx, contents);
  const parts: Uint8Array[] = [];
  const list = c instanceof PDFArray ? c.asArray().map((x) => look(ctx, x)) : [c];
  for (const s of list) {
    if (!s) continue;
    const b = streamBytes(s);
    if (!b) return null;
    parts.push(b, Uint8Array.of(10));
  }
  const total = parts.reduce((t, p) => t + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
