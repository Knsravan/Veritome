import { BadRequest } from "./api";

/** Words each visitor may send to the Humaniser per day on this server instance, so a public site's model bill stays bounded. */
const DAILY_WORDS = Number(process.env.HUMANISE_DAILY_WORDS) > 0 ? Number(process.env.HUMANISE_DAILY_WORDS) : 30_000;
const g = globalThis as typeof globalThis & { __veritomeHumaniseUse?: Map<string, number> };
const use = (g.__veritomeHumaniseUse ??= new Map<string, number>());

/** Counts `text`'s words against the visitor's daily allowance, or throws a 429 when it is used up. */
export function spendHumaniseWords(visitor: string, text: string): void {
  const words = text.split(/\s+/).filter(Boolean).length;
  const k = `${new Date().toISOString().slice(0, 10)}|${visitor}`;
  if (use.size > 50_000) use.clear();
  const used = use.get(k) ?? 0;
  if (used + words > DAILY_WORDS) {
    throw new BadRequest(`The daily limit of ${DAILY_WORDS.toLocaleString("en")} words for the Humaniser and Paraphraser has been reached. Try again tomorrow.`, 429);
  }
  use.set(k, used + words);
}
