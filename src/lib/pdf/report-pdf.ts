import { aiBreakdown } from "@/core/detector/breakdown";
import { reviewReport } from "@/core/plagiarism/review";
import {
  buildActionList,
  documentStats,
  type ActionLevel,
} from "@/core/report/actions";
import { paragraphStats } from "@/core/report/paragraphs";
import type { PaperReport } from "@/core/report/report";
import { writePlagiarismSection } from "./plagiarism-pdf";
import { loadUnicodeFonts, PDF_COLORS, PdfWriter, pdfSafe } from "./writer";
import { annotatePdf, wordPages, markStyle } from "./paper-pages";
import { CATEGORY_LABEL } from "@/components/report/PaperPanel";
import { numberedFindings } from "./marked-original";
import { logoPng } from "./logo";
import type { DocModel } from "../doc/model";

const LEVEL: Record<ActionLevel, { text: string; color: string }> = {
  high: { text: "Fix", color: PDF_COLORS.critical },
  medium: { text: "Check", color: PDF_COLORS.serious },
  low: { text: "Consider", color: PDF_COLORS.neutral },
};

const REF_STATUS: Record<string, string> = {
  verified: "Verified",
  likely: "Probably right",
  mismatch: "DOI points elsewhere",
  not_found: "Not found",
  unchecked: "Not checked",
};

export interface ReportPdfOptions {
  /** The uploaded file's name, shown on the cover. */
  fileName?: string;
}

/** A short, stable identifier for a report, from the checked text (nothing is stored). */
export function reportId(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const s = h.toString(36).toUpperCase().padStart(7, "0");
  return `VT-${s.slice(0, 4)}-${s.slice(4)}${text.length.toString(36).toUpperCase()}`;
}

/**
 * The report as a PDF file, built in the browser from the report on screen, in the manner of Turnitin's reports:
 * a cover with the scores, the numbered findings, the detailed sections, then the paper's own pages, unchanged,
 * with every finding underlined by a coloured curve and numbered where it starts. Every page carries the Veritome
 * mark, the report ID and its page number.
 */
