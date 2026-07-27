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

/** Invalidazione puntuale: per gli eventi che non possono aspettare il TTL
 *  (es. revoca di un token). In multi-replica agisce solo sul pod locale —
 *  sugli altri resta il bound del TTL. */
export function deleteCache(key: string): void {
  store.delete(key);
}

/**
 * Invalidazione per prefisso, per quando le voci sono una famiglia e non una
 * sola: la stessa lista può essere in cache in più varianti (per esempio un
 * filtro di stato per pannello), e cancellarne una lascerebbe le altre a
 * rispondere con il contenuto di prima. Stesso limite di `deleteCache`: agisce
 * sul processo locale, sugli altri resta il TTL.
 */
export function deleteCacheByPrefix(prefix: string): number {
  let cancellate = 0;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      cancellate += 1;
    }
  }
  return cancellate;
}
