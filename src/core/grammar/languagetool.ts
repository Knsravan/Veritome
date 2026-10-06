import type { Http } from "../infra/http.ts";
import { chunkBySentences } from "../text/chunk.ts";
import type { Issue, IssueCategory, Severity } from "./types.ts";

export interface LanguageToolOptions {
  /** Base URL of a LanguageTool server, e.g. http://localhost:8010 or https://api.languagetool.org */
  url: string;
  http: Http;
  language?: string;
  /** Enables the extra "picky" rules. */
  picky?: boolean;
  disabledRules?: readonly string[];
  /** Largest request body in characters. The public server allows 20,000. */
  maxChunkChars?: number;
  signal?: AbortSignal;
}

interface LtMatch {
  message: string;
  shortMessage?: string;
  offset: number;
  length: number;
  replacements?: Array<{ value: string }>;
  rule: {
    id: string;
    description?: string;
    issueType?: string;
    category?: { id?: string; name?: string };
  };
}

interface LtResponse {
  matches?: LtMatch[];
}

function mapCategory(match: LtMatch): IssueCategory {
  const id = match.rule.category?.id ?? "";
  const type = match.rule.issueType ?? "";
  if (id === "TYPOS" || type === "misspelling") return "spelling";
  if (id === "PUNCTUATION" || id === "TYPOGRAPHY" || id === "CASING" || type === "typographical" || type === "whitespace") {
    return "punctuation";
  }
  if (id === "REDUNDANCY" || id === "PLAIN_ENGLISH" || id === "WORDINESS") return "clarity";
  if (id === "STYLE" || id === "COLLOQUIALISMS" || type === "style" || type === "register") return "style";
  if (id === "NONSTANDARD_PHRASES" || id === "SEMANTICS") return "clarity";
  return "grammar";
}

function mapSeverity(match: LtMatch, category: IssueCategory): Severity {
  const type = match.rule.issueType ?? "";
  if (category === "spelling" || type === "grammar" || type === "misspelling") return "error";
  if (category === "style" || category === "clarity" || type === "style" || type === "register") return "info";
  return "warning";
}

export function mapLanguageToolMatches(matches: readonly LtMatch[], baseOffset: number, text: string): Issue[] {
  const out: Issue[] = [];
  for (const m of matches) {
    const start = baseOffset + m.offset;
    const end = start + m.length;
    if (m.length <= 0 || end > text.length) continue;
    const category = mapCategory(m);
    out.push({
      id: `lt-${m.rule.id}:${start}-${end}`,
      rule: `lt:${m.rule.id}`,
      category,
      severity: mapSeverity(m, category),
      message: m.message,
      start,
      end,
      text: text.slice(start, end),
      suggestions: (m.replacements ?? []).slice(0, 5).map((r) => r.value),
      source: "languagetool",
    });
  }
  return out;
}

export interface LanguageToolResult {
  issues: Issue[];
  /** Set when some chunks could not be checked. */
  warning?: string;
}

/** Checks text with a LanguageTool server, splitting long documents into sentence-aligned chunks. */
export async function checkWithLanguageTool(text: string, options: LanguageToolOptions): Promise<LanguageToolResult> {
  const endpoint = `${options.url.replace(/\/+$/, "")}/v2/check`;
  const chunks = chunkBySentences(text, options.maxChunkChars ?? 15_000);
  const issues: Issue[] = [];
  let failed = 0;
  let lastError = "";

  for (const chunk of chunks) {
    const form = new URLSearchParams({
      text: chunk.text,
      language: options.language ?? "en-US",
      ...(options.picky ? { level: "picky" } : {}),
      ...(options.disabledRules?.length ? { disabledRules: options.disabledRules.join(",") } : {}),
    });
    try {
      const data = await options.http.json<LtResponse>(endpoint, {
        method: "POST",
        body: form.toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        ...(options.signal ? { signal: options.signal } : {}),
      });
      issues.push(...mapLanguageToolMatches(data.matches ?? [], chunk.start, text));
    } catch (err) {
      failed++;
      lastError = err instanceof Error ? err.message : "unknown error";
    }
  }

  if (failed === 0) return { issues };
  return {
    issues,
    warning:
      failed === chunks.length
        ? `LanguageTool could not be reached (${lastError}). Only the built-in rules were used.`
        : `LanguageTool failed for ${failed} of ${chunks.length} sections (${lastError}).`,
  };
}
