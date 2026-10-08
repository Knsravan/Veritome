import { splitSentences } from "./sentences.ts";
import { countWords } from "./tokens.ts";

/**
 * Breaks long unbroken text into paragraphs of about `target` words at sentence ends. Text pasted from a PDF or a
 * web page often loses its paragraph breaks, and the AI detector reads a paper paragraph by paragraph: one huge
 * block hides the paper-wide pattern. Blocks that already look like paragraphs are left alone.
 */
export function reflowParagraphs(text: string, { longest = 250, target = 140 } = {}): string {
  return text
    .split(/\n[ \t]*\n/)
    .map((block) => {
      if (countWords(block) <= longest) return block;
      const out: string[] = [];
      let cur = "";
      for (const s of splitSentences(block)) {
        const piece = block.slice(s.start, s.end).trim();
        cur = cur ? `${cur} ${piece}` : piece;
        if (countWords(cur) >= target) {
          out.push(cur);
          cur = "";
        }
      }
      if (cur) {
        if (out.length && countWords(cur) < target / 3) out[out.length - 1] += ` ${cur}`;
        else out.push(cur);
      }
      return out.join("\n\n");
    })
    .join("\n\n");
}
