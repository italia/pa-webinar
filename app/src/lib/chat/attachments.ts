/**
 * Chat attachment helpers: the MIME allow-list + size cap shared by the upload
 * route and the message POST validation, plus safe conversions between the
 * app-served asset URL and the storage key.
 *
 * Attachments are stored in the "files" storage domain under the same
 * `assets/…` prefix as other uploads and served (with nosniff +
 * attachment-for-active-document hardening) by /api/assets/[...path]. We keep
 * the storage key on the ChatMessage row so retention/moderation can delete
 * the blob. Only authenticated members may upload (see the upload route);
 * tokenless guests never can.
 */

import { tryDecryptPII } from '@/lib/crypto/pii';
import type { ChatAttachmentRef } from '@/lib/chat/pubsub';

// Conservative allow-list: images a chat naturally shares, plus PDF handouts.
// No SVG (active document) and no Office/archives (malware-prone, and there is
// no content scanner) — guests can't upload at all, members get this set.
export const CHAT_ATTACHMENT_MIME: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB

/** Path prefix of our own asset-serving route. */
const ASSET_PATH_PREFIX = '/api/assets/';

/**
 * Relative app-served URL for a stored blob key.
 *
 * The blob key never comes from a client URL — it is carried in a signed
 * attachment token (see attachment-token.ts) and materialised here — so there is
 * no client-URL validation to do: the server owns the key end to end.
 */
export function assetUrlFromKey(key: string): string {
  return `${ASSET_PATH_PREFIX}${key.replace(/^assets\//, '')}`;
}

/**
 * Build the wire/serialised attachment reference from a persisted row,
 * decrypting the PII filename. Returns undefined when the row has no
 * attachment.
 */
export function attachmentRefFromRow(row: {
  attachmentBlobPath: string | null;
  attachmentName: string | null;
  attachmentMime: string | null;
  attachmentSize: bigint | null;
}): ChatAttachmentRef | undefined {
  if (!row.attachmentBlobPath || !row.attachmentMime) return undefined;
  return {
    url: assetUrlFromKey(row.attachmentBlobPath),
    name: row.attachmentName
      ? tryDecryptPII(row.attachmentName) ?? row.attachmentName
      : '',
    mime: row.attachmentMime,
    size: row.attachmentSize != null ? Number(row.attachmentSize) : 0,
  };
}
