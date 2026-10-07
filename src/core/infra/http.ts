export type FetchLike = typeof fetch;

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(status: number, url: string, message?: string) {
    super(message ?? `HTTP ${status} for ${redactUrl(url)}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

export class TimeoutError extends Error {
  constructor(url: string, ms: number) {
    super(`Request to ${redactUrl(url)} timed out after ${ms} ms`);
    this.name = "TimeoutError";
  }
}

/** Removes query strings so API keys and user text never end up in error messages. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "<invalid url>";
  }
}

export interface HttpOptions {
  fetch?: FetchLike;
  /** Sent as User-Agent; scholarly APIs ask for a contact address. */
  userAgent?: string;
  timeoutMs?: number;
  /** Extra attempts after the first for 429 and 5xx responses. */
  retries?: number;
  /** Base delay for exponential back-off. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface Http {
  json<T = unknown>(url: string, options?: RequestOptions): Promise<T>;
  text(url: string, options?: RequestOptions): Promise<string>;
}

export function createHttp(options: HttpOptions = {}): Http {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const defaultTimeout = options.timeoutMs ?? 15_000;
  const defaultRetries = options.retries ?? 2;
  const backoff = options.backoffMs ?? 400;

  async function request(url: string, req: RequestOptions): Promise<Response> {
    const timeoutMs = req.timeoutMs ?? defaultTimeout;
    const retries = req.retries ?? defaultRetries;
    let attempt = 0;
    for (;;) {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      req.signal?.addEventListener("abort", onAbort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const res = await doFetch(url, {
          method: req.method ?? "GET",
          headers: {
            accept: "application/json",
            ...(options.userAgent ? { "user-agent": options.userAgent } : {}),
            ...req.headers,
          },
          body: req.body,
          signal: controller.signal,
        });
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : backoff * 2 ** attempt;
          attempt++;
          await res.arrayBuffer().catch(() => undefined);
          await sleep(wait);
          continue;
        }
        if (!res.ok) throw new HttpError(res.status, url);
        return res;
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (req.signal?.aborted) throw err;
        if (timedOut) {
          if (attempt < retries) {
            attempt++;
            await sleep(backoff * 2 ** (attempt - 1));
            continue;
          }
          throw new TimeoutError(url, timeoutMs);
        }
        if (attempt < retries) {
          attempt++;
          await sleep(backoff * 2 ** (attempt - 1));
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
        req.signal?.removeEventListener("abort", onAbort);
      }
    }
  }

  return {
    async json<T>(url: string, req: RequestOptions = {}) {
      const res = await request(url, req);
      return (await res.json()) as T;
    },
    async text(url: string, req: RequestOptions = {}) {
      const res = await request(url, { ...req, headers: { accept: "*/*", ...req.headers } });
      return res.text();
    },
  };
}

/** Runs async tasks with a concurrency cap and preserves input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Thrown when a paced client has used its request allowance for this check. */
export class RequestBudgetExceeded extends Error {
  constructor(service: string) {
    super(`${service} request allowance for this check is used up`);
    this.name = "RequestBudgetExceeded";
  }
}

export interface PaceOptions {
  /** Name used in messages. */
  service: string;
  /** Minimum time between the starts of two requests. */
  minIntervalMs: number;
  /** Most requests allowed through this client. */
  maxRequests: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Wraps a client so requests to a strict service go one at a time, spaced out,
 * up to a fixed number. Services such as arXiv and CORE refuse bursts.
 */
export function pacedHttp(http: Http, options: PaceOptions): Http {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  let chain: Promise<void> = Promise.resolve();
  let last = -Infinity;
  let used = 0;
  const slot = (): Promise<void> => {
    if (used >= options.maxRequests) return Promise.reject(new RequestBudgetExceeded(options.service));
    used++;
    const turn = chain.then(async () => {
      const wait = last + options.minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      last = now();
    });
    chain = turn.catch(() => undefined);
    return turn;
  };
  return {
    async json<T>(url: string, req?: RequestOptions) {
      await slot();
      return http.json<T>(url, req);
    },
    async text(url: string, req?: RequestOptions) {
      await slot();
      return http.text(url, req);
    },
  };
}
