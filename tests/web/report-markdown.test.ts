// @vitest-environment node
import { expect, test } from "vitest";
import { buildPaperReport } from "@/core/report/report";
import { SAMPLE_PAPER } from "@/lib/sample";
import { reportToMarkdown } from "@/lib/report-markdown";

test("report Markdown includes every section and the disclaimers", async () => {
  const report = await buildPaperReport(SAMPLE_PAPER, {}, { tools: { paraphrase: false } });
  const md = reportToMarkdown(report);
  for (const h of ["## Overview", "## Plagiarism", "## AI writing patterns", "## Citations", "## Grammar and style", "## Paraphrase suggestions", "## Revision suggestions"]) {
    expect(md).toContain(h);
  }
  expect(md).toContain("Skipped: Not selected.");
  expect(md).toContain(report.disclaimer);
  expect(md).toMatch(/Pattern score \d+, plausible range/);
});
