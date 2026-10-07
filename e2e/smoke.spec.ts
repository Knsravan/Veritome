import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
}

test("home page shows all tools and passes axe @mobile", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check your paper before reviewers do.");
  await expect(page.locator("#tools li")).toHaveCount(6);
  await axe(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("every tool page loads and passes axe", async ({ page }) => {
  for (const path of ["/report", "/plagiarism", "/detector", "/humaniser", "/paraphraser", "/citations", "/grammar", "/settings", "/about"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await axe(page);
  }
});

test("AI-pattern check on the sample shows a range, signals and flagged sentences", async ({ page }) => {
  await page.goto("/detector");
  await page.getByRole("button", { name: "Try a sample" }).click();
  await page.getByRole("button", { name: "Check writing patterns" }).click();
  await expect(page.getByRole("img", { name: /plausible range/ })).toBeVisible();
  await expect(page.getByText("Style measurements")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Flagged sentences/ })).toBeVisible();
  await expect(page.getByText("What this can’t tell you")).toBeVisible();
  await axe(page);
});

test("grammar fixes can be applied in place", async ({ page }) => {
  await page.goto("/grammar");
  await page.getByRole("button", { name: "Try a sample" }).click();
  await page.getByRole("button", { name: "Check grammar" }).click();
  const fix = page.getByRole("button", { name: /^Replace “The the”/ }).first();
  await expect(fix).toBeVisible();
  await fix.click();
  await expect(page.getByRole("textbox", { name: "Your text" })).not.toHaveValue(/The the litter-bag/);
  await axe(page);
});

test("humaniser without a model makes rule-based edits and shows the disclosure", async ({ page }) => {
  await page.goto("/humaniser");
  await page.getByRole("button", { name: "Try a sample" }).click();
  await page.getByRole("button", { name: "Revise the text" }).click();
  await expect(page.getByText(/rule-based edits only/)).toBeVisible();
  await expect(page.getByText("About disclosure")).toBeVisible();
  await page.getByRole("button", { name: "Clean text" }).click();
  await expect(page.getByLabel("Rewritten text")).not.toContainText("delve into");
  await expect(page.getByLabel("Rewritten text")).toContainText("(Smith & Lee, 2020)");
});

test("external checks ask for consent first, and cancelling sends nothing", async ({ page }) => {
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/plagiarism")) calls++;
  });
  await page.goto("/plagiarism");
  await page.getByRole("button", { name: "Try a sample" }).click();
  await page.getByRole("button", { name: "Check for overlap" }).click();
  const dialog = page.getByRole("dialog", { name: "Send parts of your text to search services?" });
  await expect(dialog).toBeVisible();
  await axe(page);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(calls).toBe(0);
});

test("offline plagiarism check against the user's own text runs without consent", async ({ page }) => {
  await page.goto("/plagiarism");
  await page.getByRole("button", { name: "Try a sample" }).click();
  await page.getByLabel("Scholarly databases").uncheck();
  await page.getByRole("button", { name: "Check for overlap" }).click();
  await expect(page.getByText(/words appear word for word in at least one source/)).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("full report runs offline, shows tabs and offers downloads @mobile", async ({ page }) => {
  await page.goto("/report");
  await page.getByRole("button", { name: "Try a sample" }).click();
  await page.getByText("More options").click();
  await page.getByLabel("Search scholarly databases").uncheck();
  await page.getByRole("button", { name: "Check paper" }).click();
  await expect(page.getByRole("heading", { name: "Report", exact: true })).toBeAttached({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "What to fix first" })).toBeVisible();
  for (const [tab, text] of [
    ["Similarity", /words appear word for word/],
    ["AI patterns", /patterns typical of model output|Inconclusive/],
    ["Citations", /Sentences that may need a citation/],
    ["Grammar", /Readability/],
    ["Rewrites", /Revision suggestions/],
  ] as const) {
    await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
    await expect(page.getByRole("tabpanel").getByText(text).first()).toBeVisible();
  }
  await page.getByText("More formats").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Markdown" }).click();
  expect((await download).suggestedFilename()).toBe("veritome-report.md");
  await axe(page);
  await page.getByRole("button", { name: "New check" }).click();
  await expect(page.getByRole("heading", { name: "Check a paper" })).toBeVisible();
});

test("report shows live progress while checking", async ({ page }) => {
  await page.route("**/api/report", async (route) => {
    const lines = [
      { type: "progress", tool: "plagiarism", state: "start" },
      { type: "step", tool: "plagiarism", done: 3, total: 10 },
    ];
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n" });
  });
  await page.goto("/report");
  await page.getByRole("button", { name: "Try a sample" }).click();
  await page.getByText("More options").click();
  await page.getByLabel("Search scholarly databases").uncheck();
  await page.getByRole("button", { name: "Check paper" }).click();
  // The fake stream ends without a result, so the page reports that clearly instead of hanging.
  await expect(page.getByText("The check did not finish")).toBeVisible();
});

test("dark theme keeps contrast on results", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await axe(page);
  await page.goto("/detector");
  await page.getByRole("button", { name: "Try a sample" }).click();
  await page.getByRole("button", { name: "Check writing patterns" }).click();
  await expect(page.getByText("Style measurements")).toBeVisible();
  await axe(page);
});
