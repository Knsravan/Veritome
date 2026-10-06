import "server-only";

export interface ServerConfig {
  llm: { baseUrl?: string; model?: string; apiKey?: string };
  /** Let the browser supply its own LLM endpoint. Off by default; turn on only for private deployments. */
  allowClientLlm: boolean;
  /** Allow browser-supplied LLM URLs on localhost or private networks (e.g. Ollama). */
  allowPrivateLlm: boolean;
  languageToolUrl?: string;
  braveApiKey?: string;
  serperApiKey?: string;
  semanticScholarKey?: string;
  /** Contact address sent to Crossref and OpenAlex, as their polite-pool policies ask. */
  contactEmail?: string;
  libraryDir?: string;
  rateLimitPerMinute: number;
  /** Read the client address from X-Forwarded-For. Only enable behind a proxy you control. */
  trustProxy: boolean;
}

const bool = (v: string | undefined, fallback = false) => (v === undefined || v === "" ? fallback : /^(1|true|yes|on)$/i.test(v.trim()));
const str = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

export function readConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const limit = Number(env.RATE_LIMIT_PER_MINUTE);
  const cfg: ServerConfig = {
    llm: {},
    allowClientLlm: bool(env.ALLOW_CLIENT_LLM),
    allowPrivateLlm: bool(env.ALLOW_PRIVATE_LLM),
    rateLimitPerMinute: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 30,
    trustProxy: bool(env.TRUST_PROXY),
  };
  const set = <K extends keyof ServerConfig>(k: K, v: ServerConfig[K] | undefined) => {
    if (v !== undefined) cfg[k] = v;
  };
  if (str(env.LLM_BASE_URL)) cfg.llm.baseUrl = str(env.LLM_BASE_URL);
  if (str(env.LLM_MODEL)) cfg.llm.model = str(env.LLM_MODEL);
  if (str(env.LLM_API_KEY)) cfg.llm.apiKey = str(env.LLM_API_KEY);
  set("languageToolUrl", str(env.LANGUAGETOOL_URL));
  set("braveApiKey", str(env.BRAVE_API_KEY));
  set("serperApiKey", str(env.SERPER_API_KEY));
  set("semanticScholarKey", str(env.SEMANTIC_SCHOLAR_API_KEY));
  set("contactEmail", str(env.CONTACT_EMAIL));
  set("libraryDir", str(env.LIBRARY_DIR));
  return cfg;
}

/** What the browser may know about this server. Never includes keys or URLs. */
export interface PublicStatus {
  llm: boolean;
  llmModel?: string;
  allowClientLlm: boolean;
  languageTool: boolean;
  webSearch: string[];
  semanticScholarKey: boolean;
  libraryDocuments: number;
}