export async function buildReportPdf(
  report: PaperReport,
  text: string,
  paper: DocModel | null = null,
  options: ReportPdfOptions = {},
): Promise<Blob> {
  const original =
    paper && paper.text === text && (paper.kind === "pdf" || paper.data)
      ? paper
      : null;
  const aiOnly =
    report.plagiarism.status !== "done" && report.detector.status === "done";
  const kind = aiOnly ? "AI writing report" : "Similarity and AI report";
  const id = reportId(text);
  const [{ jsPDF }, logo] = await Promise.all([import("jspdf"), logoPng()]);
  const w = new PdfWriter(new jsPDF({ unit: "pt", format: "a4" }));
  await loadUnicodeFonts(w.doc);
  const doc = w.doc;
  const findings = numberedFindings(report, text);
  writeCover(w, {
    kind,
    id,
    logo,
    report,
    text,
    findings: findings.filter((f) => f.n !== undefined).length,
    ...(options.fileName ? { fileName: options.fileName } : {}),
    ...(original?.kind === "pdf" ? { pages: original.pages.length } : {}),
  });
  doc.addPage();
  w.y = w.margin + 10;

  // Four headline figures.
  const p =
    report.plagiarism.status === "done" ? report.plagiarism.result : null;
  const d = report.detector.status === "done" ? report.detector.result : null;
  const c = report.citations.status === "done" ? report.citations.result : null;
  const g = report.grammar.status === "done" ? report.grammar.result : null;
  const ai = d ? aiBreakdown(d, text) : null;
  const quarter = w.content / 4;
  if (!aiOnly) {
    w.ensure(96);
    w.figure(
      w.margin,
      p ? `${p.similarity}%` : "–",
      "Similarity",
      p ? "of words match a source word for word" : "Not run",
      quarter - 10,
    );
    w.figure(
      w.margin + quarter,
      ai?.judged ? `${ai.aiPercent}%` : "–",
      "AI writing",
      ai?.judged
        ? "in paragraphs that read as likely AI"
        : "Not enough text or not run",
      quarter - 10,
    );
    const v = c?.verification?.counts;
    w.figure(
      w.margin + quarter * 2,
      c
        ? v
          ? `${v.verified + v.likely}/${c.references.length}`
          : String(c.references.length)
        : "–",
      "References found",
      v
        ? `${v.not_found + v.mismatch} to check by hand`
        : (c?.verificationSkipped ?? "Not run"),
      quarter - 10,
    );
    w.figure(
      w.margin + quarter * 3,
      g ? `${g.summary.score}/100` : "–",
      "Writing score",
      g
        ? `${g.summary.total} notes, ${g.summary.bySeverity.error} likely errors`
        : "Not run",
      quarter - 10,
    );
    w.y += 96;
  }

  const stats = documentStats(report, text);
  w.text(
    `Document: ${stats.words.toLocaleString("en")} words, ${stats.sentences ?? "–"} sentences, ${stats.paragraphs} paragraphs, ${stats.references} references, about ${stats.readingMinutes} min to read${stats.readingLevel ? `, reading level ${stats.readingLevel.toLowerCase()}` : ""}.`,
    { size: 9, color: PDF_COLORS.soft },
  );

  // What to fix first.
  const actions = buildActionList(report, 50);
  w.heading(`What to fix first (${actions.length})`, 14);
  if (!actions.length)
    w.text("Nothing urgent was found by the checks that ran.", { size: 10 });
  actions.forEach((a) => {
    w.ensure(40);
    const tag = LEVEL[a.level];
    w.fill(tag.color);
    doc.roundedRect(w.margin, w.y + 1, 42, 12, 3, 3, "F");
    w.font(7.5, "bold");
    w.color(a.level === "low" ? PDF_COLORS.ink : "#ffffff");
    doc.text(tag.text.toUpperCase(), w.margin + 21, w.y + 9.5, {
      align: "center",
    });
    w.text(a.title, { size: 10, style: "bold", indent: 50, gap: 1 });
    if (a.quote)
      w.text(`"${a.quote}"`, { size: 9, family: "times", indent: 50, gap: 1 });
    w.text(a.detail, { size: 8.5, color: PDF_COLORS.soft, indent: 50, gap: 6 });
  });

  // Plagiarism and AI writing.
  if (p) {
    doc.addPage();
    w.y = w.margin;
    w.heading("Similarity and AI writing", 16);
    const reviewed = reviewReport(p);
    writePlagiarismSection(w, {
      text,
      report: p,
      reviewed,
      ai,
      ...(d ? { aiThreshold: d.model.thresholds.likelyAi } : {}),
      paragraphs: paragraphStats(
        text,
        { spans: reviewed.spans, paraphrases: reviewed.paraphrases },
        ai,
      ),
      filters: { minWords: 0, excluded: [] },
      skipMarkedText: Boolean(original),
    });
  }

  // Citations.
  if (c) {
    doc.addPage();
    w.y = w.margin;
    w.heading("Citations", 16);
    if (c.verification) {
      w.table(
        ["#", "Reference", "Result", "Notes"],
        c.verification.checks.map((ch) => [
          String(ch.index),
          ch.raw.length > 260 ? `${ch.raw.slice(0, 259)}…` : ch.raw,
          REF_STATUS[ch.status] ?? ch.status,
          [
            ...ch.flags.map((f) => f.replace(/_/g, " ")),
            ...ch.discrepancies.map(
              (x) =>
                `${x.field}: cited ${x.cited ?? "–"}, record ${x.actual ?? "–"}`,
            ),
            ...ch.notes,
          ].join("; "),
        ]),
        [4, 52, 14, 30],
      );
    } else if (c.verificationSkipped)
      w.text(c.verificationSkipped, { size: 9.5 });
    const x = c.crossCheck;
    w.text(`In-text citations: ${x.citations.length} (${x.style} style).`, {
      size: 9.5,
    });
    if (x.citedButMissing.length)
      w.text(
        `Cited but not in the reference list: ${x.citedButMissing.map((m) => m.citation.raw).join("; ")}.`,
        { size: 9.5 },
      );
    if (x.uncitedReferences.length)
      w.text(
        `In the reference list but never cited: entries ${x.uncitedReferences.map((r) => r.index).join(", ")}.`,
        { size: 9.5 },
      );
    for (const wn of x.warnings)
      w.text(wn, { size: 9, color: PDF_COLORS.soft });
    if (c.claims.length) {
      w.heading(`Sentences that may need a citation (${c.claims.length})`, 12);
      c.claims.forEach((cl, i) => {
        w.text(`${i + 1}. "${cl.text}"`, {
          size: 9.5,
          family: "times",
          indent: 10,
          gap: 1,
        });
        w.text(`Why: ${cl.reasons.join("; ")}.`, {
          size: 8.5,
          color: PDF_COLORS.soft,
          indent: 10,
          gap: 1,
        });
        const sug = c.suggestions.find((s) => s.claim.start === cl.start);
        for (const s of sug?.suggestions ?? []) {
          w.text(
            `Paper to look at: ${s.work.title}${s.work.year ? ` (${s.work.year})` : ""}${s.work.doi ? `, https://doi.org/${s.work.doi}` : ""}`,
            { size: 8.5, indent: 20, gap: 1 },
          );
        }
        w.space(4);
      });
    }
  }

  // Grammar.
  if (g) {
    doc.addPage();
    w.y = w.margin;
    w.heading("Grammar and style", 16);
    const m = g.metrics;
    w.table(
      ["Measure", "Value"],
      [
        ["Writing score", `${g.summary.score}/100`],
        [
          "Notes",
          `${g.summary.total} (${g.summary.bySeverity.error} likely errors, ${g.summary.bySeverity.warning} worth a look, ${g.summary.bySeverity.info} suggestions)`,
        ],
        ["Reading level", m.level],
        ["Flesch reading ease", String(Math.round(m.fleschReadingEase))],
        [
          "Average sentence",
          `${m.avgSentenceLength.toFixed(1)} words (longest ${m.longestSentence})`,
        ],
        ["Passive sentences", `${Math.round(m.passiveSentenceRatio * 100)}%`],
      ],
      [30, 70],
    );
    if (g.issues.length) {
      w.table(
        ["Text", "Note", "Suggestion"],
        g.issues.map((i) => [
          i.text,
          `${i.severity === "error" ? "Likely error" : i.severity === "warning" ? "Worth a look" : "Suggestion"}: ${i.message}`,
          i.suggestions[0] === undefined
            ? "–"
            : i.suggestions[0] === ""
              ? "delete it"
              : i.suggestions.slice(0, 3).join(", "),
        ]),
        [26, 52, 22],
      );
    }
  }

  // Rewrite suggestions.
  const rewrites = [
    ...(report.paraphrase.status === "done" ? report.paraphrase.result : []),
    ...(report.humanise.status === "done" ? report.humanise.result : []),
  ];
  if (rewrites.length) {
    w.heading("Suggested rewrites", 14);
    rewrites.forEach((sg, i) => {
      w.text(`${i + 1}. ${sg.reason}`, { size: 9.5, style: "bold", gap: 2 });
      w.text(`Original: "${sg.result.original}"`, {
        size: 9,
        family: "times",
        color: PDF_COLORS.soft,
        indent: 10,
        gap: 2,
      });
      w.text(`Suggested: "${sg.result.text}"`, {
        size: 9,
        family: "times",
        indent: 10,
        gap: 8,
      });
    });
  }

  // The numbered findings, matching the numbers on the paper's pages.
  const numbered = findings.filter((f) => f.n !== undefined);
  if (numbered.length) {
    doc.addPage();
    w.y = w.margin + 10;
    w.heading(`Findings (${numbered.length})`, 16);
    w.text(
      original
        ? "Each finding is numbered as on the pages of your paper that follow, where its words are underlined by a curve in the same colour."
        : "Each finding is numbered in reading order, with the words it concerns.",
      { size: 9.5, color: PDF_COLORS.soft, gap: 10 },
    );
    for (const f of numbered) {
      const st = markStyle(f);
      w.ensure(60);
      w.fill(st.color);
      doc.roundedRect(w.margin, w.y + 1, 20, 13, 3, 3, "F");
      w.font(8, "bold");
      w.color("#ffffff");
      doc.text(String(f.n), w.margin + 10, w.y + 10.2, { align: "center" });
      w.text(
        f.title === CATEGORY_LABEL[f.category]
          ? f.title
          : `${CATEGORY_LABEL[f.category]} · ${f.title}`,
        { size: 10, style: "bold", indent: 28, gap: 1 },
      );
      const quote = text.slice(f.start, f.end).replace(/\s+/g, " ").trim();
      w.text(`"${quote.length > 240 ? `${quote.slice(0, 239)}…` : quote}"`, {
        size: 9,
        family: "times",
        indent: 28,
        gap: 1,
      });
      if (f.note)
        w.text(f.note, { size: 8.5, style: "bold", indent: 28, gap: 1 });
      w.text(`${f.why} How to fix: ${f.fix}`, {
        size: 8.5,
        color: PDF_COLORS.soft,
        indent: 28,
        gap: 8,
      });
    }
  }

  w.heading("About this report", 12);
  w.text(report.disclaimer, { size: 9, color: PDF_COLORS.soft });
  w.text(
    "Underlines: copied word for word, heavy curve in the source's colour; reworded or translated, light curve in the source's colour; hidden copying, double red curve; AI-written or AI-polished, violet curve; citation needed, teal curve; grammar, thin coral curve.",
    { size: 8.5, color: PDF_COLORS.soft },
  );
  const summaryPages = doc.getNumberOfPages();
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (const pg of await out.copyPages(
    await PDFDocument.load(doc.output("arraybuffer")),
    [...Array(summaryPages).keys()],
  ))
    out.addPage(pg);

  // The paper itself: its own pages, unchanged, each set in a frame with the report's header and footer bands.
  if (original) {
    const marks = findings.map((f) => ({
      id: f.id,
      start: f.start,
      end: f.end,
      className: f.className,
      ...(f.n !== undefined ? { n: f.n } : {}),
      ...(f.group ? { group: f.group } : {}),
    }));
    if (original.kind === "pdf") {
      const marked = await PDFDocument.load(
        await annotatePdf(original, marks),
        { ignoreEncryption: true },
      );
      const embedded = await out.embedPages(marked.getPages());
      for (const e of embedded) {
        const page = out.addPage([e.width, e.height + BAND * 2]);
        page.drawPage(e, { x: 0, y: BAND });
      }
    } else {
      const pages = await wordPages(
        original,
        text,
        marks.map((m) => ({ ...m, label: "" })),
      );
      for (const pg of pages) {
        const img = await out.embedJpg(pg.url);
        const page = out.addPage([pg.width, pg.height + BAND * 2]);
        page.drawImage(img, {
          x: 0,
          y: BAND,
          width: pg.width,
          height: pg.height,
        });
      }
    }
  }
  await stampBands(out, {
    kind,
    id,
    logo,
    paperFrom: original ? summaryPages : Infinity,
  });
  return new Blob([(await out.save()) as BlobPart], {
    type: "application/pdf",
  });
}

