/**
 * Simple in-memory TTL cache for reducing DB queries under high concurrency.
 *
 * Designed for short-lived entries (seconds) — not a general-purpose cache.
 * In production with multiple replicas, each pod maintains its own cache;
 * this is acceptable because the TTL is very short.
 */

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const store = new Map<string, CacheEntry<unknown>>();
const MAX_ENTRIES = 1000;

function evictExpired(): void {
  if (store.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiry < now) store.delete(key);
  }
}

export function getCached<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiry < Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCache<T>(key: string, data: T, ttlMs: number): void {
  store.set(key, { data, expiry: Date.now() + ttlMs });
  evictExpired();
}
