import { createHash } from 'crypto';

/**
 * A stable, one-way key derived from a chat `senderId`, for the client.
 *
 * The raw id must never leave the server: a guest one is
 * `guest-${base64url('<ip>:<name>')}`, so it decodes straight back to the
 * attendee's public IP — a silent participant who only tapped an emoji would
 * have been handing their address to anyone reading the payload, and the chat
 * export would have written it into a downloadable file.
 *
 * The client's only use for it is picking a bubble colour and grouping a
 * person's messages, and a hash does both. Truncated to 16 hex chars: collision
 * risk in a room of a few hundred is negligible and the payload stays small.
 */
export function senderColourKey(senderId: string): string {
  if (!senderId) return '';
  return createHash('sha256').update(senderId).digest('hex').slice(0, 16);
}
