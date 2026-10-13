import { afterEach, describe, expect, test, vi } from "vitest";
import {
  clearChecks,
  deleteCheck,
  findCheck,
  getCheck,
  historyEnabled,
  historyKey,
  listChecks,
  onHistoryChange,
  openHref,
  saveCheck,
  setHistoryEnabled,
  titleFor,
} from "@/lib/history";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

const entry = { tool: "detector" as const, title: "Draft", text: "Some text", words: 2, figures: [], payload: {} };

describe("history", () => {
  test("is on by default and can be switched off, telling listeners each time", () => {
    const fn = vi.fn();
    const stop = onHistoryChange(fn);
    expect(historyEnabled()).toBe(true);
    setHistoryEnabled(false);
    expect(historyEnabled()).toBe(false);
    setHistoryEnabled(true);
    expect(historyEnabled()).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
    setHistoryEnabled(false);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("counts as off when the browser blocks storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(historyEnabled()).toBe(false);
    vi.restoreAllMocks();
  });

  test("the key ignores spacing but not the tool or the words", async () => {
    const a = await historyKey("plagiarism", "One  two\nthree ");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await historyKey("plagiarism", "One two three")).toBe(a);
    expect(await historyKey("detector", "One two three")).not.toBe(a);
    expect(await historyKey("plagiarism", "One two four")).not.toBe(a);
  });

  test("titles use the file name, or the first ten words of the text", () => {
    expect(titleFor("anything", "paper.docx")).toBe("paper.docx");
    expect(titleFor("Short note")).toBe("Short note");
    expect(titleFor("one two three four five six seven eight nine ten eleven")).toBe("one two three four five six seven eight nine ten…");
    expect(titleFor("   ")).toBe("Pasted text");
  });

  test("links reopen a check in its own tool", () => {
    expect(openHref({ tool: "humaniser", id: "a b/c" })).toBe("/humaniser?open=a%20b%2Fc");
  });

  test("saves nothing while switched off", async () => {
    setHistoryEnabled(false);
    expect(await saveCheck(entry)).toBeNull();
  });

  test("fails quietly in a browser that cannot store history", async () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(await saveCheck(entry)).toBeNull();
    expect(await listChecks()).toEqual([]);
    expect(await getCheck("x")).toBeNull();
    expect(await findCheck("detector", "Some text")).toBeNull();
    await expect(deleteCheck("x")).resolves.toBeUndefined();
    await expect(clearChecks()).resolves.toBeUndefined();
  });

  test("an empty text is never looked up", async () => {
    expect(await findCheck("detector", "  ")).toBeNull();
  });
});
