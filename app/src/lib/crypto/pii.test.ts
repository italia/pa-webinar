import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import {
  encryptPII,
  decryptPII,
  encryptPIIOrNull,
  encryptJSON,
  hashEmail,
  tryDecryptJSON,
  tryDecryptPII,
} from './pii';

const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = TEST_KEY;
  process.env.APP_SECRET = 'test-app-secret';
});

// ── encryptPII / decryptPII ─────────────────────────────────

describe('encryptPII + decryptPII', () => {
  it('round-trips plain text', () => {
    const original = 'mario.rossi@example.com';
    const encrypted = encryptPII(original);
    const decrypted = decryptPII(encrypted);
    expect(decrypted).toBe(original);
  });

  it('encrypted text differs from original', () => {
    const original = 'mario.rossi@example.com';
    const encrypted = encryptPII(original);
    expect(encrypted).not.toBe(original);
  });

  it('produces different ciphertext for different inputs', () => {
    const a = encryptPII('alice@example.com');
    const b = encryptPII('bob@example.com');
    expect(a).not.toBe(b);
  });

  it('produces different ciphertext on each call (random IV)', () => {
    const a = encryptPII('same@example.com');
    const b = encryptPII('same@example.com');
    expect(a).not.toBe(b);
    // But both decrypt to the same value
    expect(decryptPII(a)).toBe(decryptPII(b));
  });

  it('handles empty string', () => {
    const encrypted = encryptPII('');
    expect(decryptPII(encrypted)).toBe('');
  });

  it('handles Unicode / Italian names with accents', () => {
    const names = ['François Müller', 'Città Metropolitana', 'José García'];
    for (const name of names) {
      expect(decryptPII(encryptPII(name))).toBe(name);
    }
  });

  it('handles long text', () => {
    const long = 'a'.repeat(10_000);
    expect(decryptPII(encryptPII(long))).toBe(long);
  });

  it('decryption with tampered ciphertext throws', () => {
    const encrypted = encryptPII('secret@example.com');
    // Corrupt the auth tag region by flipping bits in the raw buffer
    const buf = Buffer.from(encrypted, 'base64');
    // Auth tag starts at byte 12 (after IV)
    buf[14] = buf[14]! ^ 0xff;
    const tampered = buf.toString('base64');
    expect(() => decryptPII(tampered)).toThrow();
  });

  it('decryption with wrong key fails', () => {
    const encrypted = encryptPII('test@example.com');
    // Change key to a different 32-byte key
    process.env.PII_ENCRYPTION_KEY =
      'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    expect(() => decryptPII(encrypted)).toThrow();
    // Restore
    process.env.PII_ENCRYPTION_KEY = TEST_KEY;
  });
});

// ── hashEmail ───────────────────────────────────────────────

