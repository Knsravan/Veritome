/**
 * Marks findings in the original Word file and nothing else: the flagged words get a coloured wavy underline, and
 * each finding a numbered comment in the margin explaining it. Every other byte of the document (fonts, layout,
 * styles, images, equations) is left as it was.
 */
import { readDocxParts } from "./docx";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const COMMENTS_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const COMMENTS_CT =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";

export type WordUnderline = "wave" | "wavyHeavy" | "wavyDouble" | "dash";

export interface WordMark {
  start: number;
  end: number;
  /** Hex colour without "#". */
  color: string;
  style: WordUnderline;
  /** Shown as a margin comment, numbered like the report. */
  comment?: string;
}

/** rPr children that must come after w:u (the schema fixes their order). */
const AFTER_U = new Set([
  "effect",
  "bdr",
  "shd",
  "fitText",
  "vertAlign",
  "rtl",
  "cs",
  "em",
  "lang",
  "eastAsianLayout",
  "specVanish",
  "oMath",
]);

const el = (doc: Document, name: string) => doc.createElementNS(W, `w:${name}`);

function setUnderline(doc: Document, rPr: Element, mark: WordMark) {
  for (const u of Array.from(rPr.children).filter((c) => c.localName === "u"))
    u.remove();
  const u = el(doc, "u");
  u.setAttributeNS(W, "w:val", mark.style);
  u.setAttributeNS(W, "w:color", mark.color);
  const before = Array.from(rPr.children).find((c) => AFTER_U.has(c.localName));
  rPr.insertBefore(u, before ?? null);
}

