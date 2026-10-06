export type DiffOp = { type: "same" | "add" | "del"; text: string };

const TOKEN_RE = /\s+|[\p{L}\p{N}'’\-]+|[^\s\p{L}\p{N}]/gu;

function tokens(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

function push(out: DiffOp[], type: DiffOp["type"], text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.type === type) last.text += text;
  else out.push({ type, text });
}

/**
 * Word-level diff (longest common subsequence). Falls back to "delete all,
 * add all" above `maxCells` to keep memory bounded on very long inputs.
 */
export function diffWords(a: string, b: string, maxCells = 4_000_000): DiffOp[] {
  const x = tokens(a);
  const y = tokens(b);
  const out: DiffOp[] = [];
  // Trim the common prefix and suffix first; it is cheap and usually most of the text.
  let pre = 0;
  while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++;
  let suf = 0;
  while (suf < x.length - pre && suf < y.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++;
  push(out, "same", x.slice(0, pre).join(""));
  const xs = x.slice(pre, x.length - suf);
  const ys = y.slice(pre, y.length - suf);
  const n = xs.length;
  const m = ys.length;
  if (n * m > maxCells) {
    push(out, "del", xs.join(""));
    push(out, "add", ys.join(""));
  } else {
    const w = m + 1;
    const table = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * w + j] = xs[i] === ys[j] ? table[(i + 1) * w + j + 1]! + 1 : Math.max(table[(i + 1) * w + j]!, table[i * w + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (xs[i] === ys[j]) {
        push(out, "same", xs[i]!);
        i++;
        j++;
      } else if (table[(i + 1) * w + j]! >= table[i * w + j + 1]!) push(out, "del", xs[i++]!);
      else push(out, "add", ys[j++]!);
    }
    while (i < n) push(out, "del", xs[i++]!);
    while (j < m) push(out, "add", ys[j++]!);
  }
  push(out, "same", x.slice(x.length - suf).join(""));
  return out;
}

/** Share of the original's words that were changed or removed, 0 to 1. */
export function changedShare(ops: readonly DiffOp[]): number {
  let same = 0;
  let removed = 0;
  const words = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  for (const op of ops) {
    if (op.type === "same") same += words(op.text);
    else if (op.type === "del") removed += words(op.text);
  }
  return same + removed === 0 ? 0 : removed / (same + removed);
}
