import { createHash, createHmac } from 'crypto';

/**
 * A stable, one-way key derived from a chat `senderId`, for the client.
 *
 * The raw id must never leave the server: it names the seat behind the
 * message (`reg-<registrationId>`, a grant id, or a guest id derived from the
 * client address, see `guestSenderId`). This holds for every
 * channel that reaches a client: the history, the POST response, the export
 * and the live stream (the Redis envelope carries this key, never the id).
 *
 * The client's only use for it is picking a bubble colour and grouping a
 * person's messages, and a hash does both. Truncated to 16 hex chars: collision
 * risk in a room of a few hundred is negligible and the payload stays small.
 *
 * Keyed (HMAC with APP_SECRET), not a bare SHA-256: the input has little
 * entropy — the name is shown next to the key, and the IPv4 space is small —
 * so an unkeyed hash is reversed by enumeration in minutes. Without the
 * secret the key cannot be recomputed. Same pattern as `hashEmail`: the
 * unkeyed fallback exists only where APP_SECRET is absent, which only a
 * development setup allows. The prefix separates this use of the secret from
 * the others (email hash, signed tokens).
 */
export function senderColourKey(senderId: string): string {
  if (!senderId) return '';
  const input = `chat-sender-key:${senderId}`;
  const secret = process.env.APP_SECRET;
  const digest = secret
    ? createHmac('sha256', secret).update(input).digest('hex')
    : createHash('sha256').update(input).digest('hex');
  return digest.slice(0, 16);
}

/**
 * The stored id of a guest's chat messages, derived from the client address
 * and the typed name so that a reload keeps the same bubble colour.
 *
 * Keyed with APP_SECRET, like `senderColourKey`: the id is stored in plain
 * text with every message until the event's retention ends, and a reversible
 * encoding of the address would keep the guest's IP in the database for that
 * long. The prefix separates this use of the secret from the others.
 */
export function guestSenderId(ip: string, name: string): string {
  const input = `chat-guest-id:${ip}:${name}`;
  const secret = process.env.APP_SECRET;
  const digest = secret
    ? createHmac('sha256', secret).update(input).digest('hex')
    : createHash('sha256').update(input).digest('hex');
  return `guest-${digest.slice(0, 24)}`;
}
