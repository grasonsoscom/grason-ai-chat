// Fixed-window, in-memory rate limiter for API tokens.
// Serverless instances keep their own window; this is documented and is enough
// for abuse protection without adding Redis to the stack.

export const RATE_LIMIT_MAX = 60;
export const RATE_LIMIT_WINDOW_MS = 60_000;

type Bucket = { count: number; resetAt: number };

const globalForRate = globalThis as { apiRateBuckets?: Map<string, Bucket> };
const buckets = (globalForRate.apiRateBuckets ??= new Map<string, Bucket>());

export function checkRateLimit(key: string, now = Date.now()) {
  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, retryAfter: 0 };
  }
  if (existing.count >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  existing.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - existing.count, retryAfter: 0 };
}

/** Test/helper hook; not exposed through the API. */
export function resetRateLimits() {
  buckets.clear();
}
