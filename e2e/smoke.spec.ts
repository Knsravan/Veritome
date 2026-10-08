import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map(
      (v) =>
        `${v.id}: ${v.nodes
          .map((n) => n.target.join(" "))
          .slice(0, 3)
          .join(", ")}`,
    ),
  ).toEqual([]);
}

test("home page shows all tools and passes axe @mobile", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Check your paper before reviewers do.",
  );
  await expect(page.locator("#tools li")).toHaveCount(7);
  await axe(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("every tool page loads and passes axe", async ({ page }) => {
  for (const path of [
    "/plagiarism",
    "/compare",
    "/detector",
    "/humaniser",
    "/paraphraser",
    "/citations",
    "/grammar",
    "/settings",
    "/about",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await axe(page);
  }
});

test("the old full-report address opens the plagiarism check", async ({
  page,
}) => {
  await page.goto("/report?sample=1");
  await expect(page).toHaveURL(/\/plagiarism\?sample=1$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Plagiarism check",
  );
  await expect(page.getByText("Sample paper.docx")).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(1); // only the optional author field, no paste box
});

test("theme switch flips between light and dark and is remembered", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Switch to light mode" }),
  ).toBeVisible();
  await axe(page);
  await page.goto("/settings");
  await page.getByRole("radio", { name: "Match my device" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
});

const PASTED = Array.from(
  { length: 4 },
  () =>
    "In today's rapidly evolving landscape, it is important to note that technology plays a pivotal role in shaping our lives. Furthermore, this comprehensive overview delves into the multifaceted aspects of innovation, highlighting key insights and fostering a deeper understanding of its transformative potential.",
).join("\n\n");

test("AI detector text mode shows the report, the underlined text and the detailed signals", async ({
  page,
}) => {
  // The neural second opinion loads from a CDN; without it the check still finishes with the browser-side rules.
  await page.route("**/cdn.jsdelivr.net/**", (route) => route.abort());
  await page.goto("/detector");
  await expect(page.getByRole("tab", { name: /Text mode/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("textbox", { name: "Your text" }).fill(PASTED);
  await expect(page.getByText(/words$/).first()).toBeVisible();
  await page.getByRole("button", { name: "Check for AI writing" }).click();
  await expect(page.getByText("AI detector report")).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page.getByLabel("Your paper with the AI-written parts underlined"),
  ).toBeVisible();
  await page.getByText(/^Detailed signals/).click();
  await expect(page.getByRole("heading", { name: "Style measurements" })).toBeVisible();
  await axe(page);
});

test("AI detector file mode previews the paper and offers both downloads", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.route("**/cdn.jsdelivr.net/**", (route) => route.abort());
  await page.goto("/detector?mode=file");
  await expect(page.getByRole("tab", { name: /File mode/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "Try a sample paper" }).click();
  await expect(page.getByText("Sample paper.docx")).toBeVisible();
  await page.getByRole("button", { name: "Check for AI writing" }).click();
  await expect(page.getByText("AI detector report")).toBeVisible({
    timeout: 60_000,
  });
  const sheet = page.getByLabel(
    "Your paper with the AI-written parts underlined",
  );
  await expect(sheet.locator("section.docx").first()).toBeVisible({
    timeout: 30_000,
  });
  const marked = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download marked Word file" }).click();
  expect((await marked).suggestedFilename()).toBe(
    "Sample paper-ai-marked.docx",
  );
  const pdf = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF report" }).click();
  expect((await pdf).suggestedFilename()).toBe(
    "Sample paper-veritome-ai-report.pdf",
  );
});

test("tools that are not ready yet say they are coming soon", async ({
  page,
}) => {
  for (const path of [
    "/compare",
    "/humaniser",
    "/paraphraser",
    "/citations",
    "/grammar",
  ]) {
    await page.goto(path);
    await expect(page.getByText("Coming soon").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Plagiarism/ }).first(),
    ).toBeVisible();
  }
});

test("external checks ask for consent first, and cancelling sends nothing", async ({
  page,
}) => {
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/report") || r.url().includes("/api/plagiarism"))
      calls++;
  });
  await page.goto("/plagiarism");
  await page.getByRole("button", { name: "Try a sample paper" }).click();
  await expect(page.getByText("Ready to check", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check my paper" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Send parts of your text to search services?",
  });
  await expect(dialog).toBeVisible();
  await axe(page);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(calls).toBe(0);
});

