export interface RateLimiterOptions {
  /** Requests allowed per window per key. */
  limit: number;
  windowMs: number;
  now?: () => number;
  /** Upper bound on tracked keys so memory stays flat under abuse. */
  maxKeys?: number;
}

export interface RateDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimiter {
  check(key: string): RateDecision | Promise<RateDecision>;
}

/** Fixed-window in-memory limiter. Good enough for a single self-hosted instance. */
export function createRateLimiter(options: RateLimiterOptions): { check(key: string): RateDecision } {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 10_000;
  const hits = new Map<string, { count: number; resetAt: number }>();

  function sweep(t: number) {
    for (const [key, v] of hits) if (v.resetAt <= t) hits.delete(key);
    if (hits.size > maxKeys) {
      const overflow = hits.size - maxKeys;
      let i = 0;
      for (const key of hits.keys()) {
        hits.delete(key);
        if (++i >= overflow) break;
      }
    }
  }

  return {
    check(key: string): RateDecision {
      const t = now();
      if (hits.size >= maxKeys) sweep(t);
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= t) {
        hits.set(key, { count: 1, resetAt: t + options.windowMs });
        return { allowed: true, remaining: options.limit - 1, retryAfterMs: 0 };
      }
      if (entry.count >= options.limit) {
        return { allowed: false, remaining: 0, retryAfterMs: entry.resetAt - t };
      }
      entry.count++;
      return { allowed: true, remaining: options.limit - entry.count, retryAfterMs: 0 };
    },
  };
}

export interface RedisRateLimiterOptions {
  /** Upstash-compatible Redis REST endpoint, e.g. https://example.upstash.io */
  url: string;
  token: string;
  limit: number;
  windowMs: number;
  /** Prepended to every key, so several buckets and apps can share one database. */
  prefix: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Give up on the store after this long. Default 1500 ms. */
  timeoutMs?: number;
}

/**
 * Fixed-window limiter kept in Redis through Upstash's REST API, so every server instance
 * (each Vercel function instance, say) counts against the same limit. Throws when the
 * store cannot be reached; pair it with `withFallback`.
 */
export function createRedisRateLimiter(options: RedisRateLimiterOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const doFetch = options.fetch ?? fetch;
  const endpoint = `${options.url.replace(/\/+$/, "")}/pipeline`;
  return {
    async check(key: string): Promise<RateDecision> {
      const t = now();
      const window = Math.floor(t / options.windowMs);
      const resetAt = (window + 1) * options.windowMs;
      const k = `${options.prefix}:${key}:${window}`;
      const res = await doFetch(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
        // The key outlives its window slightly so a late INCR never leaves a key without expiry.
        body: JSON.stringify([["INCR", k], ["PEXPIRE", k, String(options.windowMs + 1000)]]),
        signal: AbortSignal.timeout(options.timeoutMs ?? 1500),
      });
      if (!res.ok) throw new Error(`Rate-limit store answered ${res.status}.`);
      const out = (await res.json()) as Array<{ result?: unknown; error?: unknown }>;
      const count = Array.isArray(out) && !out[0]?.error ? Number(out[0]?.result) : NaN;
      if (!Number.isInteger(count) || count < 1) throw new Error("Rate-limit store gave an unexpected reply.");
      if (count > options.limit) return { allowed: false, remaining: 0, retryAfterMs: resetAt - t };
      return { allowed: true, remaining: options.limit - count, retryAfterMs: 0 };
    },
  };
}

/**
 * Uses `primary` while it works. When it fails, answers from `fallback` and leaves `primary`
 * alone for `cooldownMs`, so an unreachable store does not slow every request down.
 */
export function withFallback(
  primary: RateLimiter,
  fallback: RateLimiter,
  { cooldownMs = 30_000, now = Date.now, onError }: { cooldownMs?: number; now?: () => number; onError?: (err: unknown) => void } = {},
): RateLimiter {
  let skipUntil = 0;
  return {
    async check(key: string): Promise<RateDecision> {
      if (now() >= skipUntil) {
        try {
          return await primary.check(key);
        } catch (err) {
          skipUntil = now() + cooldownMs;
          onError?.(err);
        }
      }
      return fallback.check(key);
    },
  };
}
