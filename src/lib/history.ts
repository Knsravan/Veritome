/**
 * The user's history of checks, kept only in their own browser (IndexedDB): the report or result, the checked text
 * and the original file, so a check can be reopened without running it again. Nothing here is ever sent to the
 * server. Saving can be switched off, and entries deleted one by one or all at once.
 */

export type HistoryTool = "plagiarism" | "detector" | "humaniser" | "paraphraser";

export interface HistorySummary {
  id: string;
  tool: HistoryTool;
  /** ISO date. */
  createdAt: string;
  /** File name, or the first words of pasted text. */
  title: string;
  /** Identifies the same text checked with the same tool. */
  key: string;
  words: number;
  /** Headline figures for the list. */
  figures: Array<{ label: string; value: string }>;
}

export interface HistoryEntry extends HistorySummary {
  text: string;
  /** The original file, when the check was on a file. */
  file?: { name: string; data: Blob };
  /** The tool's own result (report, detector result, humaniser paragraphs). */
  payload: unknown;
}

const DB = "veritome";
const VERSION = 1;
const LIST = "history";
const BODY = "history-body";
const PREF = "veritome.history";
const EVENT = "veritome-history";

/** Whether checks are saved on this device (on unless the user switched it off). */
export function historyEnabled(): boolean {
  try {
    return localStorage.getItem(PREF) !== "off";
  } catch {
    return false;
  }
}

export function setHistoryEnabled(on: boolean): void {
  try {
    localStorage.setItem(PREF, on ? "on" : "off");
  } catch {
    // Storage blocked: nothing to remember.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Calls `fn` whenever the history or its setting changes in this tab. */
export function onHistoryChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("This browser cannot save history."));
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LIST)) {
        const s = db.createObjectStore(LIST, { keyPath: "id" });
        s.createIndex("key", "key");
      }
      if (!db.objectStoreNames.contains(BODY)) db.createObjectStore(BODY, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("History could not be opened."));
  });
}

function run<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(stores, mode);
        const req = fn(t);
        t.oncomplete = () => {
          db.close();
          resolve(req ? req.result : undefined);
        };
        t.onerror = () => {
          db.close();
          reject(t.error ?? new Error("History could not be saved."));
        };
        t.onabort = () => {
          db.close();
          reject(t.error ?? new Error("History could not be saved (the browser may be out of space)."));
        };
      }),
  );
}

/** A short fingerprint of the tool and the checked text (SHA-256), for spotting repeat checks. */
export async function historyKey(tool: HistoryTool, text: string): Promise<string> {
  const norm = text.replace(/\s+/g, " ").trim();
  const bytes = new TextEncoder().encode(`${tool}\n${norm}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function titleFor(text: string, fileName?: string): string {
  if (fileName) return fileName;
  const words = text.replace(/\s+/g, " ").trim().split(" ").slice(0, 10).join(" ");
  return words.length < text.trim().length ? `${words}…` : words || "Pasted text";
}

/**
 * Saves a check (or replaces the entry with the same id). Does nothing when history is off. Returns the id, or
 * null when nothing was saved.
 */
export async function saveCheck(entry: Omit<HistoryEntry, "id" | "createdAt" | "key"> & { id?: string }): Promise<string | null> {
  if (!historyEnabled()) return null;
  try {
    const id = entry.id ?? crypto.randomUUID();
    const key = await historyKey(entry.tool, entry.text);
    const summary: HistorySummary = {
      id,
      tool: entry.tool,
      createdAt: new Date().toISOString(),
      title: entry.title,
      key,
      words: entry.words,
      figures: entry.figures,
    };
    await run([LIST, BODY], "readwrite", (t) => {
      t.objectStore(LIST).put(summary);
      t.objectStore(BODY).put({ id, text: entry.text, payload: entry.payload, ...(entry.file ? { file: entry.file } : {}) });
    });
    window.dispatchEvent(new Event(EVENT));
    return id;
  } catch {
    return null;
  }
}

export async function listChecks(): Promise<HistorySummary[]> {
  try {
    const all = (await run<HistorySummary[]>([LIST], "readonly", (t) => t.objectStore(LIST).getAll())) ?? [];
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function getCheck(id: string): Promise<HistoryEntry | null> {
  try {
    const db = await open();
    const get = <T>(store: string) =>
      new Promise<T | undefined>((resolve, reject) => {
        const req = db.transaction(store, "readonly").objectStore(store).get(id);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      });
    const [summary, body] = await Promise.all([get<HistorySummary>(LIST), get<Omit<HistoryEntry, keyof HistorySummary> & { id: string }>(BODY)]);
    db.close();
    if (!summary || !body) return null;
    return { ...summary, text: body.text, payload: body.payload, ...(body.file ? { file: body.file } : {}) };
  } catch {
    return null;
  }
}

/** The latest earlier check of the same text with the same tool, if any. */
export async function findCheck(tool: HistoryTool, text: string): Promise<HistorySummary | null> {
  if (!text.trim()) return null;
  try {
    const key = await historyKey(tool, text);
    const hits = (await run<HistorySummary[]>([LIST], "readonly", (t) => t.objectStore(LIST).index("key").getAll(key))) ?? [];
    return hits.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  } catch {
    return null;
  }
}

export async function deleteCheck(id: string): Promise<void> {
  await run([LIST, BODY], "readwrite", (t) => {
    t.objectStore(LIST).delete(id);
    t.objectStore(BODY).delete(id);
  }).catch(() => undefined);
  window.dispatchEvent(new Event(EVENT));
}

export async function clearChecks(): Promise<void> {
  await run([LIST, BODY], "readwrite", (t) => {
    t.objectStore(LIST).clear();
    t.objectStore(BODY).clear();
  }).catch(() => undefined);
  window.dispatchEvent(new Event(EVENT));
}

/** The address that reopens a saved check in its tool. */
export function openHref(s: Pick<HistorySummary, "tool" | "id">): string {
  return `/${s.tool}?open=${encodeURIComponent(s.id)}`;
}
