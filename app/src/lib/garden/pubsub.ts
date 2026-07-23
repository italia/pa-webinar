/**
 * Redis pub/sub + key/value helpers for the waiting-room garden.
 *
 * Two distinct pieces of state per event:
 *
 *   1) `garden:<eventId>:pos:<userId>` (hash) — last known position,
 *      avatar and display name of each active user. TTL ≈ 10 s so
 *      stale clients vanish automatically when they close the tab.
 *      Stored as a Redis HASH so we can `HGETALL` the whole room in
 *      a single round-trip.
 *
 *   2) `garden:<eventId>` (pub/sub channel) — fan-out of every
 *      position update, so other users see each other move in ~200 ms
 *      via the SSE stream.
 *
 * No persistence beyond TTL: the garden is a transient presence
 * layer, not a social graph. Nothing is written to Postgres.
 */

import { getRedis, getRedisSubscriber } from '@/lib/redis';

export type GardenEmoteType = 'wave' | 'heart';

export interface GardenPeer {
  userId: string;
  displayName: string;
  avatarId: string;
  x: number; // 0..100 in percent of stage width
  y: number; // 0..100 in percent of stage height
  facing: 'down' | 'up' | 'left' | 'right';
  walkPhase: number; // 0..1 (animation clock shared)
  updatedAt: number; // ms
  /**
   * Emote transiente (saluto / cuore) allegata al ping.
   *
   * Opzionale di proposito: i client che non la conoscono continuano a pingare
   * senza il campo e restano validi. `at` è l'orologio del MITTENTE e non va
   * confrontato con il nostro: serve solo da identificatore per-peer, così chi
   * legge riconosce che due ping consecutivi portano la STESSA emote e non
   * riavvia l'animazione a ogni poll.
   */
  emote?: { type: GardenEmoteType; at: number };
}

function posKey(eventId: string): string {
  return `garden:${eventId}:pos`;
}

function channel(eventId: string): string {
  return `garden:${eventId}`;
}

// 10s TTL: tick is nominally ~200ms, so this tolerates ~50 missed
// pings before the user disappears — comfortable even for users
// behind flaky wifi. Shorter TTLs created ghosting on screen.
const PEER_TTL_SECONDS = 10;

/**
 * Record this user's position and publish to peers. Idempotent: if
 * the same userId pings twice we overwrite.
 */
export async function publishGardenPing(
  eventId: string,
  peer: GardenPeer,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const key = posKey(eventId);
  const payload = JSON.stringify(peer);

  // Single pipeline for atomicity: HSET + expire on the hash, and a
  // separate PUBLISH on the channel.
  await redis
    .pipeline()
    .hset(key, peer.userId, payload)
    .expire(key, PEER_TTL_SECONDS)
    .publish(channel(eventId), payload)
    .exec();
}

/**
 * Fetch every peer currently in the garden for this event. Used by
 * the SSE stream on subscribe (initial snapshot) and by the HTTP
 * ping response (so the client always sees a fresh view even if the
 * SSE is slightly behind).
 */
export async function listGardenPeers(eventId: string): Promise<GardenPeer[]> {
  const redis = getRedis();
  if (!redis) return [];
  const raw = await redis.hgetall(posKey(eventId));
  const now = Date.now();
  const peers: GardenPeer[] = [];
  for (const v of Object.values(raw)) {
    try {
      const p = JSON.parse(v) as GardenPeer;
      // Drop anything older than the TTL window, defensive against
      // clock skew and late expiration.
      if (now - p.updatedAt < PEER_TTL_SECONDS * 1000) peers.push(p);
    } catch {
      /* ignore malformed */
    }
  }
  return peers;
}

/**
 * Subscribe to `garden:<eventId>`. Callback receives every peer
 * update (their own pings + those from other users).
 */
export async function subscribeGarden(
  eventId: string,
  onPeer: (peer: GardenPeer) => void,
): Promise<() => void> {
  const sub = getRedisSubscriber();
  if (!sub) return () => {};
  const ch = channel(eventId);

  const handler = (receivedChannel: string, payload: string) => {
    if (receivedChannel !== ch) return;
    try {
      onPeer(JSON.parse(payload) as GardenPeer);
    } catch {
      /* malformed */
    }
  };

  await sub.subscribe(ch);
  sub.on('message', handler);

  return () => {
    sub.off('message', handler);
    // Leave the Redis subscription up — other SSE streams may still
    // be listening on the same pod.
  };
}

/**
 * Explicitly remove a user from the garden (tab close, clicked
 * "Leave"). Not strictly required because TTL handles it, but nicer
 * UX so others see the peer disappear immediately.
 */
export async function removeGardenPeer(eventId: string, userId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis
    .pipeline()
    .hdel(posKey(eventId), userId)
    .publish(channel(eventId), JSON.stringify({ userId, op: 'leave' }))
    .exec();
}
