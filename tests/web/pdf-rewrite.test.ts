import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { paragraphEdits, planParagraphs } from "@/core/rewrite/humanise";
import { readPdf } from "@/lib/doc/pdf";
import { rewritePdf } from "@/lib/doc/pdf-rewrite";

const flat = (s: string) => s.replace(/\s+/g, " ");

describe("rewritePdf", () => {
  it("sets new paragraph text in place in the PDF's own fonts and leaves the rest of the page alone", async () => {
    const data = new Uint8Array(readFileSync("tests/fixtures/humanise.pdf"));
    const doc = await readPdf("humanise.pdf", data);
    const pieces = planParagraphs(doc.text);
    // The title and the heading are left out of the rewrite, each on its own.
    expect(pieces.filter((p) => !p.rewrite).map((p) => p.text)).toEqual(["Secure Quantum Communication in Practice", "1. Introduction"]);
    const edits = paragraphEdits(
      doc.text,
      pieces,
      pieces.map((p) =>
        p.text.startsWith("Furthermore")
          ? "The framework uses several techniques to deal with noise and loss in optical channels. In 120 trials over 25 km of fibre, the secret key rate was 1.2 kbps [3]."
          : p.text,
      ),
    );
    expect(edits.length).toBe(3);
    const out = await rewritePdf(doc, edits);
    expect(out.applied).toBe(3);
    expect(out.skipped).toBe(0);
    const again = await readPdf("out.pdf", out.bytes);
    const text = flat(again.text);
    expect(text).toContain("The framework uses several techniques to deal with noise and loss in optical channels.");
    expect(text).not.toContain("Furthermore, the proposed framework leverages");
    // Untouched text and the page count stay.
    expect(text).toContain("Moreover, it is worth noting that the integration of machine learning");
    expect(text).toContain("Secure Quantum Communication in Practice");
    expect(again.pages.length).toBe(doc.pages.length);
    // Letters the file already draws are written in its embedded fonts: no standard font is added.
    const pdf = await PDFDocument.load(out.bytes);
    const fonts = pdf.getPages().flatMap((p) => p.node.Resources()?.toString().match(/\/Vt[FR]\d*/g) ?? []);
    expect(fonts).toEqual([]);
  });

  it("leaves a paragraph alone when it cannot be replaced safely", async () => {
    const data = new Uint8Array(readFileSync("tests/fixtures/humanise.pdf"));
    const doc = await readPdf("humanise.pdf", data);
    const first = planParagraphs(doc.text).find((p) => p.rewrite)!;
    const title = doc.text.indexOf("Secure Quantum");
    // A heading and a paragraph together: different text sizes.
    const out = await rewritePdf(doc, [
      { start: title, end: first.end, text: "A heading and a paragraph joined." },
      { start: first.start, end: first.end, text: `${first.text} ${"More words here. ".repeat(60)}` },
    ]);
    expect(out.applied).toBe(0);
    expect(out.skipped).toBe(2);
    expect([...out.reasons.values()].join(" ")).toMatch(/different sizes/);
    expect([...out.reasons.values()].join(" ")).toMatch(/does not fit/);
    expect(flat((await readPdf("out.pdf", out.bytes)).text)).toContain(flat(first.text));
  });
});
