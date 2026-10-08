import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readDocx } from "@/lib/doc/docx";
import { plainDocx, reviseDocx } from "@/lib/doc/docx-revise";
import { IMAGE_RUN, makeDocx } from "./docx-helper";

const p = (t: string, rPr = "") => `<w:p><w:r>${rPr}<w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;

describe("reviseDocx", () => {
  it("turns each rewritten paragraph into a tracked change and leaves the rest of the file alone", async () => {
    const first = "First paragraph stays exactly as it is in the file.";
    const second = "It is important to note that the method plays a crucial role.";
    const data = await makeDocx(p(first) + p(second, '<w:rPr><w:i/></w:rPr>') + `<w:p>${IMAGE_RUN}<w:r><w:t>A caption next to a picture.</w:t></w:r></w:p>`);
    const doc = await readDocx("t.docx", data);
    const s = doc.text.indexOf(second);
    const c = doc.text.indexOf("A caption");
    const out = await reviseDocx("t.docx", data, [
      { start: s, end: s + second.length, text: "The method is central." },
      { start: c, end: c + "A caption next to a picture.".length, text: "New caption." },
    ]);
    expect(out.applied).toBe(1);
    expect(out.skipped).toBe(1); // the paragraph with a picture is not touched
    const xml = await (await JSZip.loadAsync(await out.blob.arrayBuffer())).file("word/document.xml")!.async("string");
    expect(xml).toMatch(/<w:del [^>]*w:author="Veritome Humaniser"[^>]*>.*<w:delText[^>]*>It is important to note that the method plays a crucial role\.<\/w:delText>/);
    expect(xml).toMatch(/<w:ins [^>]*>.*<w:rPr><w:i\/><\/w:rPr><w:t xml:space="preserve">The method is central\.<\/w:t>/);
    expect(xml).toContain(first);
    expect(xml).toContain("A caption next to a picture.");
  });

  it("makes a valid new Word file from plain paragraphs", async () => {
    const blob = await plainDocx(["One & two < three.", "Second paragraph."]);
    const doc = await readDocx("n.docx", new Uint8Array(await blob.arrayBuffer()));
    expect(doc.text).toContain("One & two < three.");
    expect(doc.text).toContain("Second paragraph.");
  });
});

describe("reviseDocx clean mode", () => {
  it("replaces the paragraph in its own formatting and keeps italic words that are still there", async () => {
    const body = `<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Georgia"/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">Moreover, the bacterium </w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Georgia"/><w:i/><w:sz w:val="22"/></w:rPr><w:t>E. coli</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Georgia"/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve"> plays a pivotal role in the study of growth.</w:t></w:r></w:p>`;
    const data = await makeDocx(body);
    const doc = await readDocx("t.docx", data);
    const out = await reviseDocx("t.docx", data, [{ start: 0, end: doc.text.length, text: "We grew E. coli to study how cells divide." }], { mode: "clean" });
    expect(out.applied).toBe(1);
    const xml = await (await JSZip.loadAsync(await out.blob.arrayBuffer())).file("word/document.xml")!.async("string");
    expect(xml).not.toMatch(/<w:(ins|del)\b/);
    expect(xml).toContain('<w:jc w:val="both"/>');
    expect(xml).toMatch(/<w:rFonts w:ascii="Georgia"\/><w:sz w:val="22"\/><\/w:rPr><w:t xml:space="preserve">We grew <\/w:t>/);
    expect(xml).toMatch(/<w:i\/>.*<w:t xml:space="preserve">E\. coli<\/w:t>/);
    expect(xml).not.toContain("pivotal");
    const again = await readDocx("o.docx", new Uint8Array(await out.blob.arrayBuffer()));
    expect(again.text).toBe("We grew E. coli to study how cells divide.");
  });
});