/** Height of the header and footer bands around the paper's own pages, in points. */
const BAND = 26;

function writeCover(
  w: PdfWriter,
  c: {
    kind: string;
    id: string;
    logo: string | null;
    report: PaperReport;
    text: string;
    findings: number;
    fileName?: string;
    pages?: number;
  },
) {
  const doc = w.doc;
  // Brand.
  if (c.logo) doc.addImage(c.logo, "PNG", w.margin, w.margin, 34, 34);
  w.font(20, "bold");
  w.color(PDF_COLORS.ink);
  doc.text("Veritome", w.margin + (c.logo ? 44 : 0), w.margin + 24);
  w.font(9, "bold");
  w.color(PDF_COLORS.faint);
  doc.text(c.kind.toUpperCase(), w.width - w.margin, w.margin + 24, {
    align: "right",
  });
  w.y = w.margin + 120;
  // Title.
  const first = c.text.trim().split("\n")[0]?.trim() ?? "";
  const title =
    c.fileName ??
    (first.length > 3 && first.length < 160 ? first : "Untitled document");
  w.text(title, { size: 22, style: "bold", gap: 6 });
  if (
    c.fileName &&
    first.length > 3 &&
    first.length < 160 &&
    first !== c.fileName
  )
    w.text(first, { size: 11, color: PDF_COLORS.soft, gap: 6 });
  w.rule();
  // Details, as on a submission receipt.
  const date = new Date(c.report.generatedAt);
  const rows: Array<[string, string]> = [
    ["Report ID", c.id],
    [
      "Checked on",
      `${date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} at ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
    ],
    ...(c.fileName ? ([["File", c.fileName]] as Array<[string, string]>) : []),
    ["Words", c.report.words.toLocaleString("en")],
    ...(c.pages
      ? ([["Pages", String(c.pages)]] as Array<[string, string]>)
      : []),
    ["Findings", String(c.findings)],
  ];
  for (const [k, v] of rows) {
    w.font(9, "bold");
    w.color(PDF_COLORS.faint);
    doc.text(k, w.margin, w.y + 10);
    w.font(11);
    w.color(PDF_COLORS.ink);
    doc.text(pdfSafe(v), w.margin + 110, w.y + 10);
    w.y += 20;
  }
  w.y += 16;
  // Headline scores.
  const p =
    c.report.plagiarism.status === "done" ? c.report.plagiarism.result : null;
  const d =
    c.report.detector.status === "done" ? c.report.detector.result : null;
  const ai = d ? aiBreakdown(d, c.text) : null;
  const half = w.content / 2;
  if (p)
    w.figure(
      w.margin,
      `${p.similarity}%`,
      "Similarity",
      "of words match a source",
      half - 12,
    );
  w.figure(
    p ? w.margin + half : w.margin,
    ai?.judged ? `${ai.aiPercent}%` : "–",
    "AI writing",
    ai?.judged
      ? "in paragraphs that read as AI-written or AI-polished"
      : "Not enough text, or not run",
    half - 12,
  );
  w.y += 110;
  w.text(
    "Automated signals to review, not a verdict. A match or an AI flag is a reason to look again, never proof on its own.",
    { size: 9, color: PDF_COLORS.soft },
  );
}

/** The Veritome header and footer on every page: mark, report type and ID above; page number below. */
async function stampBands(
  out: import("pdf-lib").PDFDocument,
  c: { kind: string; id: string; logo: string | null; paperFrom: number },
) {
  const { StandardFonts, rgb } = await import("pdf-lib");
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const logo = c.logo ? await out.embedPng(c.logo) : null;
  const pages = out.getPages();
  const grey = rgb(0.42, 0.47, 0.53);
  pages.forEach((page, i) => {
    const { width, height } = page.getSize();
    const isPaper = i >= c.paperFrom;
    if (isPaper) {
      page.drawRectangle({
        x: 0,
        y: height - BAND,
        width,
        height: BAND,
        color: rgb(0.97, 0.97, 0.99),
      });
      page.drawRectangle({
        x: 0,
        y: 0,
        width,
        height: BAND,
        color: rgb(0.97, 0.97, 0.99),
      });
    }
    const top = height - (isPaper ? 17 : 26);
    if (logo)
      page.drawImage(logo, { x: 36, y: top - 4, width: 12, height: 12 });
    page.drawText("Veritome", {
      x: logo ? 52 : 36,
      y: top,
      size: 8.5,
      font: bold,
      color: rgb(0.11, 0.15, 0.2),
    });
    page.drawText(
      `Page ${i + 1} of ${pages.length} · ${isPaper ? "Your paper, with findings marked" : c.kind}`,
      { x: 100, y: top, size: 7.5, font, color: grey },
    );
    const idText = `Report ID ${c.id}`;
    page.drawText(idText, {
      x: width - 36 - font.widthOfTextAtSize(idText, 7.5),
      y: top,
      size: 7.5,
      font,
      color: grey,
    });
    const foot = "Veritome · automated signals to review, not a verdict";
    page.drawText(foot, {
      x: 36,
      y: isPaper ? 9 : 22,
      size: 7,
      font,
      color: grey,
    });
    const pn = `Page ${i + 1} of ${pages.length}`;
    page.drawText(pn, {
      x: width - 36 - font.widthOfTextAtSize(pn, 7),
      y: isPaper ? 9 : 22,
      size: 7,
      font,
      color: grey,
    });
  });
}
