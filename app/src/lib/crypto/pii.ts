import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.PII_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'PII_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)',
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt PII with AES-256-GCM.
 * Output format: base64(iv + authTag + ciphertext)
 */
export function encryptPII(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypt PII encrypted with encryptPII.
 */
export function decryptPII(ciphertext: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertext, 'base64');

  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Try to decrypt a PII column that may hold either ciphertext (new
 * rows) or legacy plaintext (rows written before encryption was
 * enabled). On any decryption failure — wrong size, bad auth tag, not
 * base64 — return the input untouched so callers see the original
 * plaintext.
 *
 * Detection heuristic: legitimate ciphertext from encryptPII is at
 * least IV (12) + tag (16) + 1 byte ciphertext = 29 bytes ≈ 40 chars
 * base64. Email addresses are usually shorter and contain '@', so we
 * short-circuit on them — saves a noisy decrypt failure per read.
 */
export function tryDecryptPII(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (value.length < 40 || value.includes('@')) return value;
  try {
    return decryptPII(value);
  } catch {
    return value;
  }
}

/**
 * Encrypt a value when non-empty, otherwise pass through. Convenience
 * for write paths that previously stored plaintext into a nullable
 * column.
 */
export function encryptPIIOrNull(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return encryptPII(trimmed);
}

/**
 * HMAC-SHA-256 hash of an email (lowercased, trimmed) for deduplication.
 * Uses APP_SECRET as HMAC key to prevent rainbow table attacks.
 * Falls back to plain SHA-256 only if APP_SECRET is not set (dev mode).
 */
export function hashEmail(email: string): string {
  const normalized = email.toLowerCase().trim();
  const secret = process.env.APP_SECRET;
  if (secret) {
    return createHmac('sha256', secret)
      .update(normalized)
      .digest('hex');
  }
  return createHash('sha256')
    .update(normalized)
    .digest('hex');
}
