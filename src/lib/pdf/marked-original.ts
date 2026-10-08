/**
 * The user's own file with the findings marked, in its own format: a PDF gets underlines drawn on its original
 * pages; a Word file gets wavy underlines and a numbered margin comment per finding. Nothing else changes.
 */
import {
  collectFindings,
  numberFindings,
  type Finding,
} from "@/components/report/PaperPanel";
import type { PaperReport } from "@/core/report/report";
import type { DocModel } from "../doc/model";
import { markStyle } from "./paper-pages";

/**
 * Findings in reading order, numbered from 1 as in the report. Grammar notes are underlined but not numbered, so
 * the numbers stay on the findings that matter (copying, AI writing, citations).
 */
export function numberedFindings(
  report: PaperReport,
  text: string,
): Array<Finding & { n?: number }> {
  return numberFindings(collectFindings(report, text));
}

export async function markedOriginal(
  report: PaperReport,
  text: string,
  doc: DocModel,
): Promise<{ blob: Blob; ext: string }> {
  const findings = numberedFindings(report, text);
  if (doc.kind === "pdf") {
    const { annotatePdf } = await import("./paper-pages");
    const bytes = await annotatePdf(
      doc,
      findings.map((f) => ({
        id: f.id,
        start: f.start,
        end: f.end,
        className: f.className,
        ...(f.n !== undefined ? { n: f.n } : {}),
        ...(f.group ? { group: f.group } : {}),
      })),
    );
    return {
      blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
      ext: "pdf",
    };
  }
  if (doc.kind === "docx" && doc.data) {
    const { annotateDocx } = await import("../doc/docx-annotate");
    const blob = await annotateDocx(
      doc.name,
      doc.data,
      findings.map((f) => {
        const st = markStyle(f);
        return {
          start: f.start,
          end: f.end,
          color: st.color.replace("#", "").toUpperCase(),
          style:
            f.category === "flags"
              ? "wavyDouble"
              : f.category === "copied"
                ? "wavyHeavy"
                : "wave",
          ...(f.n !== undefined
            ? {
                comment: `[${f.n}] ${f.title}${f.note ? ` · ${f.note}` : ""}\n${f.why}\nHow to fix: ${f.fix}`,
              }
            : {}),
        };
      }),
    );
    return { blob, ext: "docx" };
  }
  throw new Error("This file type cannot be marked.");
}
