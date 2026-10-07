import { aiBreakdown } from "@/core/detector/breakdown";
import { reviewReport } from "@/core/plagiarism/review";
import { buildActionList, documentStats, type ActionLevel } from "@/core/report/actions";
import { paragraphStats } from "@/core/report/paragraphs";
import type { PaperReport } from "@/core/report/report";
import { writePlagiarismSection, writeTitle } from "./plagiarism-pdf";
import { loadUnicodeFonts, PDF_COLORS, PdfWriter } from "./writer";
import { annotatePdf, joinPdfs, wordPages, type LineStyle } from "./paper-pages";
import { collectFindings } from "@/components/report/PaperPanel";
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

/** The full paper report as a PDF file, built in the browser from the report on screen. */
export async function buildReportPdf(report: PaperReport, text: string, paper: DocModel | null = null): Promise<Blob> {
  const original = paper && paper.text === text && (paper.kind === "pdf" || paper.data) ? paper : null;
  const { jsPDF } = await import("jspdf");
  const w = new PdfWriter(new jsPDF({ unit: "pt", format: "a4" }));
  await loadUnicodeFonts(w.doc);
  const doc = w.doc;
  writeTitle(w, "VERITOME PAPER REPORT", text, `${report.words.toLocaleString("en")} words checked`);

  // Four headline figures.
  const p = report.plagiarism.status === "done" ? report.plagiarism.result : null;
  const d = report.detector.status === "done" ? report.detector.result : null;
  const c = report.citations.status === "done" ? report.citations.result : null;
  const g = report.grammar.status === "done" ? report.grammar.result : null;
  const ai = d ? aiBreakdown(d, text) : null;
  const quarter = w.content / 4;
  w.ensure(96);
  w.figure(w.margin, p ? `${p.similarity}%` : "–", "Similarity", p ? "of words match a source word for word" : "Not run", quarter - 10);
  w.figure(w.margin + quarter, ai?.judged ? `${ai.aiPercent}%` : "–", "AI writing", ai?.judged ? "in paragraphs that read as likely AI" : "Not enough text or not run", quarter - 10);
  const v = c?.verification?.counts;
  w.figure(w.margin + quarter * 2, c ? (v ? `${v.verified + v.likely}/${c.references.length}` : String(c.references.length)) : "–", "References found", v ? `${v.not_found + v.mismatch} to check by hand` : c?.verificationSkipped ?? "Not run", quarter - 10);
  w.figure(w.margin + quarter * 3, g ? `${g.summary.score}/100` : "–", "Writing score", g ? `${g.summary.total} notes, ${g.summary.bySeverity.error} likely errors` : "Not run", quarter - 10);
  w.y += 96;

  const stats = documentStats(report, text);
  w.text(
    `Document: ${stats.words.toLocaleString("en")} words, ${stats.sentences ?? "–"} sentences, ${stats.paragraphs} paragraphs, ${stats.references} references, about ${stats.readingMinutes} min to read${stats.readingLevel ? `, reading level ${stats.readingLevel.toLowerCase()}` : ""}.`,
    { size: 9, color: PDF_COLORS.soft },
  );

  // What to fix first.
  const actions = buildActionList(report, 50);
  w.heading(`What to fix first (${actions.length})`, 14);
  if (!actions.length) w.text("Nothing urgent was found by the checks that ran.", { size: 10 });
  actions.forEach((a) => {
    w.ensure(40);
    const tag = LEVEL[a.level];
    w.fill(tag.color);
    doc.roundedRect(w.margin, w.y + 1, 42, 12, 3, 3, "F");
    w.font(7.5, "bold");
    w.color(a.level === "low" ? PDF_COLORS.ink : "#ffffff");
    doc.text(tag.text.toUpperCase(), w.margin + 21, w.y + 9.5, { align: "center" });
    w.text(a.title, { size: 10, style: "bold", indent: 50, gap: 1 });
    if (a.quote) w.text(`"${a.quote}"`, { size: 9, family: "times", indent: 50, gap: 1 });
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
      paragraphs: paragraphStats(text, { spans: reviewed.spans, paraphrases: reviewed.paraphrases }, ai),
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
          [...ch.flags.map((f) => f.replace(/_/g, " ")), ...ch.discrepancies.map((x) => `${x.field}: cited ${x.cited ?? "–"}, record ${x.actual ?? "–"}`), ...ch.notes].join("; "),
        ]),
        [4, 52, 14, 30],
      );
    } else if (c.verificationSkipped) w.text(c.verificationSkipped, { size: 9.5 });
    const x = c.crossCheck;
    w.text(`In-text citations: ${x.citations.length} (${x.style} style).`, { size: 9.5 });
    if (x.citedButMissing.length) w.text(`Cited but not in the reference list: ${x.citedButMissing.map((m) => m.citation.raw).join("; ")}.`, { size: 9.5 });
    if (x.uncitedReferences.length) w.text(`In the reference list but never cited: entries ${x.uncitedReferences.map((r) => r.index).join(", ")}.`, { size: 9.5 });
    for (const wn of x.warnings) w.text(wn, { size: 9, color: PDF_COLORS.soft });
    if (c.claims.length) {
      w.heading(`Sentences that may need a citation (${c.claims.length})`, 12);
      c.claims.forEach((cl, i) => {
        w.text(`${i + 1}. "${cl.text}"`, { size: 9.5, family: "times", indent: 10, gap: 1 });
        w.text(`Why: ${cl.reasons.join("; ")}.`, { size: 8.5, color: PDF_COLORS.soft, indent: 10, gap: 1 });
        const sug = c.suggestions.find((s) => s.claim.start === cl.start);
        for (const s of sug?.suggestions ?? []) {
          w.text(`Paper to look at: ${s.work.title}${s.work.year ? ` (${s.work.year})` : ""}${s.work.doi ? `, https://doi.org/${s.work.doi}` : ""}`, { size: 8.5, indent: 20, gap: 1 });
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
        ["Notes", `${g.summary.total} (${g.summary.bySeverity.error} likely errors, ${g.summary.bySeverity.warning} worth a look, ${g.summary.bySeverity.info} suggestions)`],
        ["Reading level", m.level],
        ["Flesch reading ease", String(Math.round(m.fleschReadingEase))],
        ["Average sentence", `${m.avgSentenceLength.toFixed(1)} words (longest ${m.longestSentence})`],
        ["Passive sentences", `${Math.round(m.passiveSentenceRatio * 100)}%`],
      ],
      [30, 70],
    );
    if (g.issues.length) {
      w.table(
        ["Text", "Note", "Suggestion"],
        g.issues.map((i) => [i.text, `${i.severity === "error" ? "Likely error" : i.severity === "warning" ? "Worth a look" : "Suggestion"}: ${i.message}`, i.suggestions[0] === undefined ? "–" : i.suggestions[0] === "" ? "delete it" : i.suggestions.slice(0, 3).join(", ")]),
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
      w.text(`Original: "${sg.result.original}"`, { size: 9, family: "times", color: PDF_COLORS.soft, indent: 10, gap: 2 });
      w.text(`Suggested: "${sg.result.text}"`, { size: 9, family: "times", indent: 10, gap: 8 });
    });
  }

  w.heading("About this report", 12);
  w.text(report.disclaimer, { size: 9, color: PDF_COLORS.soft });
  if (!original) {
    w.footer("Veritome paper report · automated signals to review, not a verdict");
    return doc.output("blob");
  }

  // The paper itself, in its own layout, with every finding underlined.
  const marks = collectFindings(report, text).map((f) => ({ id: f.id, start: f.start, end: f.end, className: f.className, label: f.title, ...(f.group ? { group: f.group } : {}) }));
  doc.addPage();
  w.y = w.margin;
  w.heading("Your paper, with every finding underlined", 16);
  w.text(
    `The following pages are your ${original.kind === "pdf" ? "PDF" : "Word file"} as it looks, with each finding underlined. The same underlines are on the “Your paper” tab of the report on screen, where selecting one explains it.`,
    { size: 10, color: PDF_COLORS.soft, gap: 10 },
  );
  const legend: Array<[string, string, LineStyle]> = [
    ["Copied word for word (colour shows the source)", "#e0a100", "solid"],
    ["Reworded or translated from a source", "#3a8ee6", "dotted"],
    ["Hidden copying (disguised text, paraphrasing-tool phrases)", "#dc2626", "double"],
    ["Reads as AI-written", "#8b5cf6", "wavy"],
    ["Citation needed or missing", "#0f9f8f", "dashed"],
    ["Grammar and spelling", "#e5484d", "thin"],
  ];
  for (const [label, colour, style] of legend) {
    w.ensure(18);
    const y = w.y + 9;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
    doc.setDrawColor(r!, g!, b!);
    doc.setLineWidth(style === "thin" ? 0.8 : 1.4);
    doc.setLineDashPattern(style === "dotted" ? [1, 2] : style === "dashed" ? [4, 2.5] : [], 0);
    if (style === "wavy") for (let x = w.margin; x < w.margin + 40; x += 3) doc.line(x, y + (Math.round((x - w.margin) / 3) % 2 ? 1.2 : -1.2), x + 3, y + (Math.round((x - w.margin) / 3) % 2 ? -1.2 : 1.2));
    else {
      doc.line(w.margin, y, w.margin + 40, y);
      if (style === "double") doc.line(w.margin, y + 2.4, w.margin + 40, y + 2.4);
    }
    doc.setLineDashPattern([], 0);
    w.font(10);
    w.color(PDF_COLORS.ink);
    doc.text(label, w.margin + 52, y + 3);
    w.y += 18;
  }
  w.footer("Veritome paper report · automated signals to review, not a verdict");

  if (original.kind === "docx") {
    const pages = await wordPages(original, text, marks);
    for (const pg of pages) {
      doc.addPage([pg.width, pg.height], pg.width > pg.height ? "landscape" : "portrait");
      doc.addImage(pg.url, "JPEG", 0, 0, pg.width, pg.height);
    }
    return doc.output("blob");
  }
  const annotated = await annotatePdf(original, marks);
  const joined = await joinPdfs(doc.output("arraybuffer"), annotated);
  return new Blob([joined as BlobPart], { type: "application/pdf" });
}
