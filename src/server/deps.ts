import "server-only";
import { createArxiv } from "../core/citations/sources/arxiv.ts";
import { createCrossref } from "../core/citations/sources/crossref.ts";
import { createDataCite } from "../core/citations/sources/datacite.ts";
import { createOpenAlex } from "../core/citations/sources/openalex.ts";
import { createSemanticScholar } from "../core/citations/sources/semanticscholar.ts";
import type { FinderDeps } from "../core/citations/finder.ts";
import type { VerifierDeps } from "../core/citations/verify.ts";
import type { LanguageToolOptions } from "../core/grammar/languagetool.ts";
import { createHttp, type FetchLike, type Http } from "../core/infra/http.ts";
import { createLlmClient, type LlmClient } from "../core/llm/client.ts";
import { resolveLlmConfig, type ClientLlmOverride } from "../core/llm/config.ts";
import {
  arxivProvider,
  braveProvider,
  coreProvider,
  crossrefProvider,
  europePmcProvider,
  openAlexProvider,
  semanticScholarProvider,
  semanticScholarSnippetProvider,
  serperProvider,
  wikipediaProvider,
  type SourceProvider,
} from "../core/plagiarism/providers.ts";
import type { PublicStatus, ServerConfig } from "./config.ts";
import { loadLibrary } from "./library.ts";

export function scholarlyHttp(cfg: ServerConfig, fetchImpl?: FetchLike): Http {
  return createHttp({
    userAgent: `Veritome/0.1 (https://github.com/Knsravan/Veritome${cfg.contactEmail ? `; mailto:${cfg.contactEmail}` : ""})`,
    timeoutMs: 15_000,
    retries: 2,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

export function scholarlyClients(cfg: ServerConfig, http: Http) {
  const mailto = cfg.contactEmail ? { mailto: cfg.contactEmail } : {};
  return {
    crossref: createCrossref(http, mailto),
    openalex: createOpenAlex(http, { ...mailto, ...(cfg.openAlexKey ? { apiKey: cfg.openAlexKey } : {}) }),
    semanticscholar: createSemanticScholar(http, cfg.semanticScholarKey ? { apiKey: cfg.semanticScholarKey } : {}),
    arxiv: createArxiv(http),
    datacite: createDataCite(http),
  };
}

export function verifierDeps(cfg: ServerConfig, http: Http): VerifierDeps {
  const c = scholarlyClients(cfg, http);
  return { crossref: c.crossref, openalex: c.openalex, datacite: c.datacite, arxiv: c.arxiv };
}

export function finderDeps(cfg: ServerConfig, http: Http): FinderDeps {
  const c = scholarlyClients(cfg, http);
  return { openalex: c.openalex, semanticscholar: c.semanticscholar, crossref: c.crossref, arxiv: c.arxiv };
}

export function plagiarismProviders(cfg: ServerConfig, http: Http, options: { web: boolean }): SourceProvider[] {
  const c = scholarlyClients(cfg, http);
  const providers: SourceProvider[] = [
    openAlexProvider(c.openalex),
    crossrefProvider(c.crossref),
    semanticScholarProvider(c.semanticscholar),
    arxivProvider(c.arxiv),
    europePmcProvider(http),
    wikipediaProvider(http),
  ];
  if (cfg.coreApiKey) providers.push(coreProvider(http, cfg.coreApiKey));
  if (cfg.semanticScholarKey) providers.push(semanticScholarSnippetProvider(http, { apiKey: cfg.semanticScholarKey }));
  if (options.web && cfg.braveApiKey) providers.push(braveProvider(http, cfg.braveApiKey));
  if (options.web && cfg.serperApiKey) providers.push(serperProvider(http, cfg.serperApiKey));
  return providers;
}

export const PUBLIC_LANGUAGETOOL_URL = "https://api.languagetool.org";

/** The operator's LanguageTool server, or the public one when the user agreed and the operator allows it. */
export function languageToolOptions(cfg: ServerConfig, options: { allowPublic?: boolean } = {}): LanguageToolOptions | undefined {
  if (cfg.languageToolUrl) return { url: cfg.languageToolUrl, http: createHttp({ timeoutMs: 30_000, retries: 1 }) };
  if (options.allowPublic && cfg.publicLanguageTool) {
    // The public service accepts 20 KB per request and about 20 requests a minute.
    return { url: PUBLIC_LANGUAGETOOL_URL, http: createHttp({ timeoutMs: 30_000, retries: 2, backoffMs: 3000 }), maxChunkChars: 18_000 };
  }
  return undefined;
}

/** Server LLM, or a browser-supplied one when the operator allows it (checked by the SSRF guard). */
export async function llmClient(cfg: ServerConfig, override?: ClientLlmOverride): Promise<LlmClient | undefined> {
  const config = await resolveLlmConfig({
    env: { LLM_BASE_URL: cfg.llm.baseUrl, LLM_MODEL: cfg.llm.model, LLM_API_KEY: cfg.llm.apiKey },
    override,
    allowClientConfig: cfg.allowClientLlm,
    allowPrivate: cfg.allowPrivateLlm,
  });
  return config ? createLlmClient(config) : undefined;
}

export async function publicStatus(cfg: ServerConfig): Promise<PublicStatus> {
  const web = [cfg.braveApiKey ? "Brave Search" : "", cfg.serperApiKey ? "Serper (Google)" : ""].filter(Boolean);
  return {
    llm: Boolean(cfg.llm.baseUrl && cfg.llm.model),
    ...(cfg.llm.model ? { llmModel: cfg.llm.model } : {}),
    allowClientLlm: cfg.allowClientLlm,
    languageTool: Boolean(cfg.languageToolUrl),
    publicLanguageTool: !cfg.languageToolUrl && cfg.publicLanguageTool,
    maxUploadBytes: cfg.maxUploadBytes,
    webSearch: web,
    semanticScholarKey: Boolean(cfg.semanticScholarKey),
    plagiarismSources: plagiarismProviders(cfg, scholarlyHttp(cfg), { web: false }).map((p) => p.name),
    libraryDocuments: (await loadLibrary(cfg.libraryDir)).length,
  };
}
