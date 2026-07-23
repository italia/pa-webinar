/**
 * Redis pub/sub for transient, targeted live-control signals — kept
 * SEPARATE from chat (lib/chat/pubsub) on purpose:
 *   - the chat contract (ChatEnvelope, dedup-by-id, history backfill)
 *     stays byte-for-byte unchanged, so nothing chat-related can regress;
 *   - a control subscriber never receives chat traffic and vice versa
 *     (each `message` handler filters by channel), so the control stream
 *     carries only the rare control ops it exists for.
 *
 * Channel naming: `control:<eventId>` (one per event, like chat).
 *
 * F8 — raise-hand auto-lower: the Jitsi IFrame API can lower ONLY the
 * local user's hand (`toggleRaiseHand`), never a remote one. So a
 * moderator "lower this hand" must reach the raiser's OWN browser, which
 * then lowers its own hand; Jitsi then broadcasts `raiseHandUpdated(0)`
 * and every client's queue drains naturally. This module is the transport
 * that carries that signal to the target's browser.
 *
 * Best-effort, exactly like chat: with REDIS_URL unset (dev docker-compose)
 * publish/subscribe are no-ops and the signal simply doesn't deliver.
 */

import { getRedis, getRedisSubscriber } from '@/lib/redis';

export interface ControlEnvelope {
  /** The only control op today: tell the addressed client to lower its hand. */
  op: 'lowerHand';
  /** Opaque Jitsi endpoint id of the participant whose hand should drop.
   *  This is the ONLY id the raised-hands queue knows (raiseHandUpdated evt.id);
   *  it is NOT a registration/seat id and carries no PII. */
  targetEndpointId: string;
  /** The Jitsi raise timestamp (evt.handRaised) of the SPECIFIC raise being
   *  lowered — a value shared across all clients for that raise. The target
   *  lowers its hand ONLY if this equals its current raise id, so a stale signal
   *  can never drop a hand the participant already lowered and re-raised
   *  (toggleRaiseHand is a toggle — firing it on a down hand would re-raise it). */
  raiseId: number;
  /** ISO timestamp — emitted for observability; the client gates on raiseId,
   *  not on this. */
  ts: string;
}

function channel(eventId: string): string {
  return `control:${eventId}`;
}

/**
 * Fan a control envelope out to every open control stream in the cluster.
 * Returns the subscriber count Redis reached (telemetry only; delivery is
 * best-effort — there is no persistence and no replay for control ops).
 */
export async function publishControl(
  eventId: string,
  envelope: ControlEnvelope,
): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  return redis.publish(channel(eventId), JSON.stringify(envelope));
}

/**
 * Subscribe to `control:<eventId>`; `onMessage` fires for every control
 * envelope. Returns a detach function the SSE stream MUST call on close.
 * Shares the pod's single ioredis subscriber connection with chat — the
 * channel filter keeps the two streams' traffic disjoint.
 */
export async function subscribeControl(
  eventId: string,
  onMessage: (envelope: ControlEnvelope) => void,
): Promise<() => void> {
  const sub = getRedisSubscriber();
  if (!sub) return () => {};

  const ch = channel(eventId);

  const handler = (receivedChannel: string, payload: string) => {
    if (receivedChannel !== ch) return;
    try {
      onMessage(JSON.parse(payload) as ControlEnvelope);
    } catch {
      // Malformed payload — drop silently (best-effort, like chat).
    }
  };

  await sub.subscribe(ch);
  sub.on('message', handler);

  return () => {
    sub.off('message', handler);
    // Don't Redis-unsubscribe: other streams on this pod may share the
    // channel, and Redis auto-cleans channels with zero subscribers.
  };
}
