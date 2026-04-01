/**
 * Simple in-memory rate limiter for API routes.
 * Not suitable for multi-instance deployments — use Redis-based
 * rate limiting in production behind multiple replicas.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();
const MAX_STORE_SIZE = 50_000;

const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
  // Evict oldest entries if store exceeds max size
  if (store.size > MAX_STORE_SIZE) {
    const excess = store.size - MAX_STORE_SIZE;
    const iter = store.keys();
    for (let i = 0; i < excess; i++) {
      const key = iter.next().value;
      if (key) store.delete(key);
    }
  }
}

interface RateLimitOptions {
  /** Maximum number of requests in the window. */
  limit: number;
  /** Window duration in milliseconds. */
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): RateLimitResult {
  cleanup();

  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  entry.count += 1;

  if (entry.count > limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return {
    allowed: true,
    remaining: limit - entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * Extract a client identifier from the request for rate-limiting.
 * Uses X-Forwarded-For (trusted proxy) or falls back to a generic key.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0];
    if (first) return first.trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }
  return 'unknown';
}
