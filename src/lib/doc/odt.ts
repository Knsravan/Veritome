import JSZip from "jszip";
import { MIME_BY_EXT, TextBuilder, imageUrl, type Block, type DocImage, type DocxModel, type Paragraph, type Run } from "./model";

const TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
const TABLE = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
const DRAW = "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0";
const XLINK = "http://www.w3.org/1999/xlink";

/**
 * Reads an OpenDocument text file (.odt, from LibreOffice or Google Docs) in the browser into the same structured
 * model as Word files: headings, paragraphs, lists, tables and images, with offsets into the checked text.
 */
export async function readOdt(name: string, data: Uint8Array): Promise<DocxModel> {
  const zip = await JSZip.loadAsync(data);
  const file = zip.file("content.xml");
  if (!file) throw new Error("This does not look like an OpenDocument text file.");
  const xml = new DOMParser().parseFromString(await file.async("string"), "application/xml");
  const body = xml.getElementsByTagNameNS("urn:oasis:names:tc:opendocument:xmlns:office:1.0", "text")[0];
  if (!body) throw new Error("The document has no text.");
  const tb = new TextBuilder();
  const images: DocImage[] = [];
  const blocks: Block[] = [];

  const runsOf = (el: Element): Run[] => {
    const runs: Run[] = [];
    const walk = (n: Node) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const s = n.nodeValue ?? "";
        if (s) runs.push({ text: s, ...tb.add(s) });
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const e = n as Element;
      if (e.namespaceURI === TEXT) {
        if (e.localName === "s") {
          const c = Number(e.getAttributeNS(TEXT, "c") ?? "1");
          runs.push({ text: " ".repeat(c), ...tb.add(" ".repeat(c)) });
          return;
        }
        if (e.localName === "tab") return void runs.push({ text: "\t", ...tb.add("\t") });
        if (e.localName === "line-break") return void runs.push({ text: "\n", ...tb.add("\n") });
        if (e.localName === "note" || e.localName === "tracked-changes") return;
      }
      if (e.namespaceURI === DRAW) return;
      for (const c of Array.from(e.childNodes)) walk(c);
    };
    walk(el);
    return runs;
  };

  const addImages = async (el: Element) => {
    for (const img of Array.from(el.getElementsByTagNameNS(DRAW, "image"))) {
      const href = img.getAttributeNS(XLINK, "href") ?? "";
      const f = href ? zip.file(href) : null;
      if (!f) continue;
      const bytes = await f.async("uint8array");
      const mime = MIME_BY_EXT[href.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
      const id = `img${images.length + 1}`;
      images.push({ id, src: imageUrl(bytes, mime), mime, bytes, name: href.split("/").pop() ?? id });
      blocks.push({ kind: "image", imageId: id });
    }
  };

  const paragraph = (el: Element, list?: { ordered: boolean; level: number }): Paragraph => {
    const level = Number(el.getAttributeNS(TEXT, "outline-level") ?? "1");
    const style = el.localName === "h" ? (["h1", "h2", "h3", "h4"][Math.min(3, level - 1)] as Paragraph["style"]) : "normal";
    const p: Paragraph = { kind: "p", style, runs: runsOf(el) };
    if (list) p.list = list;
    return p;
  };

  const visit = async (container: Element, list?: { ordered: boolean; level: number }) => {
    for (const el of Array.from(container.children)) {
      if (el.namespaceURI === TEXT && (el.localName === "p" || el.localName === "h")) {
        const p = paragraph(el, list);
        if (p.runs.some((r) => r.text.trim())) {
          blocks.push(p);
          tb.breakBlock();
        }
        await addImages(el);
      } else if (el.namespaceURI === TEXT && el.localName === "list") {
        const level = list ? list.level + 1 : 0;
        for (const item of Array.from(el.children)) await visit(item, { ordered: false, level });
      } else if (el.namespaceURI === TEXT && (el.localName === "list-item" || el.localName === "section")) await visit(el, list);
      else if (el.namespaceURI === TABLE && el.localName === "table") {
        const rows: Paragraph[][][] = [];
        for (const tr of Array.from(el.getElementsByTagNameNS(TABLE, "table-row"))) {
          const cells: Paragraph[][] = [];
          for (const tc of Array.from(tr.getElementsByTagNameNS(TABLE, "table-cell"))) {
            const paras: Paragraph[] = [];
            for (const p of Array.from(tc.getElementsByTagNameNS(TEXT, "p"))) {
              const para = paragraph(p);
              if (para.runs.some((r) => r.text.trim())) {
                paras.push(para);
                tb.add("\n");
              }
            }
            cells.push(paras);
          }
          rows.push(cells);
        }
        if (rows.length) blocks.push({ kind: "table", rows });
        tb.breakBlock();
      }
    }
  };
  await visit(body);
  const text = tb.toString().replace(/\s+$/, "");
  return { kind: "docx", name, text, blocks, images, hidden: [], warnings: ["OpenDocument files are shown with their headings, lists, tables and pictures; the exact page layout is shown for Word and PDF files."] };
}
