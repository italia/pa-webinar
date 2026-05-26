import { createHmac, timingSafeEqual } from 'crypto';

import { requireAppSecret } from '@/lib/auth/app-secret';

/**
 * HMAC-signed token used to gate unauthenticated GDPR data-subject
 * requests (export, erasure). The token is generated server-side,
 * delivered out-of-band (email to the requester's address) and
 * verified at fulfilment time.
 *
 * Format: `<base64url-payload>.<base64url-signature>` where
 * payload = `<action>:<emailHash>:<issuedAt-seconds>`. We carry the
 * email *hash* — not the address — so a leaked token only authorises
 * fulfilment for one specific (already-hashed) subject and never lets
 * a third party recover the address.
 *
 * TTL: 1 hour. Long enough for a normal email round-trip, short
 * enough that a forwarded email cannot be re-used months later.
 */

const TOKEN_TTL_SECONDS = 60 * 60;
const GDPR_ACTIONS = ['export', 'erasure'] as const;
export type GdprAction = (typeof GDPR_ACTIONS)[number];

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(
    s.replace(/-/g, '+').replace(/_/g, '/') + pad,
    'base64',
  );
}

export function issueGdprToken(
  action: GdprAction,
  emailHash: string,
  now: Date = new Date(),
): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payloadRaw = `${action}:${emailHash}:${issuedAt}`;
  const payload = b64urlEncode(Buffer.from(payloadRaw, 'utf8'));
  const sig = createHmac('sha256', requireAppSecret())
    .update(payload)
    .digest();
  return `${payload}.${b64urlEncode(sig)}`;
}

export function verifyGdprToken(
  token: string,
  expectedAction: GdprAction,
  now: Date = new Date(),
): { emailHash: string } | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  let expected: Buffer;
  try {
    expected = createHmac('sha256', requireAppSecret())
      .update(payload)
      .digest();
  } catch {
    return null;
  }
  const provided = b64urlDecode(providedSig);
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  const payloadRaw = b64urlDecode(payload).toString('utf8');
  const parts = payloadRaw.split(':');
  if (parts.length !== 3) return null;
  const [action, emailHash, issuedAtStr] = parts;
  if (action !== expectedAction) return null;
  if (!emailHash || !issuedAtStr) return null;

  const issuedAt = parseInt(issuedAtStr, 10);
  if (!Number.isFinite(issuedAt)) return null;
  const age = Math.floor(now.getTime() / 1000) - issuedAt;
  if (age < 0 || age > TOKEN_TTL_SECONDS) return null;

  return { emailHash };
}

export const GDPR_TOKEN_TTL_SECONDS = TOKEN_TTL_SECONDS;
