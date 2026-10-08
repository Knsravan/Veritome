/**
 * Writes the Humaniser's accepted rewrites into Word files. For an uploaded Word file every rewritten paragraph
 * becomes a tracked change (the old text deleted, the new text inserted), so the author reviews each one in Word
 * and everything else in the file stays as it was. For other sources, a plain new Word file is made.
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
  author = "Veritome Humaniser",
): Promise<{ blob: Blob; applied: number; skipped: number }> {
  const texts: Array<{ t: Element; start: number; end: number }> = [];
  const { zip, xml } = await readDocxParts(name, data, (t, range) => texts.push({ t, ...range }));
  const date = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  let id = 9000;
  let applied = 0;
  let skipped = 0;
  const el = (n: string) => xml.createElementNS(W, `w:${n}`);

  for (const edit of edits) {
    const hits = texts.filter((x) => x.start < edit.end && x.end > edit.start);
    const paras = new Set(hits.map((x) => findAncestor(x.t, "p")));
    const p = paras.size === 1 ? [...paras][0] : null;
    if (!p || !hits.length) {
      skipped++;
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
      skipped++;
      continue;
    }
    const runs = Array.from(p.children).filter((c) => c.localName === "r");
    const firstPr = runs[0] ? Array.from(runs[0].children).find((c) => c.localName === "rPr") : undefined;
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
    // New text: one run in the first run's formatting, inside an insertion.
    const ins = el("ins");
    ins.setAttributeNS(W, "w:id", String(id++));
    ins.setAttributeNS(W, "w:author", author);
    ins.setAttributeNS(W, "w:date", date);
    const r = el("r");
    if (firstPr) r.appendChild(firstPr.cloneNode(true));
    const t = el("t");
    t.setAttributeNS(XML_NS, "xml:space", "preserve");
    t.textContent = edit.text;
    r.appendChild(t);
    ins.appendChild(r);
    p.insertBefore(ins, del.nextSibling);
    applied++;
  }

  zip.file("word/document.xml", new XMLSerializer().serializeToString(xml));
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });
  return { blob, applied, skipped };
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
