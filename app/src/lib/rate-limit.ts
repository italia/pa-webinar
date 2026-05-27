/**
 * Simple in-memory rate limiter for API routes.
 *
 * Not suitable for multi-instance deployments — each pod has its own
 * state. In production, ingress-level rate limiting (NGINX annotations)
 * handles global per-IP limits. This in-memory limiter still protects
 * per-user/per-action limits (e.g. Q&A submission cooldowns) where
 * approximate enforcement per pod is acceptable.
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
 * Walks the common reverse-proxy headers in order of preference:
 *   1. X-Forwarded-For (de-facto standard, may carry a comma-list —
 *      take the leftmost value, which is the original client).
 *   2. X-Real-IP (NGINX default with `real_ip_header` configured).
 *   3. CF-Connecting-IP (Cloudflare).
 *   4. Forwarded `for=...` (RFC 7239).
 *   5. `unknown` fallback. **Note:** all callers sharing this fallback
 *      bucket get rate-limited together, which is the safer failure
 *      mode (one misbehaving client can DoS the bucket) than silently
 *      letting brute-force traffic through unkeyed.
 *
 * Live discovery on videocall-test (May 2026) showed the AKS NGINX
 * ingress not setting X-Forwarded-For by default; X-Real-IP was the
 * only populated client header. Without (2) the rate limit was
 * effectively per-instance instead of per-client.
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
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) {
    return cf.trim();
  }
  const rfc7239 = request.headers.get('forwarded');
  if (rfc7239) {
    // Format: `for=192.0.2.60;proto=http;by=203.0.113.43`. Pick the
    // first `for=` segment.
    const match = /for=("?[^";,]+)/i.exec(rfc7239);
    if (match?.[1]) {
      return match[1].replace(/^"|"$/g, '').trim();
    }
  }
  return 'unknown';
}
