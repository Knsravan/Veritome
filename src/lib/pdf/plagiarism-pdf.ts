import type { AiBreakdown } from "@/core/detector/breakdown";
import { ISSUE_TEXT, type IssueKind, type ReviewedReport } from "@/core/plagiarism/review";
import type { PlagiarismReport } from "@/core/plagiarism/types";
import type { ParagraphStat } from "@/core/report/paragraphs";
import { PDF_COLORS, PdfWriter, type Mark } from "./writer";

export interface PlagiarismPdfInput {
  text: string;
  report: PlagiarismReport;
  /** The report after the reader's filters, as shown on screen. */
  reviewed: ReviewedReport;
  ai?: AiBreakdown | null;
  aiThreshold?: number;
  paragraphs: ParagraphStat[];
  filters: { minWords: number; excluded: string[] };
}

const KIND_FILL: Record<IssueKind, string> = {
  copied_uncited: PDF_COLORS.tintCritical,
  disguised: PDF_COLORS.tintCritical,
  tortured: PDF_COLORS.tintCritical,
  copied_cited: PDF_COLORS.tintSerious,
  own_work: PDF_COLORS.tintWarning,
  reworded_uncited: PDF_COLORS.tintWarning,
  quote_uncited: PDF_COLORS.tintNeutral,
  reworded_cited: PDF_COLORS.tintNeutral,
  repeated: PDF_COLORS.tintNeutral,
};

const KIND_COLOR: Record<IssueKind, string> = {
  copied_uncited: PDF_COLORS.critical,
  disguised: PDF_COLORS.critical,
  tortured: PDF_COLORS.critical,
  copied_cited: PDF_COLORS.serious,
  own_work: PDF_COLORS.warning,
  reworded_uncited: PDF_COLORS.warning,
  quote_uncited: PDF_COLORS.neutral,
  reworded_cited: PDF_COLORS.neutral,
  repeated: PDF_COLORS.neutral,
};

const pct = (n: number) => `${Math.round(n * 10) / 10}%`;

/** Builds the similarity report as a PDF file, entirely in the browser: nothing is sent anywhere. */
export async function buildPlagiarismPdf(input: PlagiarismPdfInput): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const w = new PdfWriter(new jsPDF({ unit: "pt", format: "a4" }));
  writeTitle(w, "VERITOME SIMILARITY REPORT", input.text, `${input.report.words.toLocaleString("en")} words checked`);
  writePlagiarismSection(w, input);
  w.footer("Veritome similarity report · automated signals to review, not a verdict");
  return w.doc.output("blob");
}

/** Report label, document title and a date line. */
export function writeTitle(w: PdfWriter, kicker: string, text: string, detail: string) {
  const date = new Date();
  w.font(9, "bold");
  w.color(PDF_COLORS.faint);
  w.doc.text(kicker, w.margin, w.y + 9);
  w.y += 14;
  const title = text.trim().split("\n")[0]?.trim() ?? "";
  w.text(title.length > 3 && title.length < 160 ? title : "Untitled document", { size: 18, style: "bold", gap: 2 });
  w.text(
    `${detail} on ${date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} at ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.`,
    { size: 9, color: PDF_COLORS.soft },
  );
  w.rule();
}

