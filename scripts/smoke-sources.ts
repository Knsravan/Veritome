/**
 * Checks that every external service Veritome can use is reachable and still
 * answers in the shape the code expects. Uses fixed test queries, never user text.
 *
 *   node scripts/smoke-sources.ts            # reads settings from the environment (.env is not loaded)
 *   node --env-file=.env scripts/smoke-sources.ts
 *
 * Exits with 1 when any configured service fails.
 */
import { createArxiv } from "../src/core/citations/sources/arxiv.ts";
import { createCrossref } from "../src/core/citations/sources/crossref.ts";
import { createDataCite } from "../src/core/citations/sources/datacite.ts";
import { createOpenAlex } from "../src/core/citations/sources/openalex.ts";
import { createSemanticScholar } from "../src/core/citations/sources/semanticscholar.ts";
import { checkWithLanguageTool } from "../src/core/grammar/languagetool.ts";
import { createHttp } from "../src/core/infra/http.ts";
import { createLlmClient } from "../src/core/llm/client.ts";
import { braveProvider, serperProvider } from "../src/core/plagiarism/providers.ts";

const env = process.env;
const http = createHttp({
  userAgent: `Veritome-smoke/0.1 (https://github.com/Knsravan/Veritome${env.CONTACT_EMAIL ? `; mailto:${env.CONTACT_EMAIL}` : ""})`,
  timeoutMs: 20_000,
  retries: 1,
});
const mailto = env.CONTACT_EMAIL ? { mailto: env.CONTACT_EMAIL } : {};

// Stable, well-known records used as fixed probes.
const KNOWN_DOI = "10.1038/nature14539"; // LeCun, Bengio & Hinton (2015), Deep learning. Nature.
const QUERY = "deep learning representation learning";

interface Check {
  name: string;
  configured: boolean;
  run: () => Promise<string>;
}

const checks: Check[] = [
  {
    name: "Crossref",
    configured: true,
    run: async () => {
      const w = await createCrossref(http, mailto).getWork(KNOWN_DOI);
      if (!w || !/deep learning/i.test(w.title)) throw new Error("unexpected record for the test DOI");
      return `DOI lookup ok (${w.title}, ${w.year})`;
    },
  },
  {
    name: "OpenAlex",
    configured: true,
    run: async () => {
      const c = createOpenAlex(http, { ...mailto, ...(env.OPENALEX_API_KEY ? { apiKey: env.OPENALEX_API_KEY } : {}) });
      const w = await c.getByDoi(KNOWN_DOI);
      const s = await c.search(QUERY, 3);
      if (!w) throw new Error("test DOI not found");
      return `DOI lookup ok, search returned ${s.length}`;
    },
  },
  {
    name: "Semantic Scholar",
    configured: true,
    run: async () => {
      const s = await createSemanticScholar(http, env.SEMANTIC_SCHOLAR_API_KEY ? { apiKey: env.SEMANTIC_SCHOLAR_API_KEY } : {}).search(QUERY, 3);
      return `search returned ${s.length}${env.SEMANTIC_SCHOLAR_API_KEY ? " (with key)" : " (no key, shared rate limit)"}`;
    },
  },
  {
    name: "arXiv",
    configured: true,
    run: async () => {
      const w = await createArxiv(http).getById("1706.03762");
      if (!w || !/attention/i.test(w.title)) throw new Error("unexpected record for 1706.03762");
      return `id lookup ok (${w.title})`;
    },
  },
  {
    name: "DataCite",
    configured: true,
    run: async () => {
      const w = await createDataCite(http).getWork("10.5281/zenodo.1234");
      return w ? `DOI lookup ok (${w.title.slice(0, 50)})` : "reachable (test DOI not registered)";
    },
  },
  {
    name: "Brave Search",
    configured: Boolean(env.BRAVE_API_KEY),
    run: async () => {
      const docs = await braveProvider(http, env.BRAVE_API_KEY as string).search({ start: 0, end: 0, text: QUERY, score: 1, phrase: QUERY, keywords: QUERY });
      return `search returned ${docs.length}`;
    },
  },
  {
    name: "Serper",
    configured: Boolean(env.SERPER_API_KEY),
    run: async () => {
      const docs = await serperProvider(http, env.SERPER_API_KEY as string).search({ start: 0, end: 0, text: QUERY, score: 1, phrase: QUERY, keywords: QUERY });
      return `search returned ${docs.length}`;
    },
  },
  {
    name: "LanguageTool",
    configured: Boolean(env.LANGUAGETOOL_URL),
    run: async () => {
      const r = await checkWithLanguageTool("This are a test.", { url: env.LANGUAGETOOL_URL as string, http });
      if (r.warning) throw new Error(r.warning);
      return `${r.issues.length} issue(s) found in the test sentence`;
    },
  },
  {
    name: "Language model",
    configured: Boolean(env.LLM_BASE_URL && env.LLM_MODEL),
    run: async () => {
      const llm = createLlmClient({ baseUrl: env.LLM_BASE_URL as string, model: env.LLM_MODEL as string, ...(env.LLM_API_KEY ? { apiKey: env.LLM_API_KEY } : {}) });
      const reply = await llm.chat({ system: "Reply with the single word OK.", user: "Ping", temperature: 0, maxTokens: 5 });
      return `${env.LLM_MODEL} replied “${reply.trim().slice(0, 20)}”`;
    },
  },
];

let failed = 0;
for (const c of checks) {
  if (!c.configured) {
    console.log(`-  ${c.name.padEnd(17)} not configured`);
    continue;
  }
  const t = Date.now();
  try {
    const msg = await c.run();
    console.log(`ok ${c.name.padEnd(17)} ${msg} [${Date.now() - t} ms]`);
  } catch (err) {
    failed++;
    console.log(`!! ${c.name.padEnd(17)} FAILED: ${err instanceof Error ? err.message : String(err)} [${Date.now() - t} ms]`);
  }
}
process.exit(failed ? 1 : 0);
