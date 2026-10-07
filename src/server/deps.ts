import "server-only";
import { createArxiv } from "../core/citations/sources/arxiv.ts";
import { createCrossref } from "../core/citations/sources/crossref.ts";
import { createDataCite } from "../core/citations/sources/datacite.ts";
import { createOpenAlex } from "../core/citations/sources/openalex.ts";
import { createSemanticScholar } from "../core/citations/sources/semanticscholar.ts";
import type { FinderDeps } from "../core/citations/finder.ts";
import type { VerifierDeps } from "../core/citations/verify.ts";
import type { LanguageToolOptions } from "../core/grammar/languagetool.ts";
import { createHttp, pacedHttp, type FetchLike, type Http } from "../core/infra/http.ts";
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
import { assertSafeUrl } from "../core/infra/netguard.ts";
import { fetchFullText } from "../core/plagiarism/fulltext.ts";
import { findOwnWorks } from "../core/plagiarism/ownwork.ts";
import type { SourceDoc } from "../core/plagiarism/providers.ts";
import { cleanPdfText } from "../core/text/latex.ts";
import type { PublicStatus, ServerConfig } from "./config.ts";
import { loadLibrary } from "./library.ts";

const USER_AGENT = (cfg: ServerConfig) => `Veritome/0.1 (https://github.com/Knsravan/Veritome${cfg.contactEmail ? `; mailto:${cfg.contactEmail}` : ""})`;

export function scholarlyHttp(cfg: ServerConfig, fetchImpl?: FetchLike): Http {
  return createHttp({
    userAgent: USER_AGENT(cfg),
    timeoutMs: 15_000,
    retries: 2,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

const clientCache = new WeakMap<Http, ReturnType<typeof buildClients>>();

/** One set of clients per check (per Http instance), so pacing is shared by every tool in a report. */
export function scholarlyClients(cfg: ServerConfig, http: Http) {
  let c = clientCache.get(http);
  if (!c) clientCache.set(http, (c = buildClients(cfg, http)));
  return c;
}

function buildClients(cfg: ServerConfig, http: Http) {
  const mailto = cfg.contactEmail ? { mailto: cfg.contactEmail } : {};
  // arXiv asks for one request every 3 seconds and can be slow to answer.
  const arxivHttp = pacedHttp(
    createHttp({ userAgent: USER_AGENT(cfg), timeoutMs: 30_000, retries: 1, backoffMs: 3000 }),
    { service: "arXiv", minIntervalMs: 3100, maxRequests: 25 },
  );
  return {
    crossref: createCrossref(http, mailto),
    openalex: createOpenAlex(http, { ...mailto, ...(cfg.openAlexKey ? { apiKey: cfg.openAlexKey } : {}) }),
    semanticscholar: createSemanticScholar(http, cfg.semanticScholarKey ? { apiKey: cfg.semanticScholarKey } : {}),
    arxiv: createArxiv(arxivHttp),
    datacite: createDataCite(http),
    // CORE's free plan allows only a few requests a minute.
    coreHttp: pacedHttp(http, { service: "CORE", minIntervalMs: 6500, maxRequests: 12 }),
    // Brave's free plan allows one query a second and 2,000 a month, so a check spends at most 30.
    braveHttp: pacedHttp(http, { service: "Brave Search", minIntervalMs: 1100, maxRequests: 30 }),
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
  // CORE's free plan allows only a few requests a minute.
  if (cfg.coreApiKey) providers.push(coreProvider(c.coreHttp, cfg.coreApiKey));
  if (cfg.semanticScholarKey) providers.push(semanticScholarSnippetProvider(http, { apiKey: cfg.semanticScholarKey }));
  if (options.web && cfg.braveApiKey) providers.push(braveProvider(c.braveHttp, cfg.braveApiKey));
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
    env: { LLM_BASE_URL: cfg.llm.baseUrl, LLM_MODEL: cfg.llm.model, LLM_API_KEY: cfg.llm.apiKey, LLM_REASONING_EFFORT: cfg.llm.reasoningEffort },
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

const MAX_PDF_BYTES = 20 * 1024 * 1024;

/**
 * Downloads a public PDF and returns its text. Every hop of a redirect is checked against the SSRF guard
 * (no private, local or cloud-metadata addresses), the size is capped and the download times out.
 */
export async function publicPdfText(cfg: ServerConfig, url: string, signal?: AbortSignal): Promise<string> {
  let target = url;
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    const safe = await assertSafeUrl(target, { allowPrivate: false });
    res = await fetch(safe, {
      redirect: "manual",
      headers: { "user-agent": USER_AGENT(cfg), accept: "application/pdf,*/*;q=0.5" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
    });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!loc) break;
    target = new URL(loc, target).toString();
    res = null;
  }
  if (!res || !res.ok) throw new Error("The PDF could not be downloaded.");
  if (Number(res.headers.get("content-length") ?? "0") > MAX_PDF_BYTES) throw new Error("The PDF is too large.");
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PDF_BYTES) {
      await reader.cancel();
      throw new Error("The PDF is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw new Error("Not a PDF.");
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return cleanPdfText((text as string[]).join("\n\n"));
}

/** Fetches the free full text of matched papers for a closer comparison. */
export function fullTextFetcher(cfg: ServerConfig, http: Http): (doc: SourceDoc, signal?: AbortSignal) => Promise<{ text: string; via: string } | null> {
  return (doc, signal) =>
    fetchFullText(
      doc,
      {
        http,
        pdfText: (url, sig) => publicPdfText(cfg, url, sig),
        ...(cfg.openAlexKey ? { openAlexKey: cfg.openAlexKey } : {}),
        ...(cfg.contactEmail ? { mailto: cfg.contactEmail } : {}),
      },
      signal,
    );
}

/** The author's own earlier papers for the self-plagiarism check, or undefined when none were found. */
export async function ownWorks(cfg: ServerConfig, http: Http, who: string | undefined, signal?: AbortSignal) {
  if (!who) return undefined;
  try {
    const r = await findOwnWorks(
      who,
      { http, fullText: fullTextFetcher(cfg, http), ...(cfg.openAlexKey ? { openAlexKey: cfg.openAlexKey } : {}), ...(cfg.contactEmail ? { mailto: cfg.contactEmail } : {}) },
      signal,
    );
    return r ?? undefined;
  } catch {
    return undefined;
  }
}
