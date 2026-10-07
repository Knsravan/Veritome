import "server-only";
import { LlmError, LlmNotConfiguredError } from "../core/llm/client.ts";
import { UnsafeUrlError } from "../core/infra/netguard.ts";
import { createRateLimiter } from "../core/infra/ratelimit.ts";
import type { ClientLlmOverride } from "../core/llm/config.ts";
import { readConfig, type ServerConfig } from "./config.ts";
import { ExtractionError } from "./extract.ts";

/** Most text a request may carry. Roughly a 60,000-word manuscript. */
export const MAX_TEXT_CHARS = 400_000;
const MAX_BODY_BYTES = 2_500_000;

export class BadRequest extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "BadRequest";
    this.status = status;
  }
}

type Limiter = ReturnType<typeof createRateLimiter>;
const g = globalThis as typeof globalThis & { __veritomeLimiters?: Map<string, Limiter> };

function limiter(bucket: string, perMinute: number): Limiter {
  g.__veritomeLimiters ??= new Map();
  let l = g.__veritomeLimiters.get(bucket);
  if (!l) g.__veritomeLimiters.set(bucket, (l = createRateLimiter({ limit: perMinute, windowMs: 60_000 })));
  return l;
}

export function clientKey(req: Request, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  // Without a trusted proxy every caller shares one bucket, which is the safe default.
  return "shared";
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

export interface HandlerContext {
  cfg: ServerConfig;
  req: Request;
}

export interface HandlerOptions {
  bucket: string;
  /** Share of the configured per-minute limit this bucket gets. Expensive routes use less. Default 1. */
  weight?: number;
}

/**
 * Wraps a route: rate limiting, error mapping and no-store responses. Request
 * bodies are never logged, and errors returned to the browser carry no user text.
 */
export function route(options: HandlerOptions, fn: (ctx: HandlerContext) => Promise<unknown>) {
  return async (req: Request): Promise<Response> => {
    const cfg = readConfig();
    const perMinute = Math.max(1, Math.floor(cfg.rateLimitPerMinute * (options.weight ?? 1)));
    const decision = limiter(options.bucket, perMinute).check(clientKey(req, cfg.trustProxy));
    if (!decision.allowed) {
      return json(
        { error: "Too many requests. Wait a moment and try again." },
        429,
        { "retry-after": String(Math.ceil(decision.retryAfterMs / 1000)) },
      );
    }
    try {
      const out = await fn({ cfg, req });
      return out instanceof Response ? out : json(out);
    } catch (err) {
      if (err instanceof BadRequest) return json({ error: err.message }, err.status);
      if (err instanceof ExtractionError) return json({ error: err.message }, 422);
      if (err instanceof UnsafeUrlError) return json({ error: `That language-model address is not allowed: ${err.message}` }, 400);
      if (err instanceof LlmNotConfiguredError) return json({ error: err.message }, 503);
      if (err instanceof LlmError) return json({ error: err.message }, 502);
      if (err instanceof Error && err.name === "AbortError") return json({ error: "The request was cancelled." }, 499);
      console.error(`[veritome] ${options.bucket} failed: ${err instanceof Error ? err.name : "unknown error"}`);
      return json({ error: "Something went wrong on the server. Try again, or with a shorter text." }, 500);
    }
  };
}

/** Reads a JSON object body with a size cap. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) throw new BadRequest("The request is too large.", 413);
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) throw new BadRequest("The request is too large.", 413);
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch {
    throw new BadRequest("The request body must be a JSON object.");
  }
}

export function text(body: Record<string, unknown>, key = "text", { min = 1, max = MAX_TEXT_CHARS } = {}): string {
  const v = body[key];
  if (typeof v !== "string" || v.trim().length < min) throw new BadRequest(key === "text" ? "Paste or upload some text first." : `"${key}" is required.`);
  if (v.length > max) throw new BadRequest(`The text is too long (limit ${max.toLocaleString("en")} characters).`, 413);
  return v;
}

export function optionalBool(body: Record<string, unknown>, key: string, fallback = false): boolean {
  const v = body[key];
  return typeof v === "boolean" ? v : fallback;
}

export function oneOf<T extends string>(body: Record<string, unknown>, key: string, allowed: readonly T[], fallback?: T): T {
  const v = body[key];
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  if (v === undefined && fallback !== undefined) return fallback;
  throw new BadRequest(`"${key}" must be one of: ${allowed.join(", ")}.`);
}

export function stringList(body: Record<string, unknown>, key: string, maxItems = 200, maxLen = 100): string[] {
  const v = body[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length <= maxLen).slice(0, maxItems);
}

/** External lookups send text to third parties, so the browser must confirm the user agreed. */
export function requireConsent(body: Record<string, unknown>): void {
  if (body.consent !== true) {
    throw new BadRequest("This check sends parts of your text to outside search services. Confirm that you agree before running it.", 428);
  }
}

export function llmOverride(body: Record<string, unknown>): ClientLlmOverride | undefined {
  const v = body.llm;
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const pick = (k: string) => (typeof o[k] === "string" && (o[k] as string).length < 500 ? (o[k] as string) : undefined);
  const out: ClientLlmOverride = {};
  const baseUrl = pick("baseUrl");
  const model = pick("model");
  const apiKey = pick("apiKey");
  if (baseUrl) out.baseUrl = baseUrl;
  if (model) out.model = model;
  if (apiKey) out.apiKey = apiKey;
  return out.baseUrl && out.model ? out : undefined;
}

export interface LibraryInput {
  id: string;
  title: string;
  text: string;
}

/** Documents the user attached in the browser for this request only. */
export function libraryDocs(body: Record<string, unknown>): LibraryInput[] {
  const v = body.library;
  if (!Array.isArray(v)) return [];
  let total = 0;
  const out: LibraryInput[] = [];
  for (const [i, d] of v.slice(0, 20).entries()) {
    if (!d || typeof d !== "object") continue;
    const o = d as Record<string, unknown>;
    if (typeof o.text !== "string" || !o.text.trim()) continue;
    total += o.text.length;
    if (total > MAX_TEXT_CHARS * 2) throw new BadRequest("The attached library documents are too large in total.", 413);
    out.push({ id: `upload:${i}`, title: typeof o.title === "string" ? o.title.slice(0, 200) : `Document ${i + 1}`, text: o.text });
  }
  return out;
}
