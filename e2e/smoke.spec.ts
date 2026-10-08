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
  test.setTimeout(180_000);
  // The neural models and their runtime are served by the site itself, so this works with outside CDNs blocked.
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
    timeout: 150_000,
  });
  await expect(page.getByText("could not run")).toHaveCount(0);
  await expect(page.getByLabel("AI writing summary")).toContainText("%");
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
  // With the neural models blocked the page says so plainly instead of showing a share.
  await page.route("**/ort/**", (route) => route.abort());
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
  await expect(
    page.getByText("The AI models could not run in this browser"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
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

test("humaniser revises paragraph by paragraph, lets each change be reviewed, and gives a Word file", async ({
  page,
}) => {
  // A pretend language model, so the test needs no API key.
  await page.route("**/api/status", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ json: { ...(await res.json()), llm: true, llmModel: "test-model" } });
  });
  let calls = 0;
  await page.route("**/api/humanise", async (route) => {
    calls++;
    const body = route.request().postDataJSON() as { text: string; tone: string };
    expect(body.tone).toBe("natural");
    const text = body.text.replace("It is important to note that the method plays a crucial role in", "The method is central to");
    await route.fulfill({
      json: { original: body.text, text, status: "rewritten", attempts: 1, problems: [], meaningChecked: true, changed: 0.2 },
    });
  });
  await page.goto("/humaniser");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Make stiff writing read like you wrote it");
  const para = "It is important to note that the method plays a crucial role in the analysis of river sediments (Smith et al., 2020), and accuracy reached 94.2% on the held-out samples.";
  await page.getByRole("textbox", { name: "Paste your text" }).fill(`Introduction\n\n${para}\n\n${para}`);
  await page.getByRole("radio", { name: "Natural" }).click();
  await page.getByRole("button", { name: /Humanise/ }).click();
  await expect(page.getByText("2 of 2 paragraphs revised")).toBeVisible();
  expect(calls).toBe(2);
  await expect(page.getByText("Meaning checked").first()).toBeVisible();
  await page.getByRole("radio", { name: "Keep original" }).first().click();
  await page.route("**/api/make-yours", async (route) => {
    const body = route.request().postDataJSON() as { action: string; answers?: Array<{ answer: string }> };
    await route.fulfill({
      json:
        body.action === "ask"
          ? { questions: [{ quote: "the held-out samples", question: "Which samples did you hold out?", why: "names your data" }] }
          : { status: "rewritten", problems: [], text: `The method is central to the analysis of river sediments; on ${body.answers![0]!.answer}, accuracy reached 94.2%.` },
    });
  });
  await page.getByRole("button", { name: "Make it yours" }).nth(1).click();
  await page.getByLabel("Which samples did you hold out?").fill("the 120 cores from the 2019 survey");
  await page.getByRole("button", { name: "Write my answers in" }).click();
  await expect(page.getByText("the 120 cores from the 2019 survey, accuracy").or(page.getByText(/120 cores from the 2019 survey/))).toBeVisible();
  await expect(page.getByText("Your edit")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Disclose the help you used" })).toBeVisible();
  await axe(page);
  const word = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Word file" }).click();
  expect((await word).suggestedFilename()).toBe("text-humanised.docx");
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
  await page.route("**/ort/**", (route) => route.abort());
  await page.goto("/detector");
  await page.getByRole("textbox", { name: "Your text" }).fill(PASTED);
  await page.getByRole("button", { name: "Check for AI writing" }).click();
  await expect(page.getByText("AI detector report")).toBeVisible({
    timeout: 60_000,
  });
  await axe(page);
});
