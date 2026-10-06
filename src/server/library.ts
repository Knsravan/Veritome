import "server-only";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { LibraryDoc } from "../core/plagiarism/types.ts";
import { extractDocument } from "./extract.ts";

const SUPPORTED = new Set([".txt", ".md", ".tex", ".docx", ".pdf"]);
let cache: { dir: string; at: number; docs: LibraryDoc[] } | null = null;
const TTL_MS = 5 * 60_000;

/**
 * Loads the operator's local document library (for example the group's
 * earlier papers) from LIBRARY_DIR. Read-only, cached for five minutes.
 */
export async function loadLibrary(dir: string | undefined): Promise<LibraryDoc[]> {
  if (!dir) return [];
  if (cache && cache.dir === dir && Date.now() - cache.at < TTL_MS) return cache.docs;
  const docs: LibraryDoc[] = [];
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  for (const name of names.sort()) {
    if (!SUPPORTED.has(extname(name).toLowerCase()) || /^readme\./i.test(name) || name.startsWith(".") || docs.length >= 500) continue;
    const path = join(dir, name);
    try {
      if (!(await stat(path)).isFile()) continue;
      const doc = await extractDocument(name, await readFile(path));
      docs.push({ id: `dir:${name}`, title: basename(name, extname(name)), text: doc.text });
    } catch {
      // Unreadable files are skipped; the status endpoint shows how many loaded.
    }
  }
  cache = { dir, at: Date.now(), docs };
  return docs;
}
