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

/**
 * Run a Redis command with a deadline, returning `fallback` when it expires.
 *
 * Needed because the client is built with `maxRetriesPerRequest: null` (see
 * `buildClient`): a command is never rejected for timing out, it stays
 * queued until Redis comes back. Checking `status` covers a dropped
 * connection, not one that stays 'ready' over a network that swallows
 * packets — there the command leaves and never returns, and what waits on it
 * is an HTTP route.
 *
 * The `.catch()` on the operation is what turns a failure into the fallback:
 * without it a command that rejects BEFORE the deadline would reject the race
 * too, and the caller would get an exception where it asked for a value. It is
 * not there to avoid unhandled rejections — `Promise.race` subscribes to every
 * promise it is given, so a late rejection is observed either way.
 */
export async function withDeadline<T>(
  op: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      op.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    // Cleared either way: a fast reply must not leave a pending timer
    // holding the event loop awake.
    clearTimeout(timer);
  }
}
