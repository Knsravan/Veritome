/**
 * Measures the plagiarism checker on constructed cases built from real abstracts.
 *
 *   node scripts/evaluate-plagiarism.ts                 # matching accuracy (needs network once, to fetch abstracts)
 *   node scripts/evaluate-plagiarism.ts --live 20       # also: can the live search services find the source?
 *   node scripts/evaluate-plagiarism.ts --out docs/plagiarism-eval.md
 *   node scripts/evaluate-plagiarism.ts --inspect       # also print every false alarm and wrongly credited source
 *
 * Abstracts are fetched from Europe PMC at run time and not stored. Half become "published sources", the
 * other half the author's own writing. Every case hides one source sentence (or none) inside original text:
 *
 *   verbatim   a source sentence copied as is              → must be found, marked uncited
 *   cited      the same, followed by a citation            → must be found, marked cited
 *   edited     every 6th word changed or dropped            → must still be found
 *   reworded   three or more words swapped for synonyms     → should be found (as copied or reworded)
 *   original   no source text at all                        → must find nothing (false alarm test)
 *
 * The matcher is given every source document for every case, so the matching test is not helped by search
 * luck; the --live test measures search separately.
 */
import { writeFileSync } from "node:fs";
import { createOpenAlex } from "../src/core/citations/sources/openalex.ts";
import { createCrossref } from "../src/core/citations/sources/crossref.ts";
import { createHttp } from "../src/core/infra/http.ts";
import { checkPlagiarism } from "../src/core/plagiarism/check.ts";
import { crossrefProvider, europePmcProvider, openAlexProvider, type SourceProvider } from "../src/core/plagiarism/providers.ts";
import { splitSentences } from "../src/core/text/sentences.ts";

const args = process.argv.slice(2);
const live = Number(args[args.indexOf("--live") + 1] ?? 0) || 0;
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : undefined;
const env = process.env;
const http = createHttp({ userAgent: "Veritome-eval/0.1 (https://github.com/Knsravan/Veritome)", timeoutMs: 30_000, retries: 2 });

interface Abstract {
  id: string;
  title: string;
  year?: number;
  text: string;
}

const TOPICS = [
  "machine learning", "soil carbon", "malaria", "climate change", "graphene", "depression", "crop yield",
  "antibiotic resistance", "air pollution", "education", "protein folding", "coral reef",
];

