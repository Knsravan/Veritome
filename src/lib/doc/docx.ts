import JSZip from "jszip";
import { MIME_BY_EXT, TextBuilder, imageUrl, type Block, type DocImage, type DocxModel, type Paragraph, type ParagraphStyle, type Run } from "./model";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const V = "urn:schemas-microsoft-com:vml";

const local = (el: Element) => el.localName;
const kids = (el: Element) => Array.from(el.children);
const wAttr = (el: Element | null | undefined, name: string) => el?.getAttributeNS(W, name) ?? el?.getAttribute(`w:${name}`) ?? null;
const child = (el: Element | null | undefined, name: string) => (el ? (kids(el).find((c) => local(c) === name && (c.namespaceURI === W || !c.namespaceURI)) ?? null) : null);

/** A boolean run property such as <w:b/> or <w:b w:val="0"/>. */
const on = (props: Element | null, name: string) => {
  const el = child(props, name);
  if (!el) return false;
  const v = wAttr(el, "val");
  return v === null || !/^(0|false|off|none)$/i.test(v);
};

function parseXml(s: string): Document {
  return new DOMParser().parseFromString(s, "application/xml");
}

interface Ctx {
  zip: JSZip;
  rels: Map<string, { target: string; external: boolean }>;
  styleNames: Map<string, string>;
  ordered: Map<string, boolean>;
  tb: TextBuilder;
  images: DocImage[];
  imageByTarget: Map<string, string>;
  hidden: Array<{ start: number; end: number }>;
}

function styleOf(ctx: Ctx, pPr: Element | null): ParagraphStyle {
  const id = wAttr(child(pPr, "pStyle"), "val");
  if (!id) return "normal";
  const name = (ctx.styleNames.get(id) ?? id).toLowerCase().replace(/\s+/g, "");
  if (name === "title") return "title";
  const h = name.match(/^heading(\d)/);
  if (h) return (["h1", "h2", "h3", "h4"][Math.min(3, Number(h[1]) - 1)] ?? "h4") as ParagraphStyle;
  if (name === "caption") return "caption";
  if (name.includes("quote")) return "quote";
  return "normal";
}

function isHiddenRun(rPr: Element | null): boolean {
  if (on(rPr, "vanish") || on(rPr, "specVanish")) return true;
  const color = wAttr(child(rPr, "color"), "val")?.toUpperCase();
  const shade = wAttr(child(rPr, "shd"), "fill")?.toUpperCase();
  const highlight = wAttr(child(rPr, "highlight"), "val");
  if (color === "FFFFFF" && (!shade || shade === "AUTO" || shade === "FFFFFF") && (!highlight || highlight === "white" || highlight === "none")) return true;
  const size = Number(wAttr(child(rPr, "sz"), "val") ?? "0");
  return size > 0 && size <= 4; // half-points: 2 pt or smaller
}

/** Images referenced inside a run (DrawingML or legacy VML). */
function runImages(r: Element): string[] {
  const ids: string[] = [];
  for (const blip of Array.from(r.getElementsByTagNameNS(A, "blip"))) {
    const id = blip.getAttributeNS(R, "embed") ?? blip.getAttribute("r:embed");
    if (id) ids.push(id);
  }
  for (const im of Array.from(r.getElementsByTagNameNS(V, "imagedata"))) {
    const id = im.getAttributeNS(R, "id") ?? im.getAttribute("r:id");
    if (id) ids.push(id);
  }
  return ids;
}

