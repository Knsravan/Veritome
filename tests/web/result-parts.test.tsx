import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { AiSummary, WholePaperNote } from "@/components/AiSummary";
import { ColumnStrip, StackedBar } from "@/components/charts";
import type { AiBreakdown } from "@/core/detector/breakdown";
import type { DetectorResult } from "@/core/detector/types";
import { stubLayoutApis } from "./dom-stubs";

beforeAll(stubLayoutApis);
afterEach(cleanup);

/** Only the fields AiSummary reads. */
const result = (model: Partial<DetectorResult["model"]>, warnings: string[] = []) =>
  ({ model: { thresholds: { likelyAi: 0.7, likelyHuman: 0.3 }, ...model }, warnings }) as unknown as DetectorResult;

const breakdown = (b: Partial<AiBreakdown>): AiBreakdown => ({
  judged: true,
  aiPercent: 0,
  uncertainPercent: 0,
  humanPercent: 100,
  words: 400,
  regions: [],
  ...b,
});

describe("AiSummary", () => {
  test("shows the AI share with a bar of how the text reads", () => {
    render(<AiSummary ai={result({ neural: "used" })} b={breakdown({ aiPercent: 32.5, uncertainPercent: 17.5, humanPercent: 50 })} />);
    const card = screen.getByRole("region", { name: "AI writing summary" });
    expect(card).toHaveTextContent("32.5%");
    expect(card).toHaveTextContent("Parts read as AI-written");
    expect(within(card).getByRole("img")).toHaveAccessibleName(
      "How the text reads: Likely AI-written 32.5%, Unclear 17.5%, Likely human-written 50%",
    );
    expect(card).toHaveTextContent("How far to trust this:");
    expect(screen.queryByText(/could not run in this browser/)).toBeNull();
  });

  test("wording follows the share: a little, or none", () => {
    render(<AiSummary ai={result({ neural: "used" })} b={breakdown({ aiPercent: 5, humanPercent: 95 })} />);
    expect(screen.getByText("A little reads as AI-written")).toBeInTheDocument();
    cleanup();
    render(<AiSummary ai={result({ neural: "used" })} b={breakdown({})} />);
    expect(screen.getByText("No AI-written parts found")).toBeInTheDocument();
  });

  test("too little text is not judged", () => {
    render(<AiSummary ai={result({ neural: "used" })} b={breakdown({ judged: false })} />);
    expect(screen.getByText(/Not enough text to judge/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  test("when the models could not run it warns, and offers to try again", () => {
    const onRetry = vi.fn();
    render(<AiSummary ai={result({ neural: "unavailable" })} b={breakdown({ judged: false })} onRetry={onRetry} />);
    expect(screen.getByText("The AI models could not run in this browser")).toBeInTheDocument();
    expect(screen.getByText("Not judged: the AI models did not run.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  test("shows the whole-paper note and passes on warnings, except the per-section one", () => {
    render(
      <AiSummary
        ai={result({ neural: "used", document: { paragraphs: 20, aboveHumanRange: 14, share: 0.7 } }, ["Scored per-section.", "Mostly maths."])}
        b={breakdown({ aiPercent: 70, humanPercent: 30 })}
      />,
    );
    expect(screen.getByText(/14 of 20 paragraphs \(\s*70%\) score above the range of human writing/)).toBeInTheDocument();
    expect(screen.getByText("Mostly maths.")).toBeInTheDocument();
    expect(screen.queryByText(/per-section/)).toBeNull();
  });

  test("WholePaperNote rounds the share", () => {
    render(<WholePaperNote doc={{ paragraphs: 3, aboveHumanRange: 2, share: 2 / 3 }} />);
    expect(screen.getByText(/\(\s*67%\)/)).toBeInTheDocument();
  });
});

describe("charts", () => {
  const segments = [
    { key: "a", label: "Copied", value: 12.34, color: "red" },
    { key: "b", label: "Reworded", value: 0, color: "blue" },
  ];

  test("StackedBar names every segment, draws only non-empty ones and keeps all in the legend", () => {
    const { container } = render(<StackedBar label="Matches" segments={segments} legendExtra={<li>Extra</li>} />);
    expect(screen.getByRole("img")).toHaveAccessibleName("Matches: Copied 12.3%, Reworded 0%");
    expect(screen.getByRole("img").children).toHaveLength(1);
    const legend = container.querySelector("figcaption")!;
    expect(legend).toHaveTextContent("Copied: 12.3%");
    expect(legend).toHaveTextContent("Reworded: 0%");
    expect(legend).toHaveTextContent("Extra");
  });

  test("StackedBar shows a tooltip for the hovered segment", () => {
    render(<StackedBar label="Matches" segments={segments} />);
    fireEvent.mouseEnter(screen.getByText("Copied:", { exact: false }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Copied 12.3%");
  });

  test("ColumnStrip labels each column, reports clicks and has a table view", () => {
    const onSelect = vi.fn();
    const data = [
      { label: "Paragraph 1", value: 0 },
      { label: "Paragraph 2", value: 0.5, note: "120 words" },
    ];
    render(<ColumnStrip title="Per paragraph" data={data} color="red" threshold={0.7} thresholdLabel="likely AI above this line" onSelect={onSelect} />);
    const columns = within(screen.getByRole("list", { name: "Per paragraph" })).getAllByRole("button");
    expect(columns.map((c) => c.getAttribute("aria-label"))).toEqual(["Paragraph 1: 0%", "Paragraph 2: 50%, 120 words"]);
    expect(screen.getByText("likely AI above this line")).toBeInTheDocument();
    fireEvent.focus(columns[1]!);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Paragraph 2 50% · 120 words");
    fireEvent.click(columns[1]!);
    expect(onSelect).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows.map((r) => r.textContent)).toEqual(["PartValue", "Paragraph 10%", "Paragraph 2 · 120 words50%"]);
    expect(screen.getByRole("button", { name: "Show chart" })).toHaveAttribute("aria-expanded", "true");
  });

  test("ColumnStrip uses a custom format", () => {
    render(<ColumnStrip title="AI" data={[{ label: "Paragraph 1", value: 0.83 }]} color="red" format={(v) => `${Math.round(v * 100)} / 100`} />);
    expect(screen.getByRole("button", { name: "Paragraph 1: 83 / 100" })).toBeInTheDocument();
  });
});
