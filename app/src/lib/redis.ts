/**
 * Redis connection singleton.
 *
 * Used for:
 *   - chat pub/sub (real-time fan-out across pods)
 *   - future: distributed rate-limiting (today rate-limit is in-memory
 *     per-pod, see lib/rate-limit.ts)
 *
 * We keep **three** connections alive per pod:
 *   - `redis`        — default client for commands (PUBLISH, GET, SET…)
 *   - `redisSubscriber` — a dedicated subscriber because once a
 *     connection enters SUBSCRIBE mode ioredis rejects other commands
 *     on it. The subscriber is lazy: it's created only when the first
 *     `subscribe()` call happens (SSE chat stream).
 *
 * When `REDIS_URL` is missing we fall back to `null` so that callers
 * can gracefully disable real-time features in dev without Redis
 * running (messages still persist, they just don't fan out to other
 * pods — typical local docker-compose setup).
 */

import Redis, { type Redis as RedisClient } from 'ioredis';

let primary: RedisClient | null | undefined;
let subscriber: RedisClient | null | undefined;

function buildClient(tag: string): RedisClient | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  const client = new Redis(url, {
    // Retry aggressively at boot so transient DNS hiccups on helm
    // install don't crash the app; cap at ~30s total.
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      return Math.min(times * 200, 3000);
    },
    // Named connection for observability — Redis `CLIENT LIST` shows
    // our pods clearly distinguishing chat publisher vs subscriber.
    connectionName: `pa-webinar:${tag}`,
  });

  client.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.warn(`[redis:${tag}] ${err.message}`);
  });
  return client;
}

export function getRedis(): RedisClient | null {
  if (primary === undefined) primary = buildClient('primary');
  return primary;
}

export function getRedisSubscriber(): RedisClient | null {
  if (subscriber === undefined) subscriber = buildClient('subscriber');
  return subscriber;
}
