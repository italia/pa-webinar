import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify an `X-Webhook-Signature: sha256=<hex>` header against the raw
 * request body using HMAC-SHA256. Used to authenticate Jibri recording
 * webhooks (and any future webhook source) where a single shared bearer
 * could be replayed against the same endpoint without proving knowledge
 * of the actual payload.
 *
 * Returns false on any parse failure, length mismatch, or signature
 * mismatch. The HMAC compare is constant-time via timingSafeEqual.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader);
  if (!m || !m[1]) return false;
  const provided = Buffer.from(m[1], 'hex');
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * Convenience helper for the producer side (or tests): generates the
 * `sha256=<hex>` header value for a payload.
 */
export function signWebhookBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}
