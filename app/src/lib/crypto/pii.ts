import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * The development placeholder shipped in the (now public) `.env.example` /
 * `docker-compose.yml`, plus any single-nibble key. Encrypting PII with a value
 * that is public in the repo gives no confidentiality, so in production we
 * fail closed — the same stance `APP_SECRET` already takes.
 */
function isPlaceholderKey(hex: string): boolean {
  return /^(?:0123456789abcdef){4}$/i.test(hex) || /^(.)\1{63}$/.test(hex);
}

function getKey(): Buffer {
  const hex = process.env.PII_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'PII_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)',
    );
  }
  if (process.env.NODE_ENV === 'production' && isPlaceholderKey(hex)) {
    throw new Error(
      'PII_ENCRYPTION_KEY is the public development placeholder; set a real, random 32-byte key in production',
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
 * Encrypt an arbitrary JSON-serialisable value, returning a wrapper
 * object suitable for storage in a JSONB column that previously held
 * the plaintext shape. The wrapper has a single `enc` key holding the
 * base64 ciphertext produced by `encryptPII`.
 *
 * Storing a wrapper object (instead of replacing the column type) lets
 * legacy readers detect "this is not the legacy shape" via a simple
 * `Array.isArray(value) === false` check and fall through to the
 * dual-read path (`tryDecryptJSON`).
 */
export function encryptJSON(value: unknown): { enc: string } {
  return { enc: encryptPII(JSON.stringify(value)) };
}

/**
 * Inverse of `encryptJSON`. Accepts either:
 *   - a `{ enc: "<ciphertext>" }` wrapper produced by `encryptJSON`
 *     → decrypts and JSON.parses the payload.
 *   - any other shape (legacy plaintext row, e.g. an array)
 *     → returns it untouched.
 *   - `null` / `undefined` → returns the fallback (default `null`).
 *
 * Errors during decryption or JSON.parse fall back to returning the
 * original input, mirroring `tryDecryptPII`'s "be lenient on read"
 * contract so a single bad row never breaks the admin list.
 */
export function tryDecryptJSON<T = unknown>(
  stored: unknown,
  fallback: T | null = null,
): T | null {
  if (stored == null) return fallback;
  if (
    typeof stored === 'object' &&
    stored !== null &&
    !Array.isArray(stored) &&
    'enc' in (stored as Record<string, unknown>) &&
    typeof (stored as { enc: unknown }).enc === 'string'
  ) {
    try {
      const plaintext = decryptPII((stored as { enc: string }).enc);
      return JSON.parse(plaintext) as T;
    } catch {
      return stored as T;
    }
  }
  return stored as T;
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
