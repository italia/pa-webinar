import { createHmac, timingSafeEqual } from 'crypto';

import { requireAppSecret } from '@/lib/auth/app-secret';

/**
 * Signed token for unauthenticated rubrica opt-out links.
 *
 * Format: `<base64url-payload>.<base64url-signature>`, where the payload
 * is `<personId>:<issuedAt-seconds>`. Tokens are valid for 90 days —
 * long enough that a stale email link still works, short enough that
 * a leaked token is not a permanent liability.
 *
 * We intentionally avoid JWT here: this is a single-purpose token, the
 * extra algorithm headers give attackers more surface, and the email
 * lives forever in an inbox.
 */

const TOKEN_TTL_SECONDS = 90 * 86400;

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function issueRubricaOptOutToken(personId: string, now: Date = new Date()): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payloadRaw = `${personId}:${issuedAt}`;
  const payload = b64urlEncode(Buffer.from(payloadRaw, 'utf8'));
  const sig = createHmac('sha256', requireAppSecret()).update(payload).digest();
  return `${payload}.${b64urlEncode(sig)}`;
}

export function verifyRubricaOptOutToken(
  token: string,
  now: Date = new Date(),
): { personId: string } | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  let expected: Buffer;
  try {
    expected = createHmac('sha256', requireAppSecret()).update(payload).digest();
  } catch {
    return null;
  }
  const provided = b64urlDecode(providedSig);
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  const payloadRaw = b64urlDecode(payload).toString('utf8');
  const [personId, issuedAtStr] = payloadRaw.split(':');
  if (!personId || !issuedAtStr) return null;

  const issuedAt = parseInt(issuedAtStr, 10);
  if (!Number.isFinite(issuedAt)) return null;
  const age = Math.floor(now.getTime() / 1000) - issuedAt;
  if (age < 0 || age > TOKEN_TTL_SECONDS) return null;

  return { personId };
}
