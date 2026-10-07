import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocumentView, segmentMarks } from "@/components/DocumentView";
import { readDocx } from "@/lib/doc/docx";
import { IMAGE_RUN, PNG_1PX, makeDocx } from "./docx-helper";

const BODY =
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Introduction</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">Soil respiration was </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>high</w:t></w:r><w:r><w:t xml:space="preserve"> in October.</w:t></w:r>' +
  '<w:r><w:rPr><w:color w:val="FFFFFF"/></w:rPr><w:t xml:space="preserve"> secret padding words</w:t></w:r></w:p>' +
  `<w:p>${IMAGE_RUN}</w:p>` +
  "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Site</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Rate</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" +
  '<w:p><w:r><w:t xml:space="preserve">Deleted </w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:r><w:t>end.</w:t></w:r></w:p>';

describe("readDocx", () => {
  it("keeps headings, emphasis, images and tables, and offsets match the text", async () => {
    const doc = await readDocx("paper.docx", await makeDocx(BODY, { image: PNG_1PX }));
    expect(doc.text).toBe("Introduction\n\nSoil respiration was high in October. secret padding words\n\nSite\nRate\n\nDeleted end.");
    const [h, p] = doc.blocks;
    expect(h).toMatchObject({ kind: "p", style: "h1" });
    const bold = (p as { runs: Array<{ text: string; bold?: boolean; start: number; end: number }> }).runs.find((r) => r.bold)!;
    expect(bold.text).toBe("high");
    expect(doc.text.slice(bold.start, bold.end)).toBe("high");
    expect(doc.images).toHaveLength(1);
    expect(doc.blocks.some((b) => b.kind === "image")).toBe(true);
    expect(doc.blocks.some((b) => b.kind === "table")).toBe(true);
    // White text is reported as hidden.
    expect(doc.hidden.map((r) => doc.text.slice(r.start, r.end))).toEqual([" secret padding words"]);
  });
});

describe("segmentMarks", () => {
  it("splits overlapping marks into segments that list every covering mark in priority order", () => {
    const segs = segmentMarks(
      [
        { id: "g", start: 4, end: 6, className: "mark-grammar", label: "g" },
        { id: "c", start: 2, end: 10, className: "mark-match", label: "c" },
      ],
      12,
    );
    expect(segs.map((s) => [s.start, s.end, s.marks.map((m) => m.id).join("")])).toEqual([
      [0, 2, ""],
      [2, 4, "c"],
      [4, 6, "gc"],
      [6, 10, "c"],
      [10, 12, ""],
    ]);
  });
});

describe("DocumentView", () => {
  it("draws the structured Word view with underlines that can be selected", async () => {
    // Without the original bytes the structured view is used (the exact layout needs a real browser).
    const { data: _bytes, ...doc } = await readDocx("paper.docx", await makeDocx(BODY, { image: PNG_1PX }));
    const start = doc.text.indexOf("Soil respiration");
    let picked = "";
    render(
      <DocumentView
        doc={doc}
        text={doc.text}
        marks={[{ id: "m1", start, end: start + 16, className: "mark-match", label: "Copied" }]}
        onSelect={(id) => (picked = id)}
      />,
    );
    expect(screen.getByText("Introduction")).toBeInTheDocument();
    expect(screen.getByText("high").tagName).toBe("STRONG");
    expect(screen.getByRole("img", { name: /Image 1/ })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByTitle(/Hidden in the file/)).toHaveTextContent("secret padding words");
    screen.getByRole("button", { name: /Copied: Soil respiration/ }).click();
    expect(picked).toBe("m1");
  });

  it("falls back to plain text when the document does not match the checked text", () => {
    render(<DocumentView doc={null} text="Plain words here." marks={[]} />);
    expect(screen.getByText("Plain words here.")).toBeInTheDocument();
  });
});

describe("exact Word layout marks", () => {
  it("lines up the checked text with the laid-out page and underlines the right words", async () => {
    const { drawMarks } = await import("@/lib/doc/docx-exact");
    const host = document.createElement("div");
    // Laid-out pages can split words across elements and add list numbers the checked text does not have.
    host.innerHTML = '<section class="docx"><header>Running head</header><p><span>1.</span> Soil resp<span>iration</span> was high in   October.</p><p>Second para.</p></section>';
    document.body.appendChild(host);
    const text = "Soil respiration was high in October.\n\nSecond para.";
    const start = text.indexOf("respiration");
    drawMarks(host, text, [{ id: "m1", start, end: start + "respiration was".length, className: "mark-match", label: "Copied" }]);
    const marks = [...host.querySelectorAll("mark[data-mark=m1]")].map((m) => m.textContent).join("|");
    expect(marks).toBe("resp|iration|was");
    const first = host.querySelector('mark[tabindex="0"]');
    expect(first?.id).toBe("mark-m1");
    expect(first?.getAttribute("role")).toBe("button");
    expect(host.querySelector("header mark")).toBeNull();
    host.remove();
  });
});
