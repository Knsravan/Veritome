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
import { htmlToText } from "../core/plagiarism/webpage.ts";
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
    // Without a key, Semantic Scholar shares a small allowance among all callers; a paced, budgeted client for the
    // plagiarism search avoids being turned away for every passage.
    // OpenAlex meters requests: without a key every caller on the server's address shares a small daily budget.
    // The plagiarism search spends at most 150 requests a check (100 without a key).
    openalexPaced: createOpenAlex(pacedHttp(http, { service: "OpenAlex", minIntervalMs: 110, maxRequests: cfg.openAlexKey ? 150 : 100 }), {
      ...mailto,
      ...(cfg.openAlexKey ? { apiKey: cfg.openAlexKey } : {}),
    }),
    semanticscholarPaced: createSemanticScholar(
      pacedHttp(http, { service: "Semantic Scholar", minIntervalMs: cfg.semanticScholarKey ? 250 : 1100, maxRequests: cfg.semanticScholarKey ? 120 : 40 }),
      cfg.semanticScholarKey ? { apiKey: cfg.semanticScholarKey } : {},
    ),
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
    openAlexProvider(c.openalexPaced),
    crossrefProvider(c.crossref),
    arxivProvider(c.arxiv),
    europePmcProvider(http),
    wikipediaProvider(http),
  ];
  // CORE's free plan allows only a few requests a minute.
  if (cfg.coreApiKey) providers.push(coreProvider(c.coreHttp, cfg.coreApiKey));
  // Without a key Semantic Scholar turns away nearly every request, and OpenAlex covers the same papers.
  if (cfg.semanticScholarKey) {
    providers.push(semanticScholarProvider(c.semanticscholarPaced));
    providers.push(semanticScholarSnippetProvider(http, { apiKey: cfg.semanticScholarKey }));
  }
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
    openAlexKey: Boolean(cfg.openAlexKey),
    plagiarismSources: plagiarismProviders(cfg, scholarlyHttp(cfg), { web: false }).map((p) => p.name),
    libraryDocuments: (await loadLibrary(cfg.libraryDir)).length,
  };
}

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_PAGE_BYTES = 5 * 1024 * 1024;

/**
 * Downloads a public URL. Every hop of a redirect is checked against the SSRF guard (no private, local or
 * cloud-metadata addresses), the size is capped and the download times out.
 */
async function safeDownload(cfg: ServerConfig, url: string, accept: string, maxBytes: number, signal?: AbortSignal): Promise<{ bytes: Uint8Array; type: string }> {
  let target = url;
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    const safe = await assertSafeUrl(target, { allowPrivate: false });
    res = await fetch(safe, {
      redirect: "manual",
      headers: { "user-agent": USER_AGENT(cfg), accept },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
    });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!loc) break;
    target = new URL(loc, target).toString();
    res = null;
  }
  if (!res || !res.ok) throw new Error("The document could not be downloaded.");
  if (Number(res.headers.get("content-length") ?? "0") > maxBytes) throw new Error("The document is too large.");
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("The document is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return { bytes, type: res.headers.get("content-type") ?? "" };
}

const isPdf = (bytes: Uint8Array) => String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";

async function pdfBytesToText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return cleanPdfText((text as string[]).join("\n\n"));
}

/** Downloads a public PDF and returns its text (see safeDownload for the safeguards). */
export async function publicPdfText(cfg: ServerConfig, url: string, signal?: AbortSignal): Promise<string> {
  const { bytes } = await safeDownload(cfg, url, "application/pdf,*/*;q=0.5", MAX_PDF_BYTES, signal);
  if (!isPdf(bytes)) throw new Error("Not a PDF.");
  return pdfBytesToText(bytes);
}

/** The readable text of a public web page or PDF, for comparing a matched page as a whole. */
export async function publicPageText(cfg: ServerConfig, url: string, signal?: AbortSignal): Promise<string> {
  const { bytes, type } = await safeDownload(cfg, url, "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5", MAX_PDF_BYTES, signal);
  if (isPdf(bytes)) return pdfBytesToText(bytes);
  if (!/html|xml|text\/plain/i.test(type) || bytes.byteLength > MAX_PAGE_BYTES) throw new Error("Not a readable page.");
  const html = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return /text\/plain/i.test(type) ? html : htmlToText(html);
}

/** Fetches web pages found by the search, so the whole page is compared rather than its snippet. */
export function webPageFetcher(cfg: ServerConfig): (doc: SourceDoc, signal?: AbortSignal) => Promise<{ text: string; via: string } | null> {
  return async (doc, signal) => {
    if (!doc.url) return null;
    const text = (await publicPageText(cfg, doc.url, signal)).slice(0, 400_000);
    return text.length > 500 ? { text, via: "the whole web page" } : null;
  };
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
