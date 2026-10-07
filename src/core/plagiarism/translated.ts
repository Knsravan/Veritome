import { mapLimit } from "../infra/http.ts";
import { splitSentences } from "../text/sentences.ts";
import { tokenize } from "../text/tokens.ts";
import { buildBodyIndex, findRuns } from "./match.ts";
import { findParaphrases } from "./paraphrase.ts";
import { selectPassages } from "./passages.ts";
import type { SourceDoc, SourceProvider } from "./providers.ts";

/** A sentence of the paper that is a translation of a sentence in an English source. */
export interface TranslatedMatch {
  start: number;
  end: number;
  text: string;
  /** The sentence in English, as translated for the check. */
  english: string;
  sourceId: string;
  sourceText: string;
  /** 0 to 1: how closely the translation matches the source sentence. */
  similarity: number;
  cited: boolean;
}

export type Translator = (sentences: string[], language: string, signal?: AbortSignal) => Promise<string[]>;

/**
 * Finds text translated from English sources: the paper's sentences are translated into English, the English
 * version is searched like any paper, and each source found is compared with the translation sentence by
 * sentence. Matches point back to the original sentences.
 */
export async function findTranslatedCopies(
  body: string,
  language: string,
  deps: { translate: Translator; providers: SourceProvider[]; signal?: AbortSignal; maxSentences?: number; maxPassages?: number; cited: (start: number, end: number) => boolean },
): Promise<{ matches: TranslatedMatch[]; docs: SourceDoc[]; translatedSentences: number }> {
  const sentences = splitSentences(body)
    .filter((s) => /\p{L}{2}/u.test(s.text))
    .slice(0, deps.maxSentences ?? 300);
  if (!sentences.length) return { matches: [], docs: [], translatedSentences: 0 };
  const english: string[] = [];
  for (let i = 0; i < sentences.length; i += 25) {
    if (deps.signal?.aborted) break;
    const batch = sentences.slice(i, i + 25).map((s) => s.text.replace(/\s+/g, " ").trim());
    const out = await deps.translate(batch, language, deps.signal).catch(() => [] as string[]);
    for (let k = 0; k < batch.length; k++) english.push((out[k] ?? "").trim());
  }
  // The English "shadow" text, with each sentence's place in it.
  let shadow = "";
  const map: Array<{ from: number; to: number; orig: (typeof sentences)[number]; en: string }> = [];
  english.forEach((en, i) => {
    if (!en) return;
    const from = shadow.length;
    shadow += `${en} `;
    map.push({ from, to: from + en.length, orig: sentences[i]!, en });
  });
  if (!shadow.trim()) return { matches: [], docs: [], translatedSentences: 0 };

  const docs = new Map<string, SourceDoc>();
  const passages = selectPassages(shadow, deps.maxPassages ?? 20);
  const jobs = passages.flatMap((p) => deps.providers.map((provider) => ({ p, provider })));
  await mapLimit(jobs, 6, async ({ p, provider }) => {
    if (deps.signal?.aborted) return;
    try {
      for (const d of await provider.search(p, deps.signal)) if (d.text.trim() && !docs.has(d.id) && docs.size < 200) docs.set(d.id, d);
    } catch {
      // A failed search only narrows the check.
    }
  });

  const best = new Map<number, { sourceId: string; sourceText: string; similarity: number }>();
  const at = (pos: number) => map.findIndex((m) => pos >= m.from && pos < m.to);
  const consider = (i: number, m: { sourceId: string; sourceText: string; similarity: number }) => {
    if (i < 0) return;
    const prev = best.get(i);
    if (!prev || m.similarity > prev.similarity) best.set(i, m);
  };
  // Word-for-word runs in the translation (a close machine translation of the source).
  const tokens = tokenize(shadow);
  const index = buildBodyIndex(tokens);
  for (const d of docs.values()) {
    const srcTokens = tokenize(d.text);
    for (const r of findRuns(index, srcTokens.map((t) => t.word), { minRun: 6 })) {
      if (r.end - r.start < 6) continue;
      const a = srcTokens[r.sourceStart]?.start ?? 0;
      const b = srcTokens[Math.min(srcTokens.length - 1, r.sourceStart + (r.end - r.start) - 1)]?.end ?? a;
      const sourceText = d.text.slice(a, b).replace(/\s+/g, " ");
      for (let t = r.start; t < r.end; t++) consider(at(tokens[t]!.start), { sourceId: d.id, sourceText, similarity: 1 });
    }
  }
  // Freer translations: sentence-level concept overlap, as for reworded text.
  for (const pm of findParaphrases(shadow, [...docs.values()].map((d) => ({ id: d.id, text: d.text })), { threshold: 0.6 }))
    consider(at(pm.start), { sourceId: pm.sourceId, sourceText: pm.sourceText, similarity: pm.similarity });

  const matches: TranslatedMatch[] = [...best.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([i, m]) => {
      const s = map[i]!;
      return { start: s.orig.start, end: s.orig.end, text: s.orig.text.replace(/\s+/g, " "), english: s.en, ...m, similarity: Math.round(m.similarity * 100) / 100, cited: deps.cited(s.orig.start, s.orig.end) };
    });
  const used = new Set(matches.map((m) => m.sourceId));
  return { matches, docs: [...docs.values()].filter((d) => used.has(d.id)), translatedSentences: map.length };
}

const TRANSLATE_SYSTEM = `You translate academic text into English, faithfully and literally, one sentence at a time.
Keep technical terms, numbers and citations as they are. Do not add, explain or summarise.
Reply with a JSON object only: {"translations": [one English string per input sentence, in the same order]}.`;

/** A translator backed by the configured language model. */
export function llmTranslator(llm: import("../llm/client.ts").LlmClient): Translator {
  return async (sentences, language, signal) => {
    const { extractJson } = await import("../llm/client.ts");
    const reply = await llm.chat({
      system: TRANSLATE_SYSTEM,
      user: `Language: ${language}\nSentences (JSON array):\n${JSON.stringify(sentences)}`,
      temperature: 0,
      maxTokens: 6000,
      json: true,
      ...(signal ? { signal } : {}),
    });
    const parsed = extractJson<{ translations?: unknown }>(reply);
    const list = Array.isArray(parsed?.translations) ? parsed.translations : [];
    return sentences.map((_, i) => (typeof list[i] === "string" ? (list[i] as string) : ""));
  };
}
