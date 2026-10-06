import { splitSentences, type Span } from "./sentences.ts";

export interface Chunk extends Span {
  text: string;
}

/**
 * Splits text into chunks of at most `maxChars` characters without cutting a
 * sentence in half (a single over-long sentence becomes its own chunk). Offsets
 * refer to the original string and the gaps between chunks are whitespace only.
 */
export function chunkBySentences(text: string, maxChars: number): Chunk[] {
  const sentences = splitSentences(text);
  const chunks: Chunk[] = [];
  let startIdx = -1;
  let endIdx = -1;

  const flush = () => {
    if (startIdx >= 0) chunks.push({ start: startIdx, end: endIdx, text: text.slice(startIdx, endIdx) });
    startIdx = -1;
    endIdx = -1;
  };

  for (const s of sentences) {
    if (startIdx < 0) {
      startIdx = s.start;
      endIdx = s.end;
      continue;
    }
    if (s.end - startIdx > maxChars) {
      flush();
      startIdx = s.start;
      endIdx = s.end;
    } else {
      endIdx = s.end;
    }
  }
  flush();
  return chunks;
}
