import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadLibrary } from "../../src/server/library.ts";

test("loadLibrary reads supported files and skips README, hidden and unknown files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "veritome-lib-"));
  writeFileSync(join(dir, "README.md"), "About this folder.");
  writeFileSync(join(dir, ".notes.txt"), "Hidden.");
  writeFileSync(join(dir, "data.csv"), "a,b");
  writeFileSync(join(dir, "old-paper.txt"), "Alder stands kept respiring into October.");
  const docs = await loadLibrary(dir);
  assert.deepEqual(docs.map((d) => d.title), ["old-paper"]);
  assert.match(docs[0]!.text, /Alder stands/);
  assert.deepEqual(await loadLibrary(undefined), []);
  assert.deepEqual(await loadLibrary(join(dir, "missing")), []);
});
