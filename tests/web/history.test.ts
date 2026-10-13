import { Blob as NodeBlob } from "node:buffer";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

// A fresh, empty database for every test.
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
});

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

/** Ids in one of history's stores, read straight from the database. */
function storedIds(store: "history" | "history-body"): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("veritome");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const keys = db.transaction(store, "readonly").objectStore(store).getAllKeys();
      keys.onsuccess = () => {
        db.close();
        resolve(keys.result as string[]);
      };
      keys.onerror = () => reject(keys.error);
    };
  });
}

describe("saved checks", () => {
  const plagiarism = (text: string, extra: Partial<Parameters<typeof saveCheck>[0]> = {}) =>
    saveCheck({ tool: "plagiarism", title: titleFor(text), text, words: text.split(" ").length, figures: [{ label: "Similarity", value: "12%" }], payload: { similarity: 12 }, ...extra });

  test("a saved check is listed and reopens with its text, result and file", async () => {
    const changed = vi.fn();
    const stop = onHistoryChange(changed);
    // Node's Blob, because jsdom's does not survive the structured clone IndexedDB stores values with (a browser's does).
    const file = new NodeBlob(["%PDF-1.7 fake"], { type: "application/pdf" }) as unknown as Blob;
    const id = await plagiarism("A short paper about alder respiration.", { file: { name: "paper.pdf", data: file } });
    stop();
    expect(id).toEqual(expect.any(String));
    expect(changed).toHaveBeenCalledOnce();

    const list = await listChecks();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, tool: "plagiarism", title: "A short paper about alder respiration.", words: 6, figures: [{ label: "Similarity", value: "12%" }] });
    // The list holds only summaries, not the text or the result.
    expect(list[0]).not.toHaveProperty("text");
    expect(list[0]).not.toHaveProperty("payload");

    const back = await getCheck(id!);
    expect(back).toMatchObject({ id, text: "A short paper about alder respiration.", payload: { similarity: 12 } });
    expect(back!.file!.name).toBe("paper.pdf");
    expect(back!.file!.data.size).toBe(file.size);
    expect(back!.file!.data.type).toBe("application/pdf");
    expect(await back!.file!.data.text()).toBe("%PDF-1.7 fake");
    expect(await getCheck("missing")).toBeNull();
  });

  test("the newest check is listed first", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      await plagiarism("First text");
      vi.setSystemTime(new Date("2026-01-02T10:00:00Z"));
      await plagiarism("Second text");
    } finally {
      vi.useRealTimers();
    }
    expect((await listChecks()).map((c) => c.title)).toEqual(["Second text", "First text"]);
  });

  test("saving with the same id replaces the entry", async () => {
    const id = await plagiarism("Draft one");
    await plagiarism("Draft one, revised", { id: id! });
    const list = await listChecks();
    expect(list).toHaveLength(1);
    expect((await getCheck(id!))!.text).toBe("Draft one, revised");
  });

  test("a repeat check of the same text with the same tool is found, ignoring spacing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      await plagiarism("Same words here");
      vi.setSystemTime(new Date("2026-01-03T10:00:00Z"));
      const latest = await plagiarism("Same words here");
      expect((await findCheck("plagiarism", "Same   words\nhere"))!.id).toBe(latest);
    } finally {
      vi.useRealTimers();
    }
    expect(await findCheck("detector", "Same words here")).toBeNull();
    expect(await findCheck("plagiarism", "Other words here")).toBeNull();
  });

  test("checks can be deleted one at a time or all at once, and nothing is left behind", async () => {
    const a = await plagiarism("Keep me");
    const b = await plagiarism("Delete me");
    await plagiarism("Clear me");
    const changed = vi.fn();
    const stop = onHistoryChange(changed);
    await deleteCheck(b!);
    expect((await listChecks()).map((c) => c.id)).not.toContain(b);
    // The text and result go too, not just the list entry.
    expect(await storedIds("history-body")).not.toContain(b);
    expect(await getCheck(b!)).toBeNull();
    expect(await findCheck("plagiarism", "Delete me")).toBeNull();
    expect(await getCheck(a!)).not.toBeNull();

    await clearChecks();
    stop();
    expect(await listChecks()).toEqual([]);
    expect(await storedIds("history-body")).toEqual([]);
    expect(await getCheck(a!)).toBeNull();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  test("switching history off stops saving but keeps what was saved", async () => {
    await plagiarism("Saved before");
    setHistoryEnabled(false);
    expect(await plagiarism("Not saved")).toBeNull();
    expect((await listChecks()).map((c) => c.title)).toEqual(["Saved before"]);
  });
});