test("offline plagiarism check against the user's own text runs without consent", async ({
  page,
}) => {
  await page.goto("/plagiarism");
  await page.getByRole("button", { name: "Try a sample paper" }).click();
  await expect(page.getByText("Ready to check", { exact: true })).toBeVisible();
  await page.getByLabel("Scholarly databases").uncheck();
  await page.getByRole("button", { name: "Check my paper" }).click();
  await expect(
    page.getByLabel("Your paper with every finding underlined"),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: /^What to fix/ }).click();
  await expect(
    page.getByRole("heading", { name: "What to fix first" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /^Similarity/ }).click();
  await expect(
    page.getByText(/words match a source word for word/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /What to fix/ }),
  ).toBeVisible();
  await expect(page.getByLabel("AI writing summary")).toContainText(
    "How far to trust this",
  );
  await page.getByRole("radio", { name: /AI writing/ }).click();
  await expect(
    page.getByRole("tabpanel").getByText("Wavy underline"),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
  await axe(page);
});

test("disguised letters and paraphrasing-tool phrases are flagged", async ({
  page,
}) => {
  await page.goto("/plagiarism");
  await page.getByLabel("Upload your paper").setInputFiles({
    name: "draft.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "We trained a profound learning model on soil data from twelve sites. The rеsults shоw that respiration stayed high into October across every site we measured.",
    ),
  });
  await expect(page.getByText("Ready to check", { exact: true })).toBeVisible();
  await page.getByLabel("Scholarly databases").uncheck();
  await page.getByRole("button", { name: "Check my paper" }).click();
  await expect(
    page.getByLabel("Your paper with every finding underlined"),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: /^What to fix/ }).click();
  await expect(
    page.getByRole("heading", { name: "What to fix first" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Phrase typical of a paraphrasing tool: “profound learning”/,
    ),
  ).toBeVisible();
  await page.getByRole("tab", { name: /^Similarity/ }).click();
  const flags = page.getByLabel("Integrity flags");
  await expect(flags).toContainText("Signs that copying was hidden");
  await expect(flags).toContainText("1 disguised passage");
  await axe(page);
});

test("plagiarism results explain each finding and update when filtered", async ({
  page,
}) => {
  const report = {
    similarity: 30,
    verdict: "high",
    words: 100,
    matchedWords: 30,
    spans: [
      {
        start: 0,
        end: 60,
        words: 20,
        text: "SPAN_A",
        sourceIds: ["a", "b"],
        cited: false,
        sourceExcerpt: {
          text: "…before SOURCE WORDS after…",
          matchStart: 8,
          matchEnd: 20,
        },
      },
      {
        start: 70,
        end: 100,
        words: 10,
        text: "SPAN_B",
        sourceIds: ["b"],
        cited: true,
        citation: "Lee, 2020",
      },
    ],
    paraphrases: [],
    paraphrasePercent: 0,
    sources: [
      {
        id: "a",
        title: "Original paper",
        kind: "scholarly",
        provider: "OpenAlex",
        matchedWords: 20,
        percent: 20,
        primaryWords: 20,
        primaryPercent: 20,
        year: 2015,
      },
      {
        id: "b",
        title: "Quoting paper",
        kind: "scholarly",
        provider: "Europe PMC",
        matchedWords: 30,
        percent: 30,
        primaryWords: 10,
        primaryPercent: 10,
      },
    ],
    quotes: [],
    searched: [{ start: 0, end: 60 }],
    providers: [],
    excluded: { references: true, quotes: true, referenceWords: 0 },
    warnings: [],
    disclaimer: "d",
  };
  const skipped = { status: "skipped", reason: "Not selected." };
  const paper = {
    generatedAt: new Date().toISOString(),
    words: 100,
    hasReferenceList: false,
    overview: [
      {
        tool: "plagiarism",
        status: "attention",
        headline: "30% of words match 2 sources.",
      },
    ],
    plagiarism: { status: "done", result: report },
    detector: skipped,
    citations: skipped,
    grammar: skipped,
    paraphrase: skipped,
    humanise: skipped,
    disclaimer: "d",
  };
  await page.route("**/api/report", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: `${JSON.stringify({ type: "step", tool: "plagiarism", done: 1, total: 1 })}\n${JSON.stringify({ type: "result", report: paper })}\n`,
    }),
  );
  await page.goto("/plagiarism");
  await page
    .getByLabel("Upload your paper")
    .setInputFiles({
      name: "paper.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "A short paper with a dozen words in it for this mocked check.",
      ),
    });
  await expect(page.getByText("Ready to check", { exact: true })).toBeVisible();
  await page.getByLabel("Scholarly databases").uncheck();
  await page.getByRole("button", { name: "Check my paper" }).click();
  await page.getByRole("tab", { name: /^Similarity/ }).click();
  await expect(page.getByLabel("Similarity summary")).toContainText("30");
  await expect(
    page.getByRole("tabpanel").getByText("Copied without a citation").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: /“SPAN_A”/ }).click();
  await expect(page.getByLabel("Selected finding")).toContainText(
    "SOURCE WORDS",
  );
  await page
    .getByLabel("Selected finding")
    .getByRole("button", { name: "Exclude this source" })
    .click();
  // The passage is now credited to the quoting paper and the score stays 30%.
  await expect(page.getByText("Excluded:")).toBeVisible();
  await page.getByLabel("Hide matches under").selectOption("12");
  await expect(page.getByText("1 small match hidden")).toBeVisible();
  await axe(page);
  const pdf = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF report" }).click();
  expect((await pdf).suggestedFilename()).toMatch(/veritome-report.*\.pdf$/);
});

