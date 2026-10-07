import JSZip from "jszip";
import { SAMPLE_PAPER } from "./sample";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The sample paper as a real Word file, so trying the tool shows the same layout view as an upload. */
export async function sampleDocx(): Promise<File> {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const paras = SAMPLE_PAPER.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const body = paras
    .map((p, i) => {
      const style = i === 0 ? "Title" : /^references$/i.test(p) ? "Heading1" : "";
      return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${p
        .split("\n")
        .map((line, k) => `${k ? "<w:r><w:br/></w:r>" : ""}<w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`)
        .join("")}</w:p>`;
    })
    .join("");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/styles.xml", `<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  return new File([blob], "Sample paper.docx", { type: blob.type });
}
