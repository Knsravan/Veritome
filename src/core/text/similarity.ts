import { normalizeWord, STOPWORDS } from "./tokens.ts";

/** Lower-cases, strips accents and punctuation, and collapses whitespace. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleTokens(title: string): string[] {
  return normalizeTitle(title).split(" ").filter(Boolean);
}

/** Sørensen–Dice coefficient over token multisets (0 to 1). */
export function dice(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const t of a) counts.set(t, (counts.get(t) ?? 0) + 1);
  let overlap = 0;
  for (const t of b) {
    const c = counts.get(t) ?? 0;
    if (c > 0) {
      overlap++;
      counts.set(t, c - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length);
}

/**
 * How alike two titles are, tolerant of subtitles and punctuation. Returns at
 * least 0.9 when the shorter title is fully contained in the longer one.
 */
export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const base = dice(ta, tb);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length >= 4) {
    const longSet = new Set(long);
    const contained = short.filter((t) => longSet.has(t)).length / short.length;
    if (contained >= 0.95) return Math.max(base, 0.9);
  }
  return base;
}

/** Share of the title's tokens that appear in a longer free-text string such as a raw reference. */
export function titleContainedIn(title: string, haystack: string): number {
  const tokens = titleTokens(title);
  if (tokens.length === 0) return 0;
  const hay = new Set(titleTokens(haystack));
  return tokens.filter((t) => hay.has(t)).length / tokens.length;
}

/** Cheap suffix stripping so "studies", "studied" and "study" compare equal. */
export function stem(word: string): string {
  const w = normalizeWord(word);
  if (w.length <= 3) return w;
  return w
    .replace(/(?:ies)$/, "y")
    .replace(/(?:ing|edly|ed|es|s)$/, "")
    .replace(/(.)\1$/, "$1");
}

export function contentStems(text: string): string[] {
  return titleTokens(text)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map(stem);
}
