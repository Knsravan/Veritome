import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { PlagiarismResultView } from "@/components/PlagiarismResultView";
import { checkPlagiarism } from "@/core/plagiarism/check";
import { ISSUE_TEXT } from "@/core/plagiarism/review";
import { stubLayoutApis } from "./dom-stubs";

beforeAll(stubLayoutApis);
afterEach(cleanup);

const COPIED = "The alder stands near the river kept respiring at almost the summer rate well into October, long after the upland plots had slowed.";
const OTHER = "Seasonal carbon budgets for temperate floodplain forests remain poorly constrained because most flux towers sit on upland sites far from water.";
const TEXT = `Soil respiration in riparian forests

We measured soil carbon dioxide efflux across twelve plots over two growing seasons. ${COPIED}

Our second finding concerns budgets. ${OTHER} We therefore add three new floodplain sites to the regional network and report their first year of data here.`;

const LIBRARY = [
  { id: "a", title: "Old draft on alder respiration", text: `Intro words here. ${COPIED} More unrelated words follow in this draft.` },
  { id: "b", title: "Floodplain flux review", text: `A review. ${OTHER} The end of the review.` },
];

/** A real report from the engine, checked offline against two library documents. */
async function setup(text = TEXT, library = LIBRARY, props: { showDownload?: boolean } = {}) {
  const report = await checkPlagiarism(text, { library });
  render(<PlagiarismResultView text={text} report={report} {...props} />);
  return report;
}

const summary = () => screen.getByRole("region", { name: "Similarity summary" });
/** A finding's row in the "What to fix" list (its passage in the text is a button too). */
const row = (start: RegExp) => within(screen.getByRole("heading", { name: /^What to fix/ }).closest("section")!).getByRole("button", { name: start });

describe("PlagiarismResultView", () => {
  test("shows the score, the verdict and each finding grouped under what to fix", async () => {
    await setup();
    expect(summary()).toHaveTextContent("51.2%");
    expect(summary()).toHaveTextContent("High similarity");
    expect(summary()).toHaveTextContent("2 passages need fixing before you submit.");
    expect(screen.getByRole("heading", { name: "What to fix (2)" })).toBeInTheDocument();
    expect(screen.getByText(ISSUE_TEXT.copied_uncited.title, { selector: "summary span" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sources (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download PDF report/ })).toBeInTheDocument();
  });

  test("selecting a finding opens its detail with the source, and closing hides it", async () => {
    await setup();
    expect(screen.queryByRole("region", { name: "Selected finding" })).toBeNull();
    fireEvent.click(row(/The alder stands near the river/));
    const detail = screen.getByRole("region", { name: "Selected finding" });
    expect(detail).toHaveTextContent(ISSUE_TEXT.copied_uncited.title);
    expect(detail).toHaveTextContent("How to fix:");
    expect(detail).toHaveTextContent("From Old draft on alder respiration");
    expect(within(detail).getByText("Your text")).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("button", { name: "Close finding" }));
    expect(screen.queryByRole("region", { name: "Selected finding" })).toBeNull();
  });

  test("selecting a passage in the text opens the same finding", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /^Copied without a citation, source 2: Seasonal carbon/ }));
    expect(screen.getByRole("region", { name: "Selected finding" })).toHaveTextContent("From Floodplain flux review");
    expect(row(/Seasonal carbon budgets/)).toHaveAttribute("aria-current", "true");
  });

  test("excluding a source drops its matches from the score, and including it again restores them", async () => {
    await setup();
    fireEvent.click(row(/The alder stands near the river/));
    fireEvent.click(screen.getByRole("button", { name: "Exclude this source" }));
    expect(screen.queryByRole("region", { name: "Selected finding" })).toBeNull();
    expect(summary()).toHaveTextContent("24.4%");
    expect(screen.getByRole("heading", { name: "What to fix (1)" })).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: /^What to fix/ }).closest("section")!).queryByRole("button", { name: /The alder stands/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Include Old draft on alder respiration again" }));
    expect(summary()).toHaveTextContent("51.2%");
    expect(screen.getByRole("heading", { name: "What to fix (2)" })).toBeInTheDocument();
  });

  test("a source's Show in text button selects its finding", async () => {
    await setup();
    const sources = screen.getByRole("heading", { name: "Sources (2)" }).closest("section")!;
    const second = within(sources).getAllByRole("listitem")[1]!;
    expect(second).toHaveTextContent("Floodplain flux review");
    fireEvent.click(within(second).getByRole("button", { name: "Show in text" }));
    expect(screen.getByRole("region", { name: "Selected finding" })).toHaveTextContent("From Floodplain flux review");
  });

  test("the paragraph strip jumps to a paragraph's finding and can be read as a table", async () => {
    await setup();
    const strip = screen.getByRole("list", { name: "Text matching a source" });
    const columns = within(strip).getAllByRole("button");
    // The title is not a paragraph of prose, so the two body paragraphs get a column each.
    expect(columns).toHaveLength(2);
    expect(columns[1]).toHaveAccessibleName("Paragraph 2: 46.7%, 45 words");
    fireEvent.click(columns[1]!);
    await waitFor(() => expect(row(/Seasonal carbon budgets/)).toHaveAttribute("aria-current", "true"));

    const chart = strip.closest("figure")!;
    fireEvent.click(within(chart).getByRole("button", { name: "Show as table" }));
    expect(within(chart).getByRole("table")).toHaveTextContent("Paragraph 2 · 45 words46.7%");
  });

  test("a source titled like the paper itself is pointed out and can be excluded in one step", async () => {
    await setup(TEXT, [{ id: "own", title: "Soil respiration in riparian forests", text: LIBRARY[0]!.text }]);
    const notice = within(summary()).getByText(/This looks like your paper itself/).closest("div")!.parentElement!;
    fireEvent.click(within(notice).getByRole("button", { name: "Exclude it" }));
    expect(screen.queryByText(/This looks like your paper itself/)).toBeNull();
    expect(summary()).toHaveTextContent("0%");
  });

  test("look-alike letters and paraphrasing-tool phrases are flagged as hidden copying", async () => {
    const text =
      "Machine learning in ecology\n\nRecent work on counterfeit consciousness has changed how field data are read. " +
      "We trained a model on twelve years of plot data from the floodplain sites.\n\n" +
      "The mоdel learned seasonal patterns that the older regression could not capture, and it did so with far fewer labelled examples than expected.";
    await setup(text, []);
    const flags = screen.getByRole("region", { name: "Integrity flags" });
    expect(flags).toHaveTextContent("1 disguised passage: look-alike letters");
    expect(flags).toHaveTextContent("1 phrase typical of paraphrasing tools, such as “counterfeit consciousness”");
  });

  test("a clean text says nothing was found, and the full report can leave out its own download", async () => {
    await setup("Unrelated words about something else entirely, written fresh for this test and found nowhere.", LIBRARY, { showDownload: false });
    expect(summary()).toHaveTextContent("Low similarity");
    expect(summary()).toHaveTextContent("No problems found in the sources searched.");
    expect(screen.getByText(/No copied or reworded passages in the sources searched/)).toBeInTheDocument();
    expect(screen.getByText(/No matched passages in the sources that were searched/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download PDF report/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "Integrity flags" })).toBeNull();
    expect(screen.getByText("What was searched").closest("details")).toHaveTextContent("Your library");
  });
});
