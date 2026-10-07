import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { jsPDF } from "jspdf";
import JSZip from "jszip";

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
}

const PARA =
  "We trained a profound learning model on soil respiration data from twelve riparian sites over two summers. The the alder stands kept respiring at almost the summer rate well into October, which we still cannot fully explain.";

async function docx(): Promise<Buffer> {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file("word/styles.xml", `<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`);
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document ${W}><w:body>` +
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Late-season respiration</w:t></w:r></w:p>' +
      `<w:p><w:r><w:t xml:space="preserve">${PARA} </w:t></w:r><w:r><w:rPr><w:color w:val="FFFFFF"/></w:rPr><w:t>invisible padding</w:t></w:r></w:p>` +
      "</w:body></w:document>",
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

function pdf(): Buffer {
  const d = new jsPDF({ unit: "pt", format: "a4" });
  d.setFontSize(16);
  d.text("Late-season respiration", 56, 72);
  d.setFontSize(11);
  d.text(d.splitTextToSize(PARA, 480) as string[], 56, 110);
  return Buffer.from(d.output("arraybuffer"));
}

async function upload(page: Page, name: string, buffer: Buffer, mimeType: string) {
  await page.goto("/plagiarism");
  await page.getByLabel("Upload a file").setInputFiles({ name, mimeType, buffer });
  await expect(page.getByRole("textbox", { name: "Your text" })).toHaveValue(/profound learning/);
  await page.getByLabel("Scholarly databases").uncheck();
  await page.getByRole("button", { name: "Check my paper" }).click();
  await expect(page.getByLabel("Your paper with every finding underlined")).toBeVisible({ timeout: 30_000 });
}

test("a Word file is shown in its original layout with every finding underlined", async ({ page }) => {
  await upload(page, "paper.docx", await docx(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const sheet = page.getByLabel("Your paper with every finding underlined");
  await expect(page.getByRole("radio", { name: "Original layout" })).toHaveAttribute("aria-checked", "true");
  await expect(sheet.getByText("Late-season respiration")).toHaveClass(/font-display/);
  await expect(sheet.getByTitle(/Hidden in the file/)).toHaveText("invisible padding");
  await sheet.getByRole("button", { name: /Phrase typical of a paraphrasing tool/ }).click();
  await expect(page.getByLabel("Selected finding")).toContainText("Most likely replaces “deep learning”");
  await expect(page.getByRole("tabpanel").getByText("Hidden copying").first()).toBeVisible();
  await axe(page);
  await page.getByRole("radio", { name: "Plain text" }).click();
  await expect(sheet.getByText("Late-season respiration")).not.toHaveClass(/font-display/);
});

test("a PDF is shown as its original pages with findings drawn over them", async ({ page }) => {
  await upload(page, "paper.pdf", pdf(), "application/pdf");
  await expect(page.getByRole("radio", { name: "Original pages" })).toHaveAttribute("aria-checked", "true");
  const pageOne = page.getByRole("group", { name: "Page 1" });
  await expect(pageOne.locator("canvas")).toHaveClass(/opacity-100/, { timeout: 20_000 });
  await pageOne.getByRole("button", { name: /Phrase typical of a paraphrasing tool/ }).click();
  await expect(page.getByLabel("Selected finding")).toContainText("deep learning");
  await axe(page);
});
