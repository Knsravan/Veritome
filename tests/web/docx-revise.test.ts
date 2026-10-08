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
