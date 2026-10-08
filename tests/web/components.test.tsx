import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { AnnotatedText, flattenMarks } from "@/components/AnnotatedText";
import { BandBar } from "@/components/BandBar";
import { DiffView } from "@/components/DiffView";
import Home from "@/app/page";
import { applyIssueFix } from "@/lib/fixes";
import type { Issue } from "@/core/grammar/types";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

describe("components", () => {
  test("home page lists all seven tools with their limits", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Check your paper before reviewers do.");
    for (const name of ["Plagiarism", "AI detector", "Humaniser", "Paraphraser", "Citations", "Grammar"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.getAllByText(/^Limit:/, { selector: "span" })).toHaveLength(7);
  });

  test("BandBar describes the range for screen readers", () => {
    render(<BandBar score={61} low={29} high={94} leftLabel="Few patterns" rightLabel="Many patterns" />);
    expect(screen.getByRole("img")).toHaveAccessibleName(/Score 61 out of 100; plausible range 29 to 94/);
  });

  test("AnnotatedText renders focusable marks and reports selection", () => {
    const onSelect = vi.fn();
    render(<AnnotatedText text="The the cat sat." marks={[{ id: "a", start: 4, end: 7, className: "mark-grammar", label: "Repeated word" }]} onSelect={onSelect} />);
    const mark = screen.getByRole("button", { name: "Repeated word: the" });
    fireEvent.keyDown(mark, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("a");
    expect(mark).toHaveAttribute("tabindex", "0");
  });

  test("flattenMarks drops overlaps and out-of-range marks", () => {
    const m = (id: string, start: number, end: number) => ({ id, start, end, className: "", label: "" });
    expect(flattenMarks([m("b", 2, 6), m("a", 0, 4), m("c", 6, 8), m("d", 7, 99)], 10).map((x) => x.id)).toEqual(["a", "c"]);
  });

  test("DiffView marks insertions and deletions accessibly", () => {
    const { container } = render(<DiffView before="the quick fox" after="the slow fox" />);
    expect(container.querySelector("del")).toHaveTextContent("quick");
    expect(container.querySelector("ins")).toHaveTextContent("slow");
  });

  test("applyIssueFix shifts later issues and drops overlapping ones", () => {
    const issue = (id: string, start: number, end: number): Issue => ({
      id, rule: "r", category: "grammar", severity: "error", message: "", start, end, text: "", suggestions: [], source: "veritome",
    });
    const all = [issue("a", 0, 3), issue("b", 4, 7), issue("c", 10, 12)];
    const r = applyIssueFix("abc defgh ij", all, all[1]!, "X");
    expect(r.text).toBe("abc Xgh ij");
    expect(r.issues.map((i) => [i.id, i.start, i.end])).toEqual([["a", 0, 3], ["c", 8, 10]]);
  });
});