export async function annotateDocx(
  name: string,
  data: Uint8Array,
  marks: readonly WordMark[],
  author = "Veritome",
): Promise<Blob> {
  const texts: Array<{ t: Element; start: number; end: number }> = [];
  const { zip, xml } = await readDocxParts(name, data, (t, range) =>
    texts.push({ t, ...range }),
  );
  const doc = xml;
  const ordered = [...marks]
    .filter((m) => m.end > m.start)
    .sort((a, b) => a.start - b.start);
  // First and last run of each finding, for its comment range.
  const firstRun = new Map<number, Element>();
  const lastRun = new Map<number, Element>();

  for (const { t, start, end } of texts) {
    const hits = ordered
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.start < end && m.end > start);
    if (!hits.length) continue;
    const r = t.parentElement;
    if (!r || r.localName !== "r") continue;
    const parent = r.parentNode!;
    const rPr =
      Array.from(r.children).find((c) => c.localName === "rPr") ?? null;
    const newRun = (contents: Node[]) => {
      const nr = r.cloneNode(false) as Element;
      if (rPr) nr.appendChild(rPr.cloneNode(true));
      for (const c of contents) nr.appendChild(c);
      return nr;
    };
    const kids = Array.from(r.childNodes).filter((c) => c !== rPr);
    const at = kids.indexOf(t);
    const before = kids.slice(0, at);
    const after = kids.slice(at + 1);

    // Cut the text where marks begin and end.
    const text = t.textContent ?? "";
    const cuts = new Set([0, text.length]);
    for (const { m } of hits) {
      cuts.add(Math.max(0, m.start - start));
      cuts.add(Math.min(text.length, m.end - start));
    }
    const points = [...cuts].sort((a, b) => a - b);
    const pieces: Element[] = [];
    for (let k = 0; k + 1 < points.length; k++) {
      const a = points[k]!;
      const b = points[k + 1]!;
      if (b <= a) continue;
      const nt = el(doc, "t");
      nt.setAttributeNS(XML_NS, "xml:space", "preserve");
      nt.textContent = text.slice(a, b);
      const run = newRun([nt]);
      const covering = hits.filter(
        ({ m }) => m.start < start + b && m.end > start + a,
      );
      if (covering.length) {
        let pr = Array.from(run.children).find((c) => c.localName === "rPr");
        if (!pr) {
          pr = el(doc, "rPr");
          run.insertBefore(pr, run.firstChild);
        }
        setUnderline(doc, pr, covering[0]!.m);
        for (const { i } of covering) {
          if (!firstRun.has(i)) firstRun.set(i, run);
          lastRun.set(i, run);
        }
      }
      pieces.push(run);
    }
    if (before.length) parent.insertBefore(newRun(before), r);
    for (const p of pieces) parent.insertBefore(p, r);
    if (after.length) parent.insertBefore(newRun(after), r);
    parent.removeChild(r);
  }

  // Numbered comments in the margin.
  const withComment = ordered
    .map((m, i) => ({ m, i }))
    .filter(({ m, i }) => m.comment && firstRun.has(i));
  if (withComment.length) {
    const path = "word/comments.xml";
    const existing = zip.file(path);
    const cdoc = existing
      ? new DOMParser().parseFromString(
          await existing.async("string"),
          "application/xml",
        )
      : new DOMParser().parseFromString(
          `<w:comments xmlns:w="${W}"/>`,
          "application/xml",
        );
    const root = cdoc.documentElement;
    let nextId =
      Math.max(
        -1,
        ...Array.from(cdoc.getElementsByTagNameNS(W, "comment")).map((c) =>
          Number(c.getAttributeNS(W, "id") ?? c.getAttribute("w:id") ?? -1),
        ),
      ) + 1;
    const date = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    for (const { m, i } of withComment) {
      const id = String(nextId++);
      const c = cdoc.createElementNS(W, "w:comment");
      c.setAttributeNS(W, "w:id", id);
      c.setAttributeNS(W, "w:author", author);
      c.setAttributeNS(W, "w:initials", "V");
      c.setAttributeNS(W, "w:date", date);
      for (const line of m.comment!.split("\n")) {
        const p = cdoc.createElementNS(W, "w:p");
        const r = cdoc.createElementNS(W, "w:r");
        const t = cdoc.createElementNS(W, "w:t");
        t.setAttributeNS(XML_NS, "xml:space", "preserve");
        t.textContent = line;
        r.appendChild(t);
        p.appendChild(r);
        c.appendChild(p);
      }
      root.appendChild(c);
      const first = firstRun.get(i)!;
      const last = lastRun.get(i)!;
      const rs = el(doc, "commentRangeStart");
      rs.setAttributeNS(W, "w:id", id);
      first.parentNode!.insertBefore(rs, first);
      const re = el(doc, "commentRangeEnd");
      re.setAttributeNS(W, "w:id", id);
      last.parentNode!.insertBefore(re, last.nextSibling);
      const refRun = el(doc, "r");
      const ref = el(doc, "commentReference");
      ref.setAttributeNS(W, "w:id", id);
      refRun.appendChild(ref);
      last.parentNode!.insertBefore(refRun, re.nextSibling);
    }
    zip.file(path, new XMLSerializer().serializeToString(cdoc));
    if (!existing) {
      const relPath = "word/_rels/document.xml.rels";
      const relFile = zip.file(relPath);
      const rels = new DOMParser().parseFromString(
        relFile
          ? await relFile.async("string")
          : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
        "application/xml",
      );
      const ids = new Set(
        Array.from(rels.getElementsByTagName("Relationship")).map((x) =>
          x.getAttribute("Id"),
        ),
      );
      let n = 1;
      while (ids.has(`rIdVt${n}`)) n++;
      const rel = rels.createElementNS(
        rels.documentElement.namespaceURI,
        "Relationship",
      );
      rel.setAttribute("Id", `rIdVt${n}`);
      rel.setAttribute("Type", COMMENTS_TYPE);
      rel.setAttribute("Target", "comments.xml");
      rels.documentElement.appendChild(rel);
      zip.file(relPath, new XMLSerializer().serializeToString(rels));
      const ctPath = "[Content_Types].xml";
      const ct = new DOMParser().parseFromString(
        await zip.file(ctPath)!.async("string"),
        "application/xml",
      );
      if (
        !Array.from(ct.getElementsByTagName("Override")).some(
          (o) => o.getAttribute("PartName") === "/word/comments.xml",
        )
      ) {
        const o = ct.createElementNS(
          ct.documentElement.namespaceURI,
          "Override",
        );
        o.setAttribute("PartName", "/word/comments.xml");
        o.setAttribute("ContentType", COMMENTS_CT);
        ct.documentElement.appendChild(o);
        zip.file(ctPath, new XMLSerializer().serializeToString(ct));
      }
    }
  }

  zip.file("word/document.xml", new XMLSerializer().serializeToString(doc));
  return zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });
}
