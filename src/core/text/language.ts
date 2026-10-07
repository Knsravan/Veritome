/**
 * Rough language identification, enough to tell whether a paper is in English and, if not, which language to
 * translate from. Scripts decide most languages outright; Latin-script languages are told apart by their
 * commonest short words.
 */
export interface Language {
  code: string;
  name: string;
}

const SCRIPTS: Array<[RegExp, Language]> = [
  [/[ఀ-౿]/g, { code: "te", name: "Telugu" }],
  [/[஀-௿]/g, { code: "ta", name: "Tamil" }],
  [/[ಀ-೿]/g, { code: "kn", name: "Kannada" }],
  [/[ഀ-ൿ]/g, { code: "ml", name: "Malayalam" }],
  [/[ঀ-৿]/g, { code: "bn", name: "Bengali" }],
  [/[઀-૿]/g, { code: "gu", name: "Gujarati" }],
  [/[਀-੿]/g, { code: "pa", name: "Punjabi" }],
  [/[ऀ-ॿ]/g, { code: "hi", name: "Hindi" }],
  [/[؀-ۿ]/g, { code: "ar", name: "Arabic" }],
  [/[Ѐ-ӿ]/g, { code: "ru", name: "Russian" }],
  [/[Ͱ-Ͽ]/g, { code: "el", name: "Greek" }],
  [/[가-힯]/g, { code: "ko", name: "Korean" }],
  [/[぀-ヿ]/g, { code: "ja", name: "Japanese" }],
  [/[一-鿿]/g, { code: "zh", name: "Chinese" }],
  [/[฀-๿]/g, { code: "th", name: "Thai" }],
];

const WORDS: Record<string, { name: string; words: string[] }> = {
  en: { name: "English", words: "the of and to in is that for are with as this was by on be from were which have".split(" ") },
  es: { name: "Spanish", words: "de la que el en los del las por con una para es se como al su más fue".split(" ") },
  pt: { name: "Portuguese", words: "de que da do em os para com uma não dos das por se mais foi ao como".split(" ") },
  fr: { name: "French", words: "de la le et les des en du une est que dans pour sur par au qui pas".split(" ") },
  de: { name: "German", words: "der die und das in den von zu mit ist im des sich für auf dem nicht eine".split(" ") },
  it: { name: "Italian", words: "di il che la e per un del della una sono nel con le non gli dei alla".split(" ") },
  nl: { name: "Dutch", words: "de het een van en in is dat op te voor met zijn niet aan door ook".split(" ") },
  id: { name: "Indonesian", words: "yang dan di dengan untuk dari ini dalam pada adalah tidak ke akan oleh".split(" ") },
  tr: { name: "Turkish", words: "ve bir bu ile için da de olarak olan daha çok gibi en ancak kadar".split(" ") },
  pl: { name: "Polish", words: "w i na z się nie do że jest to o przez od dla oraz jak po".split(" ") },
};

export function detectLanguage(text: string): Language & { confidence: number } {
  const sample = text.slice(0, 20_000);
  const letters = (sample.match(/\p{L}/gu) ?? []).length || 1;
  for (const [re, lang] of SCRIPTS) {
    const n = (sample.match(re) ?? []).length;
    if (n / letters > 0.3) return { ...lang, confidence: Math.min(1, n / letters + 0.2) };
  }
  const tokens = (sample.toLowerCase().match(/\p{L}+/gu) ?? []).slice(0, 3000);
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  let best = { code: "en", name: "English", score: 0 };
  let second = 0;
  for (const [code, { name, words }] of Object.entries(WORDS)) {
    const score = words.reduce((n, w) => n + (counts.get(w) ?? 0), 0) / Math.max(1, tokens.length);
    if (score > best.score) {
      second = best.score;
      best = { code, name, score };
    } else if (score > second) second = score;
  }
  return { code: best.code, name: best.name, confidence: best.score === 0 ? 0 : Math.min(1, (best.score - second) / best.score + 0.3) };
}