/** Abstracts from Europe PMC, spread over a dozen unrelated fields. */
async function fetchAbstracts(n: number): Promise<Abstract[]> {
  const per = Math.ceil(n / TOPICS.length);
  const out: Abstract[] = [];
  for (const topic of TOPICS) {
    const q = `"${topic}" AND HAS_ABSTRACT:Y AND PUB_YEAR:[2005 TO 2024] AND LANG:eng`;
    const data = await http.json<{ resultList: { result: Array<{ id: string; title?: string; pubYear?: string; abstractText?: string }> } }>(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}&resultType=core&pageSize=${per}&format=json`,
    );
    for (const r of data.resultList.result) {
      const text = (r.abstractText ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      out.push({ id: `pmc:${r.id}`, title: (r.title ?? "").replace(/<[^>]+>/g, ""), ...(r.pubYear ? { year: Number(r.pubYear) } : {}), text });
    }
  }
  // Interleave topics so sources and host texts come from every field.
  const seen = new Set<string>();
  return out
    .filter((a) => a.text.split(/\s+/).length >= 120 && !seen.has(a.text.slice(0, 200)) && seen.add(a.text.slice(0, 200))).sort((a, b) => (a.id < b.id ? -1 : 1));
}

// Deterministic pseudo-random numbers so runs are repeatable.
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

const wordsOf = (s: string) => s.split(/\s+/).filter(Boolean);
const goodSentences = (text: string) => splitSentences(text).map((s) => s.text.trim()).filter((s) => wordsOf(s).length >= 15 && wordsOf(s).length <= 40);

// An independent list of everyday academic swaps (not the checker's own synonym list).
const SWAPS: Record<string, string> = {
  show: "demonstrate", shows: "demonstrates", showed: "demonstrated", use: "employ", used: "employed", using: "employing",
  important: "significant", method: "approach", methods: "approaches", result: "finding", results: "findings", study: "investigation",
  increase: "rise", increased: "elevated", decrease: "decline", decreased: "reduced", large: "substantial", small: "limited",
  however: "nevertheless", also: "additionally", new: "novel", different: "distinct", improve: "enhance", improved: "enhanced",
  provide: "offer", provides: "offers", suggest: "indicate", suggests: "indicates", effect: "impact", effects: "impacts",
  analysis: "examination", analyzed: "examined", analysed: "examined", data: "observations", high: "elevated", low: "reduced",
  main: "principal", total: "overall", need: "requirement", based: "founded", performance: "effectiveness", approach: "strategy",
  found: "observed", major: "key", several: "multiple", various: "diverse", help: "assist", obtained: "acquired",
};

function edit(sentence: string): string {
  return wordsOf(sentence)
    .map((w, i) => (i % 6 === 5 ? (rand() < 0.5 ? "" : "notably") : w))
    .filter(Boolean)
    .join(" ");
}

function reword(sentence: string): string | null {
  let swapped = 0;
  const outWords = wordsOf(sentence).map((w) => {
    const m = /^([A-Za-z]+)(\W*)$/.exec(w);
    const key = m?.[1]?.toLowerCase();
    if (!m || !key || !SWAPS[key]) return w;
    swapped++;
    const r = SWAPS[key] as string;
    return (m[1]![0] === m[1]![0]!.toUpperCase() ? r[0]!.toUpperCase() + r.slice(1) : r) + (m[2] ?? "");
  });
  return swapped >= 3 ? outWords.join(" ") : null;
}

type Kind = "verbatim" | "cited" | "edited" | "reworded" | "original";
interface Case {
  kind: Kind;
  text: string;
  inserted?: { start: number; end: number };
  sourceId?: string;
}

function buildCases(sources: Abstract[], own: Abstract[]): Case[] {
  const cases: Case[] = [];
  sources.forEach((src, i) => {
    const sentence = goodSentences(src.text)[0];
    const host = own[i % own.length] as Abstract;
    const hostSentences = goodSentences(host.text);
    if (!sentence || hostSentences.length < 3) return;
    const before = hostSentences.slice(0, 2).join(" ");
    const after = hostSentences.slice(2, 4).join(" ");
    const make = (kind: Kind, inserted: string) => {
      const text = `${before} ${inserted} ${after}`;
      cases.push({ kind, text, inserted: { start: before.length + 1, end: before.length + 1 + inserted.length }, sourceId: src.id });
    };
    make("verbatim", sentence);
    make("cited", sentence.replace(/\.$/, " (Smith et al., 2019)."));
    make("edited", edit(sentence));
    const r = reword(sentence);
    if (r) make("reworded", r);
  });
  own.forEach((host) => {
    const s = goodSentences(host.text);
    if (s.length >= 4) cases.push({ kind: "original", text: s.slice(0, 5).join(" ") });
  });
  return cases;
}

function allSourcesProvider(sources: Abstract[]): SourceProvider {
  const docs = sources.map((s) => ({ id: s.id, title: s.title, text: s.text, provider: "Eval", kind: "scholarly" as const, ...(s.year ? { year: s.year } : {}) }));
  let served = false;
  return {
    name: "Eval",
    kind: "scholarly",
    coverage: "Every source document",
    async search() {
      // Return the documents once per check; the checker compares each with the whole text.
      if (served) return [];
      served = true;
      return docs;
    },
  };
}

interface Tally {
  n: number;
  found: number;
  rightSource: number;
  citedRight: number;
  falseWords: number;
}

async function main() {
  console.error("Fetching abstracts from Europe PMC…");
  const abstracts = await fetchAbstracts(400);
  const half = Math.floor(abstracts.length / 2);
  const sources = abstracts.slice(0, half);
  const own = abstracts.slice(half);
  const cases = buildCases(sources, own);
  console.error(`${sources.length} sources, ${own.length} host texts, ${cases.length} cases`);

  const tally = new Map<Kind, Tally>();
  for (const c of cases) {
    const t = tally.get(c.kind) ?? { n: 0, found: 0, rightSource: 0, citedRight: 0, falseWords: 0 };
    tally.set(c.kind, t);
    t.n++;
    const r = await checkPlagiarism(c.text, { providers: [allSourcesProvider(sources)], checkSelf: false });
    const ins = c.inserted;
    if (!ins) {
      if (r.spans.length || r.paraphrases.length) t.found++;
      if (args.includes("--inspect")) for (const sp of r.spans) console.error(`FALSE ${sp.words}w: ${sp.text.slice(0, 160)} <- ${sp.sourceIds[0]}`);
      if (args.includes("--inspect")) for (const p of r.paraphrases) console.error(`FALSE-REWORD ${p.similarity}: ${p.text.slice(0, 120)} <- ${p.sourceText.slice(0, 120)}`);
      t.falseWords += r.matchedWords;
      continue;
    }
    const exact = r.spans.filter((s) => s.end > ins.start && s.start < ins.end);
    const reworded = r.paraphrases.filter((p) => p.end > ins.start && p.start < ins.end);
    const hit = c.kind === "reworded" ? exact.length > 0 || reworded.length > 0 : exact.length > 0;
    if (hit) t.found++;
    if (exact[0]?.sourceIds[0] === c.sourceId || (!exact.length && reworded[0]?.sourceId === c.sourceId)) t.rightSource++;
    else if (args.includes("--inspect") && c.kind === "verbatim") console.error(`WRONG-SOURCE want ${c.sourceId} got ${exact[0]?.sourceIds.join(",")}`);
    if (exact.length && exact[0]!.cited === (c.kind === "cited")) t.citedRight++;
    // Matched words outside the inserted sentence are false alarms.
    t.falseWords += r.spans.filter((s) => s.end <= ins.start || s.start >= ins.end).reduce((n, s) => n + s.words, 0);
  }

  let liveLine = "";
  if (live > 0) {
    console.error(`Live search test on ${live} verbatim cases…`);
    const providers = [
      ...(env.OPENALEX_API_KEY ? [openAlexProvider(createOpenAlex(http, { apiKey: env.OPENALEX_API_KEY }))] : []),
      crossrefProvider(createCrossref(http, {})),
      europePmcProvider(http),
    ];
    const sample = cases.filter((c) => c.kind === "verbatim").slice(0, live);
    let foundLive = 0;
    for (const c of sample) {
      const r = await checkPlagiarism(c.text, { providers, checkSelf: false, paraphrases: false });
      if (r.spans.some((s) => c.inserted && s.end > c.inserted.start && s.start < c.inserted.end)) foundLive++;
    }
    liveLine = `\n**Live search** (${providers.map((p) => p.name).join(", ")}; ${sample.length} verbatim cases): the copied sentence was found in ${foundLive} (${pct(foundLive, sample.length)}). The sources are Europe PMC abstracts, so this favours Europe PMC; it shows the search step works end to end, not how well every field is covered.\n`;
  }

  const row = (k: Kind, label: string) => {
    const t = tally.get(k);
    if (!t) return "";
    if (k === "original") return `| ${label} | ${t.n} | ${t.found} texts with any match (${pct(t.found, t.n)}) | – | – |`;
    return `| ${label} | ${t.n} | ${t.found} (${pct(t.found, t.n)}) | ${t.rightSource} (${pct(t.rightSource, t.n)}) | ${k === "reworded" ? "–" : `${t.citedRight} (${pct(t.citedRight, t.found)})`} |`;
  };
  const report = `# Plagiarism checker evaluation (${new Date().toISOString().slice(0, 10)})

Generated by \`node scripts/evaluate-plagiarism.ts${live ? ` --live ${live}` : ""}\` from ${abstracts.length} Europe PMC abstracts in ${TOPICS.length} fields
(${sources.length} used as published sources, ${own.length} as the author's own writing). Each case hides one source
sentence of 15 to 40 words inside two to four sentences of unrelated original text. The checker is given all
${sources.length} source documents for every case.

| Case | Cases | Found | Credited to the right source | Cited/uncited judged right |
| --- | ---: | ---: | ---: | ---: |
${row("verbatim", "Copied word for word")}
${row("cited", "Copied, with a citation after it")}
${row("edited", "Copied with every 6th word changed or dropped")}
${row("reworded", "Lightly reworded (3 or more words swapped for synonyms)")}
${row("original", "Original text only (false alarms)")}

Words wrongly matched outside the copied sentence: ${[...tally.values()].reduce((n, t) => n + t.falseWords, 0)} in total across all cases.
${liveLine}
Limits of this test: the rewordings are mechanical swaps from a fixed list, which is easier than a person (or a
language model) paraphrasing freely; real retrieval also depends on which services answer, which the live test
samples only.
`;
  if (out) writeFileSync(out, report);
  console.log(report);
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "–");

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
