/**
 * Writes the Humaniser's accepted rewrites into Word files. An uploaded Word file comes back as the same file with
 * each rewritten paragraph replaced in its own formatting, either directly ("clean") or as a tracked change (the old
 * text deleted, the new text inserted) to review in Word. Everything else in the file stays as it was. For other
 * sources, a plain new Word file is made.
 */
import JSZip from "jszip";
import { readDocxParts } from "./docx";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

export interface ParagraphEdit {
  /** Offsets of the paragraph in the document's checked text. */
  start: number;
  end: number;
  text: string;
}

/** Paragraph children and run children that a plain paragraph of text may hold. */
const PARA_OK = new Set(["pPr", "r", "bookmarkStart", "bookmarkEnd", "proofErr", "commentRangeStart", "commentRangeEnd"]);
const RUN_OK = new Set(["rPr", "t", "tab", "br", "lastRenderedPageBreak", "softHyphen"]);

/**
 * The original Word file with each edit as a tracked change. Paragraphs that hold equations, pictures, fields or
 * footnotes, or whose text spans several paragraphs, are left alone and counted in `skipped`.
 */
export async function reviseDocx(
  name: string,
  data: Uint8Array,
  edits: readonly ParagraphEdit[],
  options: { mode?: "tracked" | "clean"; author?: string } = {},
): Promise<{ blob: Blob; applied: number; skipped: number; skippedAt: number[] }> {
  const mode = options.mode ?? "tracked";
  const author = options.author ?? "Veritome Humaniser";
  const texts: Array<{ t: Element; start: number; end: number }> = [];
  const { zip, xml } = await readDocxParts(name, data, (t, range) => texts.push({ t, ...range }));
  const date = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  let id = 9000;
  let applied = 0;
  const skippedAt: number[] = [];
  const el = (n: string) => xml.createElementNS(W, `w:${n}`);

  for (const edit of edits) {
    const hits = texts.filter((x) => x.start < edit.end && x.end > edit.start);
    const paras = new Set(hits.map((x) => findAncestor(x.t, "p")));
    const p = paras.size === 1 ? [...paras][0] : null;
    if (!p || !hits.length) {
      skippedAt.push(edit.start);
      continue;
    }
    const all = texts.filter((x) => findAncestor(x.t, "p") === p);
    const covers = all.every((x) => x.start >= edit.start - 1 && x.end <= edit.end + 1);
    const plain =
      Array.from(p.children).every((c) => PARA_OK.has(c.localName)) &&
      Array.from(p.children)
        .filter((c) => c.localName === "r")
        .every((r) => Array.from(r.children).every((c) => RUN_OK.has(c.localName)));
    if (!covers || !plain) {
      skippedAt.push(edit.start);
      continue;
    }
    const runs = Array.from(p.children).filter((c) => c.localName === "r");
    const fresh = newRuns(xml, runs, edit.text);
    if (mode === "clean") {
      // The new runs take the place of the old ones; bookmarks and the paragraph's own settings stay.
      const anchor = runs[0] ?? null;
      for (const r of fresh) p.insertBefore(r, anchor);
      for (const r of runs) r.remove();
      applied++;
      continue;
    }
    // Old text: the existing runs inside a deletion, with their text marked as deleted text.
    const del = el("del");
    del.setAttributeNS(W, "w:id", String(id++));
    del.setAttributeNS(W, "w:author", author);
    del.setAttributeNS(W, "w:date", date);
    p.insertBefore(del, runs[0] ?? null);
    for (const r of runs) {
      for (const t of Array.from(r.children).filter((c) => c.localName === "t")) {
        const dt = el("delText");
        dt.setAttributeNS(XML_NS, "xml:space", "preserve");
        dt.textContent = t.textContent;
        r.replaceChild(dt, t);
      }
      del.appendChild(r);
    }
    // New text: inside an insertion, in the paragraph's own formatting.
    const ins = el("ins");
    ins.setAttributeNS(W, "w:id", String(id++));
    ins.setAttributeNS(W, "w:author", author);
    ins.setAttributeNS(W, "w:date", date);
    for (const r of fresh) ins.appendChild(r);
    p.insertBefore(ins, del.nextSibling);
    applied++;
  }

  zip.file("word/document.xml", new XMLSerializer().serializeToString(xml));
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });
  return { blob, applied, skipped: skippedAt.length, skippedAt };
}

/**
 * Runs for a paragraph's new text in its own formatting. The text takes the formatting most of the old paragraph
 * had; words that were set differently (italic names, bold terms, superscript markers) and are still in the new
 * text keep their own formatting.
 */
export function newRuns(xml: Document, runs: readonly Element[], text: string): Element[] {
  const ser = new XMLSerializer();
  const prOf = (r: Element) => Array.from(r.children).find((c) => c.localName === "rPr");
  const textOf = (r: Element) =>
    Array.from(r.children)
      .map((c) => (c.localName === "t" || c.localName === "delText" ? (c.textContent ?? "") : c.localName === "tab" ? "\t" : ""))
      .join("");
  const info = runs.map((r) => {
    const pr = prOf(r);
    return { pr, key: pr ? ser.serializeToString(pr).replace(/\s*w:rsid\w*="[^"]*"/g, "") : "", text: textOf(r) };
  });
  const weight = new Map<string, number>();
  for (const x of info) weight.set(x.key, (weight.get(x.key) ?? 0) + x.text.length);
  const mainKey = [...weight].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const mainPr = info.find((x) => x.key === mainKey)?.pr;
  // Formatting per character of the new text.
  const prAt: Array<Element | undefined> = Array.from(text, () => mainPr);
  let cursor = 0;
  for (const x of info) {
    const t = x.text.trim();
    if (x.key === mainKey || !t) continue;
    const at = text.indexOf(t, cursor);
    if (at < 0) continue;
    for (let k = at; k < at + t.length; k++) prAt[k] = x.pr;
    cursor = at + t.length;
  }
  const out: Element[] = [];
  let k = 0;
  while (k < text.length) {
    const pr = prAt[k];
    let j = k + 1;
    while (j < text.length && prAt[j] === pr) j++;
    const r = xml.createElementNS(W, "w:r");
    if (pr) r.appendChild(pr.cloneNode(true));
    const t = xml.createElementNS(W, "w:t");
    t.setAttributeNS(XML_NS, "xml:space", "preserve");
    t.textContent = text.slice(k, j);
    r.appendChild(t);
    out.push(r);
    k = j;
  }
  return out;
}

function findAncestor(node: Element, local: string): Element | null {
  let n: Element | null = node.parentElement;
  while (n && n.localName !== local) n = n.parentElement;
  return n;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A simple new Word file holding the given paragraphs (A4, 1-inch margins, 12 pt Times New Roman). */
export async function plainDocx(paragraphs: readonly string[]): Promise<Blob> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  const rPr = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/></w:rPr>';
  const body = paragraphs
    .map((p) => `<w:p><w:pPr><w:spacing w:after="200" w:line="360" w:lineRule="auto"/></w:pPr><w:r>${rPr}<w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`)
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });
}
