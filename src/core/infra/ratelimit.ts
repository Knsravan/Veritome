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

/** Fixed-window in-memory limiter. Good enough for a single self-hosted instance. */
export function createRateLimiter(options: RateLimiterOptions) {
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