test("full report runs offline, shows tabs and offers downloads @mobile", async ({
  page,
}) => {
  await page.goto("/plagiarism");
  await page.getByRole("button", { name: "Try a sample paper" }).click();
  await expect(page.getByText("Ready to check", { exact: true })).toBeVisible();
  await page.getByLabel("Scholarly databases").uncheck();
  await page.getByRole("button", { name: "Check my paper" }).click();
  await expect(
    page.getByRole("heading", { name: "Report", exact: true }),
  ).toBeAttached({ timeout: 30_000 });
  await expect(
    page.getByLabel("Your paper with every finding underlined"),
  ).toBeVisible();
  await expect(
    page.getByRole("tabpanel").getByText(/findings? in your paper/),
  ).toBeVisible();
  await page
    .getByRole("tabpanel")
    .getByRole("button", { name: "Next" })
    .click();
  await expect(page.getByLabel("Selected finding")).toBeVisible();
  await page.getByRole("tab", { name: /^What to fix/ }).click();
  await expect(
    page.getByRole("heading", { name: "What to fix first" }),
  ).toBeVisible();
  for (const [tab, text] of [
    ["Similarity", /words match a source word for word/],
    ["AI writing", /patterns typical of model output|Inconclusive/],
    ["Citations", /Sentences that may need a citation/],
    ["Grammar", /Readability/],
    ["Rewrites", /Revision suggestions/],
  ] as const) {
    await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
    await expect(
      page.getByRole("tabpanel").getByText(text).first(),
    ).toBeVisible();
  }
  const pdf = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF report" }).click();
  const saved = await pdf;
  expect(saved.suggestedFilename()).toMatch(/veritome-report.*\.pdf$/);
  // Fonts that cover Greek and maths symbols are embedded.
  expect(
    (await import("node:fs"))
      .readFileSync((await saved.path())!)
      .toString("latin1"),
  ).toContain("DejaVuSans");
  await page.getByText("More formats").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Markdown" }).click();
  expect((await download).suggestedFilename()).toBe("veritome-report.md");
  await axe(page);
  await page.getByRole("button", { name: "New check" }).click();
  await expect(
    page.getByRole("heading", { name: "Plagiarism check" }),
  ).toBeVisible();
});

test("report shows live progress while checking", async ({ page }) => {
  await page.route("**/api/report", async (route) => {
    const lines = [
      { type: "progress", tool: "plagiarism", state: "start" },
      { type: "step", tool: "plagiarism", done: 3, total: 10 },
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    });
  });
  await page.goto("/plagiarism");
  await page.getByRole("button", { name: "Try a sample paper" }).click();
  await expect(page.getByText("Ready to check", { exact: true })).toBeVisible();
  await page.getByLabel("Scholarly databases").uncheck();
  await page.getByRole("button", { name: "Check my paper" }).click();
  // The fake stream ends without a result, so the page reports that clearly instead of hanging.
  await expect(page.getByText("The check did not finish")).toBeVisible();
});

test("dark theme keeps contrast on results", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await axe(page);
  await page.route("**/cdn.jsdelivr.net/**", (route) => route.abort());
  await page.goto("/detector");
  await page.getByRole("textbox", { name: "Your text" }).fill(PASTED);
  await page.getByRole("button", { name: "Check for AI writing" }).click();
  await expect(page.getByText("AI detector report")).toBeVisible({
    timeout: 60_000,
  });
  await axe(page);
});
