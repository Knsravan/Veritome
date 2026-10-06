import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { detectKind, ExtractionError, extractDocument } from "../../src/server/extract.ts";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
const enc = (s: string) => new TextEncoder().encode(s);

test("detectKind uses magic bytes before the extension", () => {
  assert.equal(detectKind("paper.txt", enc("%PDF-1.7")), "pdf");
  assert.equal(detectKind("paper.docx", enc("PK\u0003\u0004")), "docx");
  assert.equal(detectKind("paper.tex", enc("\\section")), "tex");
  assert.equal(detectKind("notes.md", enc("# Hi")), "md");
  assert.throws(() => detectKind("paper.doc", enc("xx")), ExtractionError);
  assert.throws(() => detectKind("paper.pdf", enc("hello")), /valid \.pdf/);
  assert.throws(() => detectKind("data.xlsx", enc("PK\u0003\u0004")), /docx/);
});

test("extracts plain text and LaTeX", async () => {
  const t = await extractDocument("a.txt", enc("\uFEFFHello world.\r\nSecond line."));
  assert.equal(t.text, "Hello world.\nSecond line.");
  assert.equal(t.words, 4);
  const tex = await extractDocument("a.tex", enc("\\begin{document}\\section{Intro}Some \\emph{text}.\\end{document}"));
  assert.equal(tex.text, "Intro\n\nSome text.");
  assert.equal(tex.kind, "tex");
});

test("extracts .docx with paragraphs", async () => {
  const d = await extractDocument("sample.docx", fixture("sample.docx"));
  assert.equal(d.kind, "docx");
  assert.match(d.text, /We measured soil respiration at 14 sites over two summers \(Smith et al\., 2020\)\./);
  assert.match(d.text, /References\n\nSmith, J\./);
});

test("extracts .pdf and repairs hyphenation", async () => {
  const d = await extractDocument("sample.pdf", fixture("sample.pdf"));
  assert.equal(d.kind, "pdf");
  assert.match(d.text, /We measured soil respiration at 14 sites/);
  assert.match(d.text, /variance in the data\./);
});

test("rejects empty, binary and oversize input", async () => {
  await assert.rejects(extractDocument("a.txt", new Uint8Array()), /empty/);
  await assert.rejects(extractDocument("a.txt", new Uint8Array([104, 0, 105])), /binary/);
  await assert.rejects(extractDocument("a.txt", new Uint8Array(16 * 1024 * 1024)), /MB/);
  await assert.rejects(extractDocument("a.pdf", enc("%PDF-1.4 broken")), /could not be read/);
});
