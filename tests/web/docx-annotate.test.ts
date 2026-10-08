import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readDocx } from "@/lib/doc/docx";
import { annotateDocx } from "@/lib/doc/docx-annotate";
import { makeDocx } from "./docx-helper";

const p = (t: string, rPr = "") => `<w:p><w:r>${rPr}<w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;

describe("annotateDocx", () => {
  it("underlines exactly the marked words with a wavy line and adds a numbered comment, leaving the rest as it was", async () => {
    const data = await makeDocx(p("First paragraph stays as it is.") + p("Second has a polished middle part here.", "<w:rPr><w:b/><w:sz w:val=\"24\"/></w:rPr>"));
    const doc = await readDocx("t.docx", data);
    const start = doc.text.indexOf("polished middle part");
    const blob = await annotateDocx("t.docx", data, [{ start, end: start + "polished middle part".length, color: "8B5CF6", style: "wave", comment: "[1] Reads as AI-written" }]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain('w:val="wave"');
    expect(xml).toContain('w:color="8B5CF6"');
    expect(xml).toContain("commentReference");
    // The marked words are in their own run, bold kept, with the underline after the size (schema order).
    expect(xml).toMatch(/<w:r><w:rPr><w:b\/><w:sz w:val="24"\/><w:u w:val="wave" w:color="8B5CF6"\/><\/w:rPr><w:t xml:space="preserve">polished middle part<\/w:t><\/w:r>/);
    expect(xml).toContain(">Second has a <");
    expect(xml).toContain("> here.<");
    expect(xml).toContain("First paragraph stays as it is.");
    const comments = await zip.file("word/comments.xml")!.async("string");
    expect(comments).toContain("[1] Reads as AI-written");
    expect(await zip.file("[Content_Types].xml")!.async("string")).toContain("/word/comments.xml");
    expect(await zip.file("word/_rels/document.xml.rels")!.async("string")).toContain('Target="comments.xml"');
    // The marked file reads back to the same text.
    expect((await readDocx("t.docx", new Uint8Array(await blob.arrayBuffer()))).text).toBe(doc.text);
  });

  it("works on a file without a relationships part", async () => {
    const data = await makeDocx(p("Only one paragraph to mark here."));
    const zip0 = await JSZip.loadAsync(data);
    zip0.remove("word/_rels/document.xml.rels");
    const bare = await zip0.generateAsync({ type: "uint8array" });
    const blob = await annotateDocx("t.docx", bare, [{ start: 0, end: 4, color: "DC2626", style: "wavyDouble", comment: "[1] Note" }]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(await zip.file("word/_rels/document.xml.rels")!.async("string")).toContain("comments.xml");
  });
});
