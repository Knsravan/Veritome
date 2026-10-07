import { describe, expect, test } from "vitest";
import { buildPaperReport } from "@/core/report/report";
import { checkPlagiarism } from "@/core/plagiarism/check";
import { reviewReport } from "@/core/plagiarism/review";
import { buildPlagiarismPdf } from "@/lib/pdf/plagiarism-pdf";
import { buildReportPdf } from "@/lib/pdf/report-pdf";
import { pdfSafe } from "@/lib/pdf/writer";
import { SAMPLE_PAPER } from "@/lib/sample";

async function header(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return String.fromCharCode(...bytes.slice(0, 5));
}

describe("PDF reports", () => {
  test("the similarity report is a real PDF", async () => {
    const report = await checkPlagiarism(SAMPLE_PAPER, { library: [{ id: "1", title: "Earlier draft", text: SAMPLE_PAPER.slice(200, 700) }] });
    const blob = await buildPlagiarismPdf({ text: SAMPLE_PAPER, report, reviewed: reviewReport(report), paragraphs: [], filters: { minWords: 0, excluded: [] } });
    expect(await header(blob)).toBe("%PDF-");
    expect(blob.size).toBeGreaterThan(3000);
  });

  test("the full paper report is a real PDF", async () => {
    const report = await buildPaperReport(SAMPLE_PAPER);
    const blob = await buildReportPdf(report, SAMPLE_PAPER);
    expect(await header(blob)).toBe("%PDF-");
  });

  test("characters the PDF fonts cannot show are replaced, typographic quotes are kept", () => {
    expect(pdfSafe("“Hello” — naïve – 你好")).toBe("“Hello” — naïve – ??");
  });
});
