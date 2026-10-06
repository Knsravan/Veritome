export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

/** Coefficient of variation; 0 when the mean is 0. */
export function cv(xs: readonly number[]): number {
  const m = mean(xs);
  return m === 0 ? 0 : stdev(xs) / m;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Shannon entropy (bits) of a frequency table. */
export function entropy(counts: Iterable<number>): number {
  let total = 0;
  const arr: number[] = [];
  for (const c of counts) {
    arr.push(c);
    total += c;
  }
  if (total === 0) return 0;
  let h = 0;
  for (const c of arr) {
    if (c === 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

export function round(x: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/**
 * Moving-average type-token ratio: lexical diversity that does not collapse as
 * texts get longer. Falls back to plain TTR for short inputs.
 */
export function mattr(words: readonly string[], window = 50): number {
  if (words.length === 0) return 0;
  if (words.length <= window) return new Set(words).size / words.length;
  const counts = new Map<string, number>();
  let distinct = 0;
  let sum = 0;
  let windows = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string;
    const c = counts.get(w) ?? 0;
    if (c === 0) distinct++;
    counts.set(w, c + 1);
    if (i >= window) {
      const old = words[i - window] as string;
      const oc = (counts.get(old) ?? 1) - 1;
      counts.set(old, oc);
      if (oc === 0) distinct--;
    }
    if (i >= window - 1) {
      sum += distinct / window;
      windows++;
    }
  }
  return windows === 0 ? 0 : sum / windows;
}
