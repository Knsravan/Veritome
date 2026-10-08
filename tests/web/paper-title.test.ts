import { expect, test } from "vitest";
import { paperTitle } from "@/lib/paper-title";

test("a title that wraps onto a second line is read whole", () => {
  expect(paperTitle("Interactive Quantum Computing Simulator: Visualization and\nExploration of Qubit States and Quantum Circuits\n\nMacharla Shashidhar")).toBe(
    "Interactive Quantum Computing Simulator: Visualization and Exploration of Qubit States and Quantum Circuits",
  );
  expect(paperTitle("This paper begins with a sentence.\nAnd goes on.")).toBeNull();
});
