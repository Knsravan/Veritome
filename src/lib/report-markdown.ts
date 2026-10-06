import { formatReferenceText } from "@/core/citations/format";
import type { PaperReport, Section, ToolId } from "@/core/report/report";

const TOOL_NAMES: Record<ToolId, string> = {
  plagiarism: "Plagiarism",
  detector: "AI writing patterns",
  citations: "Citations",
  grammar: "Grammar and style",
  paraphrase: "Paraphrase suggestions",
  humanise: "Revision suggestions",
};

const STATUS_WORDS = { ok: "Looks fine", review: "Worth reviewing", attention: "Needs attention", skipped: "Skipped", error: "Failed" } as const;

function sectionNote<T>(s: Section<T>): string | null {
  if (s.status === "skipped") return `Skipped: ${s.reason}`;
  if (s.status === "error") return `Failed: ${s.message}`;
  return null;
}

/** A Markdown version of the report the user can save or share. Contains excerpts of their text by design. */
export function reportToMarkdown(r: PaperReport): string {
  const out: string[] = [];
  out.push("# Veritome paper report", "");
  out.push(`Generated ${new Date(r.generatedAt).toUTCString()} for a text of ${r.words.toLocaleString("en")} words.`, "");
  out.push(`> ${r.disclaimer}`, "");
  out.push("## Overview", "");
  for (const o of r.overview) out.push(`- **${TOOL_NAMES[o.tool]}** (${STATUS_WORDS[o.status]}): ${o.headline}`);
  out.push("");

  out.push("## Plagiarism", "");
  const p = r.plagiarism;
  if (p.status === "done") {
    out.push(`Similarity ${p.result.similarity}% word for word (${p.result.verdict}), plus ${p.result.paraphrasePercent}% reworded.`, "");
    for (const pm of p.result.paraphrases.slice(0, 20)) out.push(`- Reworded: “${pm.text}” resembles “${pm.sourceText}”`);
    if (p.result.paraphrases.length) out.push("");
    for (const s of p.result.sources.slice(0, 20)) out.push(`- ${s.percent}%: ${s.title}${s.url ? ` <${s.url}>` : ""} (${s.provider})`);
    out.push("", `_${p.result.disclaimer}_`, "");
  } else out.push(sectionNote(p) ?? "", "");

  out.push("## AI writing patterns", "");
  const d = r.detector;
  if (d.status === "done") {
    out.push(`Pattern score ${d.result.score}, plausible range ${d.result.band.low} to ${d.result.band.high} (${d.result.verdict.replace(/_/g, " ")}).`, "");
    for (const s of d.result.signals) out.push(`- ${s.label}: ${s.value} (${s.unit}). ${s.explanation}`);
    out.push("", `_${d.result.disclaimer}_`, "");
  } else out.push(sectionNote(d) ?? "", "");

  out.push("## Citations", "");
  const c = r.citations;
  if (c.status === "done") {
    const v = c.result.verification;
    if (v) {
      out.push(`${v.counts.verified} verified, ${v.counts.likely} probably right, ${v.counts.not_found} not found, ${v.counts.mismatch} DOI mismatches, ${v.counts.flagged} flagged.`, "");
      for (const ch of v.checks.filter((x) => x.status !== "verified" || x.flags.length)) {
        out.push(`- [${ch.index}] ${ch.status.replace(/_/g, " ")}${ch.flags.length ? ` (${ch.flags.join(", ")})` : ""}: ${ch.raw}`);
      }
      out.push("");
    } else if (c.result.verificationSkipped) out.push(c.result.verificationSkipped, "");
    for (const m of c.result.crossCheck.citedButMissing) out.push(`- In-text citation without an entry: ${m.citation.raw}`);
    if (c.result.claims.length) {
      out.push("", "Sentences that may need a citation:", "");
      for (const cl of c.result.claims) out.push(`- ${cl.text}`);
    }
    for (const s of c.result.suggestions) {
      out.push("", `Possible sources for: “${s.claim.text}”`, "");
      for (const sg of s.suggestions) out.push(`- ${formatReferenceText(sg.work, "apa")}`);
    }
    out.push("");
  } else out.push(sectionNote(c) ?? "", "");

  out.push("## Grammar and style", "");
  const g = r.grammar;
  if (g.status === "done") {
    out.push(`${g.result.summary.total} issues, ${g.result.summary.issuesPer1000Words} per 1,000 words. Readability: ${g.result.metrics.level}.`, "");
    for (const i of g.result.issues.slice(0, 60)) out.push(`- “${i.text}”: ${i.message}${i.suggestions[0] ? ` Suggestion: “${i.suggestions[0]}”.` : ""}`);
    out.push("");
  } else out.push(sectionNote(g) ?? "", "");

  for (const key of ["paraphrase", "humanise"] as const) {
    out.push(`## ${TOOL_NAMES[key]}`, "");
    const s = r[key];
    if (s.status === "done") {
      if (!s.result.length) out.push("None.", "");
      for (const sg of s.result) out.push(`${sg.reason}`, "", `> ${sg.result.original}`, "", `${sg.result.text}`, "");
      if (key === "humanise" && s.result[0]?.result.disclosure) out.push(`_${s.result[0].result.disclosure}_`, "");
    } else out.push(sectionNote(s) ?? "", "");
  }
  return out.join("\n");
}
