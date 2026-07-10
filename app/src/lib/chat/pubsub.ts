/**
 * Redis pub/sub helpers for in-app chat.
 *
 * Channel naming: `chat:<eventId>`. One channel per event keeps
 * subscribers focused (a pod hosting SSE streams for event A doesn't
 * receive messages for event B). When the whole app stops using
 * chat for an event (no SSE subscribers) Redis simply has no
 * consumers and the published messages are discarded — no storage
 * needed, the canonical store is Postgres.
 */

import { getRedis, getRedisSubscriber } from '@/lib/redis';

/** A file/image attached to a chat message. Never carries bytes — just a
 * reference the client fetches from the access-controlled serving route. */
export interface ChatAttachmentRef {
  url: string; // absolute app-served URL
  name: string; // original filename (decrypted; plaintext on the wire like text)
  mime: string;
  size: number;
}

/** A compact quote of the message being replied to. */
export interface ChatReplyRef {
  id: string;
  senderName: string; // decrypted
  text: string; // decrypted, truncated snippet
}

export interface ChatEnvelope {
  id: string;
  eventId: string;
  senderId: string;
  senderName: string;
  isModerator: boolean;
  text: string;
  createdAt: string; // ISO
  // Optional single attachment reference (no bytes on the wire).
  attachment?: ChatAttachmentRef;
  // Optional quote of the parent message this one replies to.
  replyTo?: ChatReplyRef;
  // When set to 'delete' the subscriber hides the message instead of
  // appending. Covers the moderation path (hide message live without
  // the sender having to refresh).
  op?: 'delete';
}

function channel(eventId: string): string {
  return `chat:${eventId}`;
}

/**
 * Publish a chat message to all subscribers in the cluster.
 * Returns the number of subscribers Redis reached on this pod's
 * network round-trip (useful for telemetry, not for correctness —
 * persistence is already in Postgres).
 */
export async function publishChat(envelope: ChatEnvelope): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  return redis.publish(channel(envelope.eventId), JSON.stringify(envelope));
}

/**
 * Subscribe to `chat:<eventId>` and invoke `onMessage` for every
 * envelope. Returns an unsubscribe function the caller must invoke
 * when the SSE stream closes — otherwise the underlying ioredis
 * subscriber leaks listeners.
 *
 * We use a shared subscriber connection; ioredis forbids issuing
 * commands on it once subscribed, but multiple subscribe() calls on
 * different channels are fine.
 */
export async function subscribeChat(
  eventId: string,
  onMessage: (envelope: ChatEnvelope) => void,
): Promise<() => void> {
  const sub = getRedisSubscriber();
  if (!sub) return () => {};

  const ch = channel(eventId);

  const handler = (receivedChannel: string, payload: string) => {
    if (receivedChannel !== ch) return;
    try {
      const envelope = JSON.parse(payload) as ChatEnvelope;
      onMessage(envelope);
    } catch {
      // Malformed payload — drop silently. Real-time guarantees are
      // best-effort; clients can always refetch history.
    }
  };

  await sub.subscribe(ch);
  sub.on('message', handler);

  return () => {
    sub.off('message', handler);
    // Don't unsubscribe from Redis here: other SSE streams on this
    // pod might be listening to the same channel. Redis auto-cleans
    // channels with zero subscribers, and the local handler is
    // detached so this listener won't fire again.
  };
}
