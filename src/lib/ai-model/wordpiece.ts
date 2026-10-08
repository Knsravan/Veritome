/**
 * The BERT "uncased" WordPiece tokenizer used by the neural AI-writing model, so the browser can turn text into
 * token ids without a large library. Matches Hugging Face's BertTokenizer (lowercase, strip accents, split on
 * punctuation, greedy longest-match subwords).
 */
export interface WordPiece {
  encode(text: string, maxLength: number): number[];
}

const isPunct = (ch: string) => {
  const c = ch.codePointAt(0)!;
  if ((c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126)) return true;
  return /\p{P}/u.test(ch);
};
const isCjk = (c: number) =>
  (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x20000 && c <= 0x2a6df) || (c >= 0x2a700 && c <= 0x2b73f) ||
  (c >= 0x2b740 && c <= 0x2b81f) || (c >= 0x2b820 && c <= 0x2ceaf) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0x2f800 && c <= 0x2fa1f);

/** Lowercases, strips accents and control characters, and splits into words and punctuation marks. */
export function basicTokens(text: string): string[] {
  let clean = "";
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c === 0 || c === 0xfffd) continue;
    if (/\s/u.test(ch)) clean += " ";
    else if (/\p{Cc}|\p{Cf}/u.test(ch)) continue;
    else if (isCjk(c)) clean += ` ${ch} `;
    else clean += ch;
  }
  const out: string[] = [];
  for (const raw of clean.split(" ")) {
    if (!raw) continue;
    const word = raw.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
    let cur = "";
    for (const ch of word) {
      if (isPunct(ch)) {
        if (cur) out.push(cur);
        out.push(ch);
        cur = "";
      } else cur += ch;
    }
    if (cur) out.push(cur);
  }
  return out;
}

export function wordPiece(vocabText: string): WordPiece {
  const vocab = new Map<string, number>();
  vocabText.split("\n").forEach((tok, i) => {
    const t = tok.replace(/\r$/, "");
    if (t && !vocab.has(t)) vocab.set(t, i);
  });
  const id = (t: string) => vocab.get(t);
  const UNK = id("[UNK]")!;
  const CLS = id("[CLS]")!;
  const SEP = id("[SEP]")!;
  const pieces = (word: string): number[] => {
    const chars = Array.from(word);
    if (chars.length > 100) return [UNK];
    const out: number[] = [];
    let start = 0;
    while (start < chars.length) {
      let end = chars.length;
      let found: number | undefined;
      while (start < end) {
        const sub = (start > 0 ? "##" : "") + chars.slice(start, end).join("");
        found = id(sub);
        if (found !== undefined) break;
        end--;
      }
      if (found === undefined) return [UNK];
      out.push(found);
      start = end;
    }
    return out;
  };
  return {
    encode(text, maxLength) {
      const ids: number[] = [CLS];
      for (const w of basicTokens(text)) {
        for (const p of pieces(w)) {
          if (ids.length >= maxLength - 1) break;
          ids.push(p);
        }
        if (ids.length >= maxLength - 1) break;
      }
      ids.push(SEP);
      return ids;
    },
  };
}
