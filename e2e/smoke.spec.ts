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
  await expect(page.getByText(/words match a source word for word/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /What to fix/ })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
  await axe(page);
});

test("plagiarism results explain each finding and update when filtered", async ({ page }) => {
  const report = {
    similarity: 30, verdict: "high", words: 100, matchedWords: 30,
    spans: [
      { start: 0, end: 60, words: 20, text: "SPAN_A", sourceIds: ["a", "b"], cited: false, sourceExcerpt: { text: "…before SOURCE WORDS after…", matchStart: 8, matchEnd: 20 } },
      { start: 70, end: 100, words: 10, text: "SPAN_B", sourceIds: ["b"], cited: true, citation: "Lee, 2020" },
    ],
    paraphrases: [], paraphrasePercent: 0,
    sources: [
      { id: "a", title: "Original paper", kind: "scholarly", provider: "OpenAlex", matchedWords: 20, percent: 20, primaryWords: 20, primaryPercent: 20, year: 2015 },
      { id: "b", title: "Quoting paper", kind: "scholarly", provider: "Europe PMC", matchedWords: 30, percent: 30, primaryWords: 10, primaryPercent: 10 },
    ],
    quotes: [], searched: [{ start: 0, end: 60 }], providers: [], excluded: { references: true, quotes: true, referenceWords: 0 }, warnings: [], disclaimer: "d",
  };
  await page.route("**/api/plagiarism", (route) =>
    route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "step", done: 1, total: 1 })}\n${JSON.stringify({ type: "result", report })}\n` }),
  );
  await page.goto("/plagiarism");
  await page.getByLabel("Your text").fill("x".repeat(60) + " " + "y".repeat(39));
  await page.getByLabel("Scholarly databases").uncheck();
  await page.getByRole("button", { name: "Check for overlap" }).click();
  await expect(page.getByText("30%", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Copied without a citation").first()).toBeVisible();
  await page.getByRole("button", { name: /“SPAN_A”/ }).click();
  await expect(page.getByLabel("Selected finding")).toContainText("SOURCE WORDS");
  await page.getByLabel("Selected finding").getByRole("button", { name: "Exclude this source" }).click();
  // The passage is now credited to the quoting paper and the score stays 30%.
  await expect(page.getByText("Excluded:")).toBeVisible();
  await page.getByLabel("Hide matches under").selectOption("12");
  await expect(page.getByText("1 small match hidden")).toBeVisible();
  await axe(page);
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
    ["Similarity", /words match a source word for word/],
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
