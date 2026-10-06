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