/** The whole similarity section: figures, charts, every finding, sources, the marked-up text and the limits. */
export function writePlagiarismSection(w: PdfWriter, input: PlagiarismPdfInput) {
  const doc = w.doc;
  const { report, reviewed: r, ai, text } = input;
  const total = Math.max(1, report.words);
  const number = new Map(r.primary.map((s, i) => [s.id, i + 1]));
  if (input.filters.minWords || input.filters.excluded.length) {
    w.text(
      [input.filters.minWords ? `Matches under ${input.filters.minWords} words hidden.` : "", input.filters.excluded.length ? `${input.filters.excluded.length} source(s) excluded by the reader.` : ""]
        .filter(Boolean)
        .join(" "),
      { size: 9, color: PDF_COLORS.soft },
    );
  }

  // Headline figures.
  w.ensure(90);
  const serious = r.issues.filter((i) => ISSUE_TEXT[i.kind].serious).length;
  w.figure(w.margin, pct(r.similarity), "Similarity", `${r.matchedWords} of ${report.words} words match a source word for word. ${serious} passage(s) need fixing.`);
  if (ai?.judged) w.figure(w.margin + w.content / 2, pct(ai.aiPercent), "AI writing", "of the text is in paragraphs that read as likely AI-written. A pattern match, not proof.");
  else w.figure(w.margin + w.content / 2, "–", "AI writing", ai ? "Not enough text to judge (about 150 words needed)." : "Not checked.");
  w.y += 90;

  w.heading("What the matches are", 12);
  const kinds: IssueKind[] = ["copied_uncited", "copied_cited", "own_work", "reworded_uncited", "repeated"];
  w.stackedBar(kinds.filter((k) => k !== "repeated" || r.breakdown[k] > 0).map((k) => ({ label: ISSUE_TEXT[k].title, value: (r.breakdown[k] / total) * 100, color: KIND_COLOR[k] })));
  if (r.breakdown.quote_uncited) w.text(`Quotations without a citation: ${r.breakdown.quote_uncited}.`, { size: 9 });

  if (ai?.judged) {
    w.heading("How the text reads", 12);
    w.stackedBar([
      { label: "Likely AI-written", value: ai.aiPercent, color: PDF_COLORS.ai },
      { label: "Unclear", value: ai.uncertainPercent, color: PDF_COLORS.neutral },
      { label: "Likely human-written", value: ai.humanPercent, color: PDF_COLORS.human },
    ]);
    w.text(
      "How far to trust this: in testing it wrongly flagged 2 of 764 paragraphs written by people before AI tools existed (0.3%) and caught about half of AI-written texts. Edited or paraphrased AI text often passes.",
      { size: 8.5, color: PDF_COLORS.soft },
    );
  }

  if (input.paragraphs.length >= 2) {
    w.heading("Where in the document", 12);
    w.columns("Text matching a source, by paragraph", input.paragraphs.map((p) => Math.min(1, p.copied + p.reworded)), PDF_COLORS.seq);
    if (ai?.judged) w.columns("How AI-like each paragraph reads (dashed line: likely AI)", input.paragraphs.map((p) => p.ai ?? 0), PDF_COLORS.ai, input.aiThreshold);
  }

  // Every finding.
  w.heading(`What to fix (${r.issues.length + (ai?.regions.filter((x) => x.kind === "ai").length ?? 0)})`, 14);
  if (!r.issues.length && !ai?.regions.some((x) => x.kind === "ai")) w.text("No copied or reworded passages were found in the sources searched.", { size: 10 });
  const groups = (Object.keys(ISSUE_TEXT) as IssueKind[]).map((k) => ({ k, items: r.issues.filter((i) => i.kind === k) })).filter((g) => g.items.length);
  for (const g of groups) {
    const t = ISSUE_TEXT[g.k];
    w.ensure(60);
    w.space(4);
    w.fill(KIND_COLOR[g.k]);
    doc.circle(w.margin + 4, w.y + 7, 4, "F");
    w.text(`${t.title} (${g.items.length})`, { size: 11, style: "bold", indent: 14, gap: 1 });
    w.text(`Why it matters: ${t.why}`, { size: 9, color: PDF_COLORS.soft, gap: 1 });
    w.text(`How to fix: ${t.fix}`, { size: 9, gap: 6 });
    g.items.forEach((i, n) => {
      const src = i.sourceId ? input.report.sources.find((s) => s.id === i.sourceId) : undefined;
      const num = i.sourceId ? number.get(i.sourceId) : undefined;
      w.text(`${n + 1}. ${/^["“]/.test(i.text) ? i.text : `"${i.text}"`}`, { size: 9.5, family: "times", indent: 10, gap: 1 });
      const meta = [
        `${i.words} words`,
        src ? `source ${num ?? ""}: ${src.title}${src.year ? ` (${src.year})` : ""}` : "",
        i.citation ? `citation found: ${i.citation}` : "",
        i.kind === "tortured" && i.note ? i.note : "",
      ].filter(Boolean);
      w.text(meta.join(" · "), { size: 8.5, color: PDF_COLORS.soft, indent: 10, gap: 1 });
      const sp = r.spans.find((s) => s.start === i.start);
      if (sp?.sourceExcerpt) w.text(`Source wording: "${sp.sourceExcerpt.text}"`, { size: 8.5, color: PDF_COLORS.soft, indent: 10, gap: 1, style: "italic" });
      const pm = r.paraphrases.find((p) => p.start === i.start);
      if (pm) w.text(`Closest source sentence: "${pm.sourceText}"`, { size: 8.5, color: PDF_COLORS.soft, indent: 10, gap: 1, style: "italic" });
      w.space(5);
    });
  }
  const aiParts = ai?.regions.filter((x) => x.kind === "ai") ?? [];
  if (aiParts.length) {
    w.ensure(50);
    w.space(4);
    w.fill(PDF_COLORS.ai);
    doc.circle(w.margin + 4, w.y + 7, 4, "F");
    w.text(`Reads as AI-written (${aiParts.length})`, { size: 11, style: "bold", indent: 14, gap: 1 });
    w.text("How to fix: rewrite these parts in your own words and voice, and disclose AI use where your journal or university asks. This is a pattern match, not proof.", { size: 9, gap: 6 });
    aiParts.forEach((x, n) => {
      const passage = text.slice(x.start, x.end).replace(/\s+/g, " ");
      w.text(`${n + 1}. "${passage.length > 600 ? `${passage.slice(0, 600)}…` : passage}"`, { size: 9.5, family: "times", indent: 10, gap: 1 });
      w.text(`AI estimate ${Math.round(x.probability * 100)} / 100`, { size: 8.5, color: PDF_COLORS.soft, indent: 10, gap: 6 });
    });
  }

  // Sources.
  w.heading(`Sources (${r.primary.length})`, 14);
  if (r.primary.length) {
    w.table(
      ["#", "Source", "Found via", "Share", "Words"],
      r.primary.map((s, i) => [
        String(i + 1),
        `${s.title}${s.year ? ` (${s.year})` : ""}${s.authors ? `, ${s.authors}` : ""}${s.url ? `\n${s.url}` : ""}`,
        [s.provider, ...s.alsoAt].join(", "),
        pct(s.primaryPercent),
        String(s.primaryWords),
      ]),
      [4, 52, 18, 9, 8],
    );
  } else w.text("None of the searched sources shared a run of words with the text.", { size: 10 });
  if (r.others.length) {
    w.text(`Also containing the same wording (not the best match, often because they quote the original): ${r.others.map((s) => s.title).join("; ")}.`, { size: 8.5, color: PDF_COLORS.soft });
  }

  // The marked-up text.
  doc.addPage();
  w.y = w.margin;
  w.heading("Your text with findings marked", 14);
  w.text(
    "Red: copied without a citation. Orange: cited but missing quotation marks. Yellow: reworded without a citation. Grey: other notes. [n] gives the source number. A magenta bar in the margin marks paragraphs that read as likely AI-written.",
    { size: 8.5, color: PDF_COLORS.soft, gap: 8 },
  );
  const marks: Mark[] = r.issues.map((i) => ({
    start: i.start,
    end: i.end,
    fill: KIND_FILL[i.kind],
    ...(i.sourceId && number.has(i.sourceId) ? { tag: String(number.get(i.sourceId)), tagColor: KIND_COLOR[i.kind] === PDF_COLORS.neutral ? PDF_COLORS.faint : KIND_COLOR[i.kind] } : {}),
  }));
  w.markedText(text, marks, aiParts.map((x) => ({ start: x.start, end: x.end, color: PDF_COLORS.ai })));

  // What was searched and the limits.
  w.heading("What was searched", 12);
  w.table(
    ["Service", "What it covers", "Searches", "Documents"],
    report.providers.map((p) => [p.name, p.coverage, p.kind === "library" || p.kind === "self" ? "–" : `${p.queries - p.failures} of ${p.queries}`, String(p.documents)]),
    [16, 56, 14, 12],
  );
  if (report.warnings.length) w.text(`Notes: ${report.warnings.join(" ")}`, { size: 8.5, color: PDF_COLORS.soft });
  w.heading("What this report can't tell you", 12);
  w.text(report.disclaimer, { size: 9, color: PDF_COLORS.soft });
  w.text(
    "Word-for-word runs of six or more words are counted; shorter stock phrases are ignored. Whether a match is cited is judged from citations in the same sentence. Paywalled papers, theses and student-paper databases are not searched, and translated text can slip through.",
    { size: 9, color: PDF_COLORS.soft },
  );

}
