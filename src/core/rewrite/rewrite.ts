import { detectAiText } from "../detector/detect.ts";
import type { DetectorResult } from "../detector/types.ts";
import { mapLimit } from "../infra/http.ts";
import type { LlmClient } from "../llm/client.ts";
import { chunkBySentences } from "../text/chunk.ts";
import { changedShare, diffWords } from "../text/diff.ts";
import { checkNumbersPreserved, protect, restore, type ProtectedSpan } from "../text/protect.ts";
import { splitParagraphs } from "../text/sentences.ts";
import { countWords } from "../text/tokens.ts";
import { cleanReply, LENGTH_BOUNDS, systemPrompt, userPrompt } from "./prompts.ts";
import { ruleRewrite } from "./rules.ts";
import type { DetectorSnapshot, RewriteChunk, RewriteMode, RewriteResult } from "./types.ts";

export const HUMANISER_DISCLOSURE =
  "Rewriting text so that it scores lower on AI detectors does not change who or what wrote it. " +
  "Most journals, funders and universities require you to disclose substantive use of AI tools, and using a " +
  "humaniser to hide undisclosed AI use may count as misconduct. Use this tool to improve your own prose, and " +
  "disclose AI assistance where your publisher's policy asks for it, for example: “The authors used a language " +
  "model to improve the readability of parts of this manuscript and take full responsibility for its content.”";

export interface RewriteOptions {
  mode: RewriteMode;
  llm?: LlmClient;
  /** Extra attempts after the first when a check fails. Default 2. */
  retries?: number;
  /** Largest passage sent in one request, in characters. Default 2500. */
  maxChunkChars?: number;
  concurrency?: number;
  signal?: AbortSignal;
}

interface Piece {
  start: number;
  end: number;
}

/** Splits masked text into paragraph-aligned pieces small enough for one request. */
export function planChunks(masked: string, maxChars: number): Piece[] {
  const pieces: Piece[] = [];
  for (const p of splitParagraphs(masked)) {
    if (p.end - p.start <= maxChars) pieces.push({ start: p.start, end: p.end });
    else for (const c of chunkBySentences(p.text, maxChars)) pieces.push({ start: p.start + c.start, end: p.start + c.end });
  }
  return pieces;
}

const PLACEHOLDER_ID = /\{\{P(\d+)\}\}/g;

/** Checks one rewritten piece. Returns the restored text, or the reasons it was rejected. */
export function validatePiece(
  maskedPiece: string,
  output: string,
  spans: readonly ProtectedSpan[],
  mode: RewriteMode,
): { ok: true; text: string } | { ok: false; problems: string[] } {
  const ids = new Set([...maskedPiece.matchAll(PLACEHOLDER_ID)].map((m) => Number(m[1])));
  const local = spans.filter((s) => ids.has(s.id));
  const problems: string[] = [];
  const restored = restore(output, local);
  const original = restore(maskedPiece, local).text;
  if (restored.missing.length) problems.push(`placeholders ${restored.missing.map((i) => `{{P${i}}}`).join(", ")} are missing`);
  if (restored.duplicated.length) problems.push(`placeholders ${restored.duplicated.map((i) => `{{P${i}}}`).join(", ")} appear more than once`);
  if (restored.unknown.length) problems.push(`placeholders ${restored.unknown.map((i) => `{{P${i}}}`).join(", ")} were invented`);
  // Numbers are compared outside the protected spans, which are restored verbatim anyway.
  const numbers = checkNumbersPreserved(maskedPiece.replace(PLACEHOLDER_ID, " "), output.replace(/\{\{\s*P\d+\s*\}\}/g, " "));
  if (numbers.missing.length) problems.push(`the number(s) ${numbers.missing.join(", ")} were dropped or changed`);
  if (numbers.added.length) problems.push(`the number(s) ${numbers.added.join(", ")} were added`);
  const inWords = countWords(original);
  const ratio = inWords === 0 ? 1 : countWords(restored.text) / inWords;
  const [lo, hi] = LENGTH_BOUNDS[mode];
  if (inWords >= 12 && (ratio < lo || ratio > hi)) problems.push(`the length changed too much (${Math.round(ratio * 100)}% of the original)`);
  if (output.trim() === "") problems.push("the reply was empty");
  return problems.length ? { ok: false, problems } : { ok: true, text: restored.text };
}

