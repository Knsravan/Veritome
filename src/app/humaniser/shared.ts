import {
  assemble,
  paragraphEdits,
  type HumaniseParagraphResult,
  type HumaniseTone,
  type PlannedParagraph,
} from "@/core/rewrite/humanise";
import type { DocModel } from "@/lib/doc/model";

export type Mode = "text" | "file";

export interface Item {
  piece: PlannedParagraph;
  state: "skip" | "waiting" | "working" | "done" | "failed";
  result?: HumaniseParagraphResult;
  error?: string;
  /** Which version goes into the final text. */
  use: "revised" | "original" | "edited";
  edited?: string;
}

export interface Job {
  mode: Mode;
  text: string;
  tone: HumaniseTone;
  doc: DocModel | null;
  fileName?: string;
  items: Item[];
}

export const finalOf = (it: Item) =>
  it.use === "edited" && it.edited !== undefined
    ? it.edited
    : it.use === "revised" && it.result?.status === "rewritten"
      ? it.result.text
      : it.piece.text;

export const finalText = (job: Job) =>
  assemble(
    job.text,
    job.items.map((it) => it.piece),
    job.items.map(finalOf),
  );

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The format the humanised file comes back in: the uploaded one for PDF and Word, otherwise a new Word file. */
export function outputKind(job: Job): "pdf" | "docx" | "new-docx" {
  if (job.doc?.kind === "pdf" && job.doc.data) return "pdf";
  if (job.doc?.kind === "docx" && job.doc.data) return "docx";
  return "new-docx";
}

export interface BuiltFile {
  blob: Blob;
  name: string;
  /** Changed paragraphs written into the file, and those left as they were. */
  applied: number;
  skipped: number;
  /** Text ranges of the changed paragraphs that were left as they were. */
  skippedRanges: Array<{ start: number; end: number }>;
}

/**
 * The humanised document in its own format: a PDF with each changed paragraph set in place in the same fonts and
 * layout, the same Word file with the changes made in each paragraph's own formatting (or as tracked changes), or
 * a new Word file for other sources.
 */
export async function buildFile(job: Job, tracked = false): Promise<BuiltFile> {
  const base = (job.fileName ?? "text").replace(/\.[^.]+$/, "");
  const kind = outputKind(job);
  const edits = paragraphEdits(
    job.text,
    job.items.map((it) => it.piece),
    job.items.map(finalOf),
  );
  if (kind === "pdf" && job.doc?.kind === "pdf") {
    const { rewritePdf } = await import("@/lib/doc/pdf-rewrite");
    const out = await rewritePdf(job.doc, edits);
    return {
      blob: new Blob([out.bytes.slice()], { type: "application/pdf" }),
      name: `${base}-humanised.pdf`,
      applied: out.applied,
      skipped: out.skipped,
      skippedRanges: edits.filter((e) => out.reasons.has(e.start)),
    };
  }
  const { plainDocx, reviseDocx } = await import("@/lib/doc/docx-revise");
  if (kind === "docx" && job.doc?.data) {
    const out = await reviseDocx(job.doc.name, job.doc.data, edits, {
      mode: tracked ? "tracked" : "clean",
    });
    return {
      blob: out.blob,
      name: `${base}-humanised${tracked ? "-tracked" : ""}.docx`,
      applied: out.applied,
      skipped: out.skipped,
      skippedRanges: edits.filter((e) => out.skippedAt.includes(e.start)),
    };
  }
  const blob = await plainDocx(
    finalText(job)
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
      .filter(Boolean),
  );
  return {
    blob,
    name: `${base}-humanised.docx`,
    applied: edits.length,
    skipped: 0,
    skippedRanges: [],
  };
}
