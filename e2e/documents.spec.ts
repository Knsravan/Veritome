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
  await page.getByLabel("Upload your paper").setInputFiles({ name, mimeType, buffer });
  await expect(page.getByText("Ready to check", { exact: true })).toBeVisible();
  await expect(page.getByText(name)).toBeVisible();
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

/** PNGs drawn in the browser: a picture, the same picture flipped, and a different picture. */
async function pictures(page: Page): Promise<Buffer[]> {
  const urls = await page.evaluate(() => {
    const draw = (flip: boolean, other: boolean) => {
      const c = document.createElement("canvas");
      c.width = 240;
      c.height = 160;
      const g = c.getContext("2d")!;
      if (flip) {
        g.translate(240, 0);
        g.scale(-1, 1);
      }
      g.fillStyle = "#fff";
      g.fillRect(0, 0, 240, 160);
      g.fillStyle = other ? "#1d4ed8" : "#b91c1c";
      if (other) {
        g.beginPath();
        g.arc(120, 80, 60, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillRect(10, 10, 80, 140);
        g.fillStyle = "#16a34a";
        g.fillRect(100, 60, 60, 30);
        g.fillStyle = "#111";
        g.fillRect(170, 100, 60, 50);
      }
      return c.toDataURL("image/png");
    };
    return [draw(false, false), draw(false, false), draw(true, false), draw(false, true)];
  });
  return urls.map((u) => Buffer.from(u.split(",")[1]!, "base64"));
}

async function docxWithPictures(images: Buffer[]): Promise<Buffer> {
  const W =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>');
  const rels = images.map((_, i) => `<Relationship Id="rImg${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i}.png"/>`).join("");
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
  images.forEach((b, i) => zip.file(`word/media/image${i}.png`, b));
  const pics = images.map((_, i) => `<w:p><w:r><w:drawing><a:graphic><a:graphicData><a:blip r:embed="rImg${i}"/></a:graphicData></a:graphic></w:drawing></w:r></w:p>`).join("");
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:r><w:t xml:space="preserve">${PARA}</w:t></w:r></w:p>${pics}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

test("pictures used twice, including a flipped copy, are found", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/plagiarism");
  const file = await docxWithPictures(await pictures(page));
  await upload(page, "figures.docx", file, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  // The figures carry a note in the paper itself.
  await expect(page.getByLabel("Your paper with every finding underlined").getByText("The same picture appears elsewhere in the paper").first()).toBeVisible();
  await page.getByRole("tab", { name: /^Images/ }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("heading", { name: /problems? in 4 pictures/ })).toBeVisible();
  await expect(panel.getByText("The same picture is used twice")).toHaveCount(3);
  await expect(panel.getByText(/One copy is flipped/).first()).toBeVisible();
  await axe(page);
});

test("compare papers finds the pair that shares text, and shows where", async ({ page }) => {
  await page.goto("/compare");
  const shared = "Waterlogged sediments kept microbial activity unusually elevated across the floodplain well into October, long after upland plots had cooled.";
  await page.getByLabel("Add papers").setInputFiles([
    { name: "Ana.txt", mimeType: "text/plain", buffer: Buffer.from(`Ana studied riparian alder stands over two summers. ${shared} She ends with her own idea about nitrogen.`) },
    { name: "Ben.txt", mimeType: "text/plain", buffer: Buffer.from(`Ben looked at the same river. ${shared} He then measured something else entirely in winter.`) },
    { name: "Cat.txt", mimeType: "text/plain", buffer: Buffer.from("Cat wrote about coastal dunes and the movement of sand over three stormy winters in great detail.") },
  ]);
  await expect(page.getByRole("button", { name: /Remove/ })).toHaveCount(3);
  await page.getByRole("button", { name: "Compare 3 papers" }).click();
  await expect(page.getByRole("heading", { name: /1 pair shares 10% or more/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ana and Ben: \d+% shared/ })).toBeVisible();
  const pair = page.getByLabel("Pair comparison");
  await expect(pair).toContainText("Ana and Ben: 1 shared passage");
  await pair.getByRole("button", { name: /Shared passage 1/ }).first().click();
  await axe(page);
});

test("a real Word file is shown in its exact layout and the PDF report carries its pages", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/plagiarism");
  await page.getByRole("button", { name: "Try a sample paper" }).click();
  await expect(page.getByText("Sample paper.docx")).toBeVisible();
  await page.getByLabel("Scholarly databases").uncheck();
  await page.getByRole("button", { name: "Check my paper" }).click();
  const sheet = page.getByLabel("Your paper with every finding underlined");
  await expect(sheet.locator("section.docx").first()).toBeVisible({ timeout: 30_000 });
  await expect(sheet.locator("mark[role=button]").first()).toBeVisible();
  await page.getByRole("tabpanel").getByRole("button", { name: "Next" }).click();
  await expect(page.getByLabel("Selected finding")).toBeVisible();
  const pdf = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF report" }).click();
  const saved = await pdf;
  const bytes = (await import("node:fs")).readFileSync((await saved.path())!);
  // The paper's page is in the report as a picture.
  expect(bytes.toString("latin1")).toMatch(/\/Subtype \/Image/);
});

test("OpenDocument and RTF papers are read and checked", async ({ page }) => {
  const zip = new JSZip();
  zip.file("mimetype", "application/vnd.oasis.opendocument.text");
  zip.file(
    "content.xml",
    '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>' +
      '<text:h text:outline-level="1">Late-season respiration</text:h>' +
      `<text:p>${PARA}</text:p></office:text></office:body></office:document-content>`,
  );
  await page.goto("/plagiarism");
  await page.getByLabel("Upload your paper").setInputFiles({ name: "paper.odt", mimeType: "application/vnd.oasis.opendocument.text", buffer: await zip.generateAsync({ type: "nodebuffer" }) });
  await expect(page.getByText("Ready to check", { exact: true })).toBeVisible();
  await page.getByLabel("Scholarly databases").uncheck();
  await page.getByRole("button", { name: "Check my paper" }).click();
  const sheet = page.getByLabel("Your paper with every finding underlined");
  await expect(sheet.getByText("Late-season respiration")).toHaveClass(/font-display/);
  await expect(sheet.getByRole("button", { name: /Phrase typical of a paraphrasing tool/ })).toBeVisible();

  await page.goto("/plagiarism");
  const rtf = String.raw`{\rtf1\ansi{\fonttbl{\f0 Times;}}\f0 ` + PARA.replace(/\./g, ".\\par ") + "}";
  await page.getByLabel("Upload your paper").setInputFiles({ name: "paper.rtf", mimeType: "application/rtf", buffer: Buffer.from(rtf) });
  await expect(page.getByText("Ready to check", { exact: true })).toBeVisible();
  await expect(page.getByText("RTF", { exact: true }).first()).toBeVisible();
});