async function addImage(ctx: Ctx, relId: string): Promise<string | null> {
  const rel = ctx.rels.get(relId);
  if (!rel || rel.external) return null;
  const path = rel.target.startsWith("/") ? rel.target.slice(1) : `word/${rel.target}`.replace(/word\/\.\.\//, "");
  const known = ctx.imageByTarget.get(path);
  if (known) return known;
  const file = ctx.zip.file(path);
  if (!file) return null;
  const bytes = await file.async("uint8array");
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
  const id = `img${ctx.images.length + 1}`;
  ctx.images.push({ id, src: imageUrl(bytes, mime), mime, bytes, name: path.split("/").pop() ?? id });
  ctx.imageByTarget.set(path, id);
  return id;
}

/** Collects the runs of a paragraph in reading order, through hyperlinks, insertions and content controls. */
async function paragraph(ctx: Ctx, p: Element, figures: string[]): Promise<Paragraph> {
  const pPr = child(p, "pPr");
  const runs: Run[] = [];
  const numPr = child(pPr, "numPr");
  const jc = wAttr(child(pPr, "jc"), "val");
  const para: Paragraph = { kind: "p", style: styleOf(ctx, pPr), runs };
  if (jc === "center" || jc === "right" || jc === "both") para.align = jc === "both" ? "justify" : jc;
  if (numPr) {
    const numId = wAttr(child(numPr, "numId"), "val") ?? "";
    const level = Number(wAttr(child(numPr, "ilvl"), "val") ?? "0");
    if (numId !== "0") para.list = { ordered: ctx.ordered.get(`${numId}:${level}`) ?? false, level };
  }

  const walk = async (el: Element, href?: string) => {
    for (const c of kids(el)) {
      const name = local(c);
      if (name === "r") await run(c, href);
      else if (name === "hyperlink") {
        const rid = c.getAttributeNS(R, "id") ?? c.getAttribute("r:id");
        await walk(c, rid ? ctx.rels.get(rid)?.target : href);
      } else if (name === "ins" || name === "smartTag" || name === "fldSimple" || name === "customXml") await walk(c, href);
      else if (name === "sdt") {
        const content = child(c, "sdtContent");
        if (content) await walk(content, href);
      }
      // w:del (deleted text) and w:pPr are skipped.
    }
  };
  const run = async (r: Element, href?: string) => {
    const rPr = child(r, "rPr");
    const hidden = isHiddenRun(rPr);
    for (const c of kids(r)) {
      const name = local(c);
      let s = "";
      if (name === "t") s = c.textContent ?? "";
      else if (name === "tab") s = "\t";
      else if (name === "br" || name === "cr") s = "\n";
      else if (name === "noBreakHyphen") s = "-";
      else if (name === "drawing" || name === "pict" || name === "object") {
        for (const rel of runImages(c)) {
          const id = await addImage(ctx, rel);
          if (id) figures.push(id);
        }
        continue;
      } else continue;
      if (!s) continue;
      const range = ctx.tb.add(s);
      const va = wAttr(child(rPr, "vertAlign"), "val");
      const u = wAttr(child(rPr, "u"), "val");
      const last = runs[runs.length - 1];
      const out: Run = { text: s, ...range };
      if (on(rPr, "b")) out.bold = true;
      if (on(rPr, "i")) out.italic = true;
      if (u && u !== "none") out.underline = true;
      if (va === "superscript") out.script = "sup";
      else if (va === "subscript") out.script = "sub";
      if (hidden) {
        out.hidden = true;
        const h = ctx.hidden[ctx.hidden.length - 1];
        if (h && h.end === range.start) h.end = range.end;
        else ctx.hidden.push({ ...range });
      }
      if (href) out.href = href;
      // Merge with the previous run when it is formatted the same way.
      if (last && last.end === out.start && last.bold === out.bold && last.italic === out.italic && last.underline === out.underline && last.script === out.script && last.hidden === out.hidden && last.href === out.href) {
        last.text += out.text;
        last.end = out.end;
      } else runs.push(out);
    }
  };
  await walk(p);
  return para;
}

async function blocksOf(ctx: Ctx, container: Element, out: Block[]) {
  for (const el of kids(container)) {
    const name = local(el);
    if (name === "p") {
      const figures: string[] = [];
      const para = await paragraph(ctx, el, figures);
      const hasText = para.runs.some((r) => r.text.trim());
      if (hasText) {
        out.push(para);
        ctx.tb.breakBlock();
      }
      for (const id of figures) out.push({ kind: "image", imageId: id });
    } else if (name === "tbl") {
      const rows: Paragraph[][][] = [];
      for (const tr of kids(el).filter((c) => local(c) === "tr")) {
        const cells: Paragraph[][] = [];
        for (const tc of kids(tr).filter((c) => local(c) === "tc" || local(c) === "sdt")) {
          const cellEl = local(tc) === "sdt" ? (child(tc, "sdtContent")?.firstElementChild ?? tc) : tc;
          const paras: Paragraph[] = [];
          for (const p of kids(cellEl).filter((c) => local(c) === "p")) {
            const figures: string[] = [];
            const para = await paragraph(ctx, p, figures);
            if (para.runs.some((r) => r.text.trim())) {
              paras.push(para);
              ctx.tb.add("\n");
            }
          }
          cells.push(paras);
        }
        rows.push(cells);
      }
      if (rows.some((r) => r.some((c) => c.length))) out.push({ kind: "table", rows });
      ctx.tb.breakBlock();
    } else if (name === "sdt") {
      const content = child(el, "sdtContent");
      if (content) await blocksOf(ctx, content, out);
    }
  }
}

/** Reads a .docx file in the browser, keeping headings, emphasis, lists, tables and images. */
export async function readDocx(name: string, data: ArrayBuffer | Uint8Array): Promise<DocxModel> {
  const zip = await JSZip.loadAsync(data);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("This does not look like a Word document.");
  const doc = parseXml(await docFile.async("string"));
  const rels = new Map<string, { target: string; external: boolean }>();
  const relFile = zip.file("word/_rels/document.xml.rels");
  if (relFile) {
    for (const r of Array.from(parseXml(await relFile.async("string")).getElementsByTagName("Relationship"))) {
      rels.set(r.getAttribute("Id") ?? "", { target: r.getAttribute("Target") ?? "", external: r.getAttribute("TargetMode") === "External" });
    }
  }
  const styleNames = new Map<string, string>();
  const stylesFile = zip.file("word/styles.xml");
  if (stylesFile) {
    for (const s of Array.from(parseXml(await stylesFile.async("string")).getElementsByTagNameNS(W, "style"))) {
      const id = wAttr(s, "styleId");
      const n = wAttr(child(s, "name"), "val");
      if (id && n) styleNames.set(id, n);
    }
  }
  const ordered = new Map<string, boolean>();
  const numFile = zip.file("word/numbering.xml");
  if (numFile) {
    const nx = parseXml(await numFile.async("string"));
    const abstract = new Map<string, Map<number, boolean>>();
    for (const an of Array.from(nx.getElementsByTagNameNS(W, "abstractNum"))) {
      const levels = new Map<number, boolean>();
      for (const lvl of kids(an).filter((c) => local(c) === "lvl")) {
        const fmt = wAttr(child(lvl, "numFmt"), "val") ?? "bullet";
        levels.set(Number(wAttr(lvl, "ilvl") ?? "0"), fmt !== "bullet" && fmt !== "none");
      }
      abstract.set(wAttr(an, "abstractNumId") ?? "", levels);
    }
    for (const num of Array.from(nx.getElementsByTagNameNS(W, "num"))) {
      const levels = abstract.get(wAttr(child(num, "abstractNumId"), "val") ?? "");
      if (levels) for (const [lvl, o] of levels) ordered.set(`${wAttr(num, "numId")}:${lvl}`, o);
    }
  }

  const body = doc.getElementsByTagNameNS(W, "body")[0];
  if (!body) throw new Error("The Word document has no body.");
  const ctx: Ctx = { zip, rels, styleNames, ordered, tb: new TextBuilder(), images: [], imageByTarget: new Map(), hidden: [] };
  const blocks: Block[] = [];
  await blocksOf(ctx, body, blocks);
  const raw = ctx.tb.toString();
  // Trailing block separators are trimmed; nothing before them moves.
  const text = raw.replace(/\s+$/, "");
  const warnings: string[] = [];
  const unshown = ctx.images.filter((i) => !i.src).length;
  if (unshown) warnings.push(`${unshown} image${unshown === 1 ? " is" : "s are"} in a format browsers cannot show (such as EMF), so ${unshown === 1 ? "it is" : "they are"} listed but not displayed.`);
  return { kind: "docx", name, text, blocks, images: ctx.images, hidden: ctx.hidden.filter((h) => h.start < text.length).map((h) => ({ start: h.start, end: Math.min(h.end, text.length) })), warnings };
}