describe('hashEmail', () => {
  it('is deterministic', () => {
    expect(hashEmail('user@test.com')).toBe(hashEmail('user@test.com'));
  });

  it('is case insensitive', () => {
    expect(hashEmail('User@Test.COM')).toBe(hashEmail('user@test.com'));
  });

  it('trims whitespace', () => {
    expect(hashEmail('  user@test.com  ')).toBe(hashEmail('user@test.com'));
  });

  it('different emails → different hashes', () => {
    expect(hashEmail('a@test.com')).not.toBe(hashEmail('b@test.com'));
  });

  it('returns 64-char hex (HMAC-SHA-256 with APP_SECRET)', () => {
    expect(hashEmail('test@example.com')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses HMAC when APP_SECRET is set', () => {
    const withSecret = hashEmail('test@example.com');
    // Remove APP_SECRET and hash again
    const saved = process.env.APP_SECRET;
    delete process.env.APP_SECRET;
    const withoutSecret = hashEmail('test@example.com');
    process.env.APP_SECRET = saved;
    // HMAC and plain SHA-256 should produce different results
    expect(withSecret).not.toBe(withoutSecret);
  });
});

describe('tryDecryptPII', () => {
  it('returns null for null/undefined', () => {
    expect(tryDecryptPII(null)).toBeNull();
    expect(tryDecryptPII(undefined)).toBeNull();
  });

  it('returns plaintext input as-is (legacy row)', () => {
    expect(tryDecryptPII('mario.rossi@example.com')).toBe(
      'mario.rossi@example.com',
    );
    expect(tryDecryptPII('short')).toBe('short');
  });

  it('decrypts ciphertext produced by encryptPII', () => {
    const original = 'someone.long.name@dipartimento.gov.it';
    const ciphertext = encryptPII(original);
    expect(tryDecryptPII(ciphertext)).toBe(original);
  });

  it('returns input unchanged on bogus ciphertext', () => {
    const bogus = 'AAAA'.repeat(15); // long enough, looks base64ish, no '@'
    expect(tryDecryptPII(bogus)).toBe(bogus);
  });
});

describe('encryptJSON + tryDecryptJSON', () => {
  it('round-trips an array of objects (CallSession.participants shape)', () => {
    const participants = [
      { id: 'abc', displayName: 'Mario Rossi', joinedAt: 1700000000 },
      { id: 'def', displayName: 'Anna Bianchi', joinedAt: 1700000010 },
    ];
    const wrapped = encryptJSON(participants);
    // Storage shape: a JSONB-safe wrapper object, not the array itself
    expect(Array.isArray(wrapped)).toBe(false);
    expect(typeof wrapped.enc).toBe('string');
    expect(wrapped.enc).not.toContain('Mario');

    const decrypted = tryDecryptJSON(wrapped);
    expect(decrypted).toEqual(participants);
  });

  it('round-trips an empty array', () => {
    const wrapped = encryptJSON([]);
    expect(tryDecryptJSON(wrapped)).toEqual([]);
  });

  it('passes legacy plaintext arrays through unchanged (dual-read)', () => {
    const legacy = [{ id: 'abc', displayName: 'Legacy User' }];
    // Simulates a JSONB column written before encryption was enabled
    expect(tryDecryptJSON(legacy)).toEqual(legacy);
  });

  it('returns the fallback for null / undefined', () => {
    expect(tryDecryptJSON(null)).toBeNull();
    expect(tryDecryptJSON(undefined)).toBeNull();
    expect(tryDecryptJSON(null, [])).toEqual([]);
    expect(tryDecryptJSON(undefined, [])).toEqual([]);
  });

  it('returns input untouched on bogus enc payload', () => {
    const bogus = { enc: 'not-real-ciphertext' };
    expect(tryDecryptJSON(bogus)).toEqual(bogus);
  });

  it('does not treat unrelated objects as encrypted wrappers', () => {
    const obj = { displayName: 'looks-like-data', count: 3 };
    expect(tryDecryptJSON(obj)).toEqual(obj);
  });

  it('handles unicode payloads', () => {
    const payload = { name: 'François Müller', city: 'Città' };
    expect(tryDecryptJSON(encryptJSON(payload))).toEqual(payload);
  });
});

describe('encryptPIIOrNull', () => {
  it('returns null for null/undefined/empty/whitespace', () => {
    expect(encryptPIIOrNull(null)).toBeNull();
    expect(encryptPIIOrNull(undefined)).toBeNull();
    expect(encryptPIIOrNull('')).toBeNull();
    expect(encryptPIIOrNull('   ')).toBeNull();
  });

  it('encrypts trimmed value', () => {
    const ct = encryptPIIOrNull('  test@example.com  ');
    expect(ct).not.toBeNull();
    expect(decryptPII(ct!)).toBe('test@example.com');
  });
});

// ── production placeholder-key guard ────────────────────────
// vi.stubEnv handles NODE_ENV (typed read-only) and restores it via unstub.
describe('getKey production guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects the public dev placeholder key in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PII_ENCRYPTION_KEY', TEST_KEY); // the committed 0123..ef placeholder
    expect(() => encryptPII('x')).toThrow(/placeholder/i);
  });

  it('rejects a single-nibble key (e.g. all zeros) in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PII_ENCRYPTION_KEY', '0'.repeat(64));
    expect(() => encryptPII('x')).toThrow(/placeholder/i);
  });

  it('accepts a real random key in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv(
      'PII_ENCRYPTION_KEY',
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    );
    expect(() => encryptPII('x')).not.toThrow();
  });

  it('still allows the dev placeholder outside production', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('PII_ENCRYPTION_KEY', TEST_KEY);
    expect(() => encryptPII('x')).not.toThrow();
  });
});
