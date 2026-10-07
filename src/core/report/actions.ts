import { ISSUE_TEXT, reviewReport, type IssueKind } from "../plagiarism/review.ts";
import type { PaperReport, ToolId } from "./report.ts";

export type ActionLevel = "high" | "medium" | "low";

/** One thing the author should look at, ranked across all checks. */
export interface ActionItem {
  id: string;
  level: ActionLevel;
  tool: ToolId;
  title: string;
  detail: string;
  /** The passage concerned, when there is one. */
  quote?: string;
}

const RANK: Record<ActionLevel, number> = { high: 0, medium: 1, low: 2 };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Turns a report into a short, ordered to-do list: the findings most likely to matter to an editor come first.
 * Lists stay short; long tails are summarised in one item so the list remains readable.
 */
export function buildActionList(report: PaperReport, limitPerKind = 5): ActionItem[] {
  const out: ActionItem[] = [];
  const add = (a: ActionItem) => out.push(a);

  if (report.plagiarism.status === "done") {
    const p = report.plagiarism.result;
    const r = reviewReport(p);
    const byId = new Map(p.sources.map((s) => [s.id, s]));
    const from = (id: string | undefined) => {
      const src = id ? byId.get(id) : undefined;
      return src ? `“${clip(src.title, 80)}”` : "a published source";
    };
    const shown = new Map<IssueKind, number>();
    for (const i of r.issues) {
      if (i.kind === "reworded_cited" || i.kind === "repeated") continue;
      const n = shown.get(i.kind) ?? 0;
      shown.set(i.kind, n + 1);
      if (n >= limitPerKind) continue;
      const t = ISSUE_TEXT[i.kind];
      add({
        id: `plag-${i.kind}-${i.start}`,
        level: i.kind === "copied_uncited" || i.kind === "disguised" || i.kind === "tortured" ? "high" : i.kind === "copied_cited" ? (i.words >= 15 ? "high" : "medium") : "medium",
        tool: "plagiarism",
        title:
          i.kind === "quote_uncited"
            ? t.title
            : i.kind === "disguised" || i.kind === "tortured"
              ? `${t.title}${i.kind === "tortured" ? `: “${i.text}”. ${i.note ?? ""}` : ""}`
            : `${t.title}: ${i.kind.startsWith("copied") ? `${i.words} words match` : "closely follows"} ${from(i.sourceId)}`,
        detail: t.fix,
        quote: clip(i.text),
      });
    }
    const extra = [...shown.values()].reduce((n, c) => n + Math.max(0, c - limitPerKind), 0);
    if (extra > 0) {
      add({ id: "plag-more", level: "medium", tool: "plagiarism", title: `${plural(extra, "more passage")} to fix`, detail: "See the Similarity tab for every finding and its source." });
    }
  }

  if (report.citations.status === "done") {
    const c = report.citations.result;
    for (const ch of c.verification?.checks ?? []) {
      const label = `Reference ${ch.index}`;
      const retracted = ch.flags.find((f) => f === "retracted" || f === "withdrawn" || f === "removed");
      if (retracted) {
        add({ id: `ref-flag-${ch.index}`, level: "high", tool: "citations", title: `${label} has been ${retracted}`, detail: "Remove it or explain why you still cite it.", quote: clip(ch.raw) });
      } else if (ch.flags.includes("expression_of_concern")) {
        add({ id: `ref-flag-${ch.index}`, level: "medium", tool: "citations", title: `${label} carries an expression of concern`, detail: "Check the publisher's notice before relying on it.", quote: clip(ch.raw) });
      }
      if (ch.status === "mismatch") {
        add({ id: `ref-mis-${ch.index}`, level: "high", tool: "citations", title: `${label}: the DOI points to a different paper`, detail: "Correct the DOI or the details so they describe the same work.", quote: clip(ch.raw) });
      } else if (ch.status === "likely" && ch.discrepancies.length) {
        const fields = [...new Set(ch.discrepancies.map((d) => d.field))].join(", ");
        add({ id: `ref-disc-${ch.index}`, level: "low", tool: "citations", title: `${label}: details differ from the published record (${fields})`, detail: "Compare the entry with the record shown in the Citations tab.", quote: clip(ch.raw) });
      } else if (ch.status === "not_found") {
        add({
          id: `ref-nf-${ch.index}`,
          level: "medium",
          tool: "citations",
          title: `${label} was not found in scholarly databases`,
          detail: "Books, reports and web pages are often missing, but check that the details are right and the work exists.",
          quote: clip(ch.raw),
        });
      }
    }
    for (const m of c.crossCheck.citedButMissing.slice(0, limitPerKind)) {
      add({ id: `cite-miss-${m.citation.start}`, level: "high", tool: "citations", title: `In-text citation ${m.citation.raw} has no reference entry`, detail: m.reason });
    }
    if (c.crossCheck.uncitedReferences.length) {
      add({
        id: "cite-uncited",
        level: "low",
        tool: "citations",
        title: `${plural(c.crossCheck.uncitedReferences.length, "reference")} never cited in the text`,
        detail: `Entries ${c.crossCheck.uncitedReferences.map((r) => r.index).slice(0, 12).join(", ")}${c.crossCheck.uncitedReferences.length > 12 ? "…" : ""}. Cite them or remove them.`,
      });
    }
    for (const cl of c.claims.slice(0, 3)) {
      add({ id: `claim-${cl.start}`, level: "low", tool: "citations", title: "Claim that may need a citation", detail: cl.reasons.join("; "), quote: clip(cl.text) });
    }
  }

  if (report.detector.status === "done") {
    const d = report.detector.result;
    const high = d.sentences.filter((s) => s.level === "high").length;
    if (d.verdict === "likely_ai" || d.verdict === "uncertain") {
      add({
        id: "ai",
        level: d.verdict === "likely_ai" ? "medium" : "low",
        tool: "detector",
        title: d.verdict === "likely_ai" ? `Writing shows many patterns typical of AI text (score ${d.score})` : `Some patterns typical of AI text (score ${d.score})`,
        detail: `${plural(high, "sentence")} use stock phrases or formulaic openers. Revise them in your own voice; see the Rewrites tab for suggestions.`,
      });
    }
    if (d.evasion.homoglyphs + d.evasion.invisible > 0) {
      add({ id: "ai-hidden", level: "medium", tool: "detector", title: "Hidden or lookalike characters found", detail: "Clean them out; editors' tools flag them as an attempt to hide text." });
    }
  }

  if (report.grammar.status === "done") {
    const g = report.grammar.result;
    const errors = g.issues.filter((i) => i.severity === "error");
    for (const i of errors.slice(0, limitPerKind)) {
      const fix = i.suggestions[0];
      add({
        id: `gram-${i.id}`,
        level: "medium",
        tool: "grammar",
        title: i.message,
        detail: fix === undefined ? "See the Grammar tab." : fix === "" ? "Suggested fix: delete it." : `Suggested fix: “${fix}”.`,
        quote: clip(i.text, 80),
      });
    }
    const rest = g.issues.length - Math.min(errors.length, limitPerKind);
    if (rest > 0) {
      add({ id: "gram-more", level: "low", tool: "grammar", title: `${plural(rest, "more writing suggestion")}`, detail: "Style, clarity and punctuation notes are listed in the Grammar tab." });
    }
  }

  return out.map((a, i) => ({ a, i })).sort((x, y) => RANK[x.a.level] - RANK[y.a.level] || x.i - y.i).map((x) => x.a);
}

export interface DocumentStats {
  words: number;
  sentences?: number;
  paragraphs: number;
  references: number;
  readingMinutes: number;
  readingLevel?: string;
}

export function documentStats(report: PaperReport, text: string): DocumentStats {
  const g = report.grammar.status === "done" ? report.grammar.result.metrics : undefined;
  return {
    words: report.words,
    ...(g ? { sentences: g.sentences, readingLevel: g.level } : {}),
    paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim()).length,
    references: report.citations.status === "done" ? report.citations.result.references.length : 0,
    readingMinutes: Math.max(1, Math.round(report.words / 230)),
  };
}
