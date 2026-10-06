import { clamp, round } from "../text/stats.ts";
import { checkWithLanguageTool, type LanguageToolOptions } from "./languagetool.ts";
import { computeReadability } from "./readability.ts";
import { ALL_RULES, buildContext } from "./rules.ts";
import type { GrammarOptions, GrammarResult, GrammarSummary, Issue, IssueCategory, Severity } from "./types.ts";

export interface GrammarCheckOptions extends GrammarOptions {
  languageTool?: LanguageToolOptions;
}

export type GrammarCheckResult = GrammarResult & { warnings: string[] };

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

function summarise(issues: readonly Issue[], words: number): GrammarSummary {
  const byCategory: Partial<Record<IssueCategory, number>> = {};
  const bySeverity: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const i of issues) {
    byCategory[i.category] = (byCategory[i.category] ?? 0) + 1;
    bySeverity[i.severity]++;
  }
  const per1000 = (n: number) => n / (Math.max(words, 100) / 1000);
  const weighted = per1000(bySeverity.error) * 5 + per1000(bySeverity.warning) * 2 + per1000(bySeverity.info) * 0.4;
  return {
    total: issues.length,
    byCategory,
    bySeverity,
    issuesPer1000Words: round(per1000(issues.length), 1),
    score: Math.round(clamp(100 - weighted * 0.6, 0, 100)),
  };
}

/** Runs only the built-in rules. Synchronous and fully offline. */
export function checkGrammarLocal(text: string, options: GrammarOptions = {}): GrammarResult {
  const ctx = buildContext(text, options);
  const disabled = new Set(options.disabledRules ?? []);
  const seen = new Set<string>();
  const issues: Issue[] = [];
  for (const [id, rule] of Object.entries(ALL_RULES)) {
    if (disabled.has(id)) continue;
    for (const issue of rule(ctx)) {
      const key = `${issue.rule}|${issue.start}|${issue.end}`;
      if (seen.has(key) || disabled.has(issue.rule)) continue;
      seen.add(key);
      issues.push(issue);
    }
  }
  issues.sort((a, b) => a.start - b.start || a.end - b.end || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const metrics = computeReadability(ctx);
  return { issues, metrics, summary: summarise(issues, metrics.words) };
}

const OVERLAP_CATEGORIES: ReadonlySet<IssueCategory> = new Set(["spelling", "grammar", "punctuation"]);

function overlaps(a: Issue, b: Issue): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Drops built-in findings that LanguageTool already reports on the same span. */
export function mergeIssues(local: readonly Issue[], remote: readonly Issue[]): Issue[] {
  const keptLocal = local.filter(
    (l) => !(OVERLAP_CATEGORIES.has(l.category) && remote.some((r) => OVERLAP_CATEGORIES.has(r.category) && overlaps(l, r))),
  );
  return [...keptLocal, ...remote].sort(
    (a, b) => a.start - b.start || a.end - b.end || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

/** Built-in rules, plus LanguageTool when configured. Never throws because of LanguageTool being down. */
export async function checkGrammar(text: string, options: GrammarCheckOptions = {}): Promise<GrammarCheckResult> {
  const local = checkGrammarLocal(text, options);
  if (!options.languageTool) return { ...local, warnings: [] };

  const remote = await checkWithLanguageTool(text, options.languageTool);
  const disabled = new Set(options.disabledRules ?? []);
  const remoteIssues = remote.issues.filter((i) => !disabled.has(i.rule));
  const issues = mergeIssues(local.issues, remoteIssues);
  return {
    issues,
    metrics: local.metrics,
    summary: summarise(issues, local.metrics.words),
    warnings: remote.warning ? [remote.warning] : [],
  };
}

export interface Fix {
  start: number;
  end: number;
  replacement: string;
}

export interface ApplyResult {
  text: string;
  applied: number;
  skipped: number;
}

/** Applies non-overlapping fixes. Earlier fixes win when two overlap. */
export function applyFixes(text: string, fixes: readonly Fix[]): ApplyResult {
  const sorted = [...fixes].sort((a, b) => a.start - b.start || a.end - b.end);
  const accepted: Fix[] = [];
  let lastEnd = -1;
  let skipped = 0;
  for (const f of sorted) {
    if (f.start < lastEnd || f.start < 0 || f.end > text.length || f.end < f.start) {
      skipped++;
      continue;
    }
    accepted.push(f);
    lastEnd = f.end;
  }
  let out = "";
  let cursor = 0;
  for (const f of accepted) {
    out += text.slice(cursor, f.start) + f.replacement;
    cursor = f.end;
  }
  out += text.slice(cursor);
  return { text: out, applied: accepted.length, skipped };
}
