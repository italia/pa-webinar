import { createHmac, timingSafeEqual } from 'crypto';

import { requireAppSecret } from '@/lib/auth/app-secret';

/**
 * Signed capability token for chat attachments.
 *
 * The upload route (`POST /chat/attachment`) writes the blob and mints one of
 * these; the message route (`POST /chat`) accepts ONLY this token — never a
 * client-supplied URL or metadata — and derives the storage key, mime, size and
 * filename from the *signed* payload. This is the ownership binding that stops a
 * member from (a) referencing an arbitrary existing `assets/…` blob (which
 * moderation-hide or retention cleanup would then delete) or (b) claiming a
 * different mime/size than the bytes actually stored.
 *
 * Format mirrors the rubrica opt-out token: `<b64url(payload)>.<b64url(sig)>`,
 * where payload is a compact JSON object and sig is HMAC-SHA256 over the encoded
 * payload. The token is bound to the issuing event + sender and expires quickly
 * (long enough to finish composing a message, short enough that a leaked token
 * is not a lasting liability). No JWT: single purpose, smaller attack surface.
 */

const TOKEN_TTL_SECONDS = 30 * 60; // 30 min to compose + send after upload

export interface ChatAttachmentClaims {
  /** Storage key under the files domain, e.g. `assets/image/2026/07/uuid.png`. */
  key: string;
  mime: string;
  size: number;
  /** Sanitized original filename. */
  name: string;
  eventId: string;
  senderId: string;
}

interface TokenPayload {
  k: string;
  m: string;
  s: number;
  n: string;
  e: string;
  u: string;
  x: number; // expiry, unix seconds
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function issueChatAttachmentToken(
  claims: ChatAttachmentClaims,
  now: Date = new Date()
): string {
  const payload: TokenPayload = {
    k: claims.key,
    m: claims.mime,
    s: claims.size,
    n: claims.name,
    e: claims.eventId,
    u: claims.senderId,
    x: Math.floor(now.getTime() / 1000) + TOKEN_TTL_SECONDS,
  };
  const encoded = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = createHmac('sha256', requireAppSecret()).update(encoded).digest();
  return `${encoded}.${b64urlEncode(sig)}`;
}

/**
 * Verify a token and return its claims, or null if the signature is invalid, the
 * token is expired, or it was NOT issued to this exact (eventId, senderId). The
 * caller-binding check is what prevents replaying another member's token.
 */
export function verifyChatAttachmentToken(
  token: string,
  expected: { eventId: string; senderId: string },
  now: Date = new Date()
): ChatAttachmentClaims | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  let expectedSig: Buffer;
  try {
    expectedSig = createHmac('sha256', requireAppSecret()).update(encoded).digest();
  } catch {
    return null;
  }
  const provided = b64urlDecode(providedSig);
  if (provided.length !== expectedSig.length) return null;
  if (!timingSafeEqual(provided, expectedSig)) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(encoded).toString('utf8')) as TokenPayload;
  } catch {
    return null;
  }
  if (
    typeof payload.k !== 'string' ||
    typeof payload.m !== 'string' ||
    typeof payload.s !== 'number' ||
    typeof payload.n !== 'string' ||
    typeof payload.e !== 'string' ||
    typeof payload.u !== 'string' ||
    typeof payload.x !== 'number'
  ) {
    return null;
  }
  // Bind to the caller: the token must have been minted for THIS event + sender.
  if (payload.e !== expected.eventId || payload.u !== expected.senderId) return null;
  // Expiry.
  if (payload.x < Math.floor(now.getTime() / 1000)) return null;

  return {
    key: payload.k,
    mime: payload.m,
    size: payload.s,
    name: payload.n,
    eventId: payload.e,
    senderId: payload.u,
  };
}
