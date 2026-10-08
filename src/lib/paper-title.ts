/**
 * The paper's title: its first block of text, joined when it wraps onto a second or third line. Null when the
 * opening reads as a sentence rather than a title.
 */
export function paperTitle(text: string): string | null {
  const block = text.trim().split(/\n\s*\n/)[0] ?? "";
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines[0] ?? "";
  const joined = lines.length <= 3 ? lines.join(" ").replace(/\s+/g, " ") : first;
  for (const t of [joined, first])
    if (t.length > 3 && t.length <= 200 && !/[.!?]$/.test(t)) return t;
  return null;
}