function snapshot(r: DetectorResult): DetectorSnapshot {
  return { score: r.score, band: r.band, verdict: r.verdict };
}

/** Paraphrases or humanises text, keeping citations, maths, URLs and numbers intact. */
export async function rewriteText(text: string, options: RewriteOptions): Promise<RewriteResult> {
  const { mode } = options;
  const { masked, spans } = protect(text);
  const pieces = planChunks(masked, options.maxChunkChars ?? 2500);
  const warnings: string[] = [];
  const retries = Math.max(0, options.retries ?? 2);

  const chunks: RewriteChunk[] = await mapLimit(pieces, options.concurrency ?? 3, async (piece) => {
    const maskedPiece = masked.slice(piece.start, piece.end);
    const original = restore(maskedPiece, spans).text;
    if (!options.llm) {
      const r = ruleRewrite(maskedPiece, mode);
      const checked = validatePiece(maskedPiece, r.text, spans, mode);
      return checked.ok
        ? { original, rewritten: checked.text, status: "rules", attempts: 1, problems: [] }
        : { original, rewritten: original, status: "kept_original", attempts: 1, problems: checked.problems };
    }
    const feedback: string[] = [];
    const problems: string[] = [];
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      if (options.signal?.aborted) break;
      let reply: string;
      try {
        reply = await options.llm.chat({
          system: systemPrompt(mode),
          user: userPrompt(maskedPiece, feedback),
          temperature: attempt === 1 ? 0.7 : 0.3,
          ...(options.signal ? { signal: options.signal } : {}),
        });
      } catch (err) {
        problems.push(`attempt ${attempt}: ${err instanceof Error ? err.message : "the model call failed"}`);
        break;
      }
      const checked = validatePiece(maskedPiece, cleanReply(reply), spans, mode);
      if (checked.ok) return { original, rewritten: checked.text, status: "rewritten", attempts: attempt, problems };
      problems.push(`attempt ${attempt}: ${checked.problems.join("; ")}`);
      feedback.splice(0, feedback.length, ...checked.problems);
    }
    return { original, rewritten: original, status: "kept_original", attempts: problems.length, problems };
  });

  // Reassemble with the original whitespace between pieces.
  let out = "";
  let cursor = 0;
  pieces.forEach((piece, i) => {
    out += restore(masked.slice(cursor, piece.start), spans).text + (chunks[i] as RewriteChunk).rewritten;
    cursor = piece.end;
  });
  out += restore(masked.slice(cursor), spans).text;

  const kept = chunks.filter((c) => c.status === "kept_original").length;
  if (!options.llm) {
    warnings.push(
      mode === "expand"
        ? "Expanding text needs a language model, and none is configured, so the text is unchanged."
        : "No language model is configured, so only light rule-based edits were made. This is not a full paraphrase.",
    );
  }
  if (kept) warnings.push(`${kept} of ${chunks.length} passage${chunks.length === 1 ? "" : "s"} kept the original wording because every rewrite failed a safety check.`);
  if (spans.length) warnings.push(`${spans.length} citation${spans.length === 1 ? "" : "s"}, formula${spans.length === 1 ? "" : "s"} or link${spans.length === 1 ? "" : "s"} were locked and restored unchanged.`);

  const [before, after] = await Promise.all([detectAiText(text), detectAiText(out)]);
  return {
    mode,
    method: options.llm ? "llm" : "rules",
    ...(options.llm ? { model: options.llm.model } : {}),
    original: text,
    text: out,
    chunks,
    protectedCount: spans.length,
    changed: Math.round(changedShare(diffWords(text, out)) * 100) / 100,
    detector: { before: snapshot(before), after: snapshot(after) },
    warnings,
    ...(mode === "humanise" ? { disclosure: HUMANISER_DISCLOSURE } : {}),
  };
}
