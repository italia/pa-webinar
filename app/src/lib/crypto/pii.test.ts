import { describe, it, expect, beforeAll } from 'vitest';
import { encryptPII, decryptPII, hashEmail } from './pii';

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
    // Flip a character in the base64
    const tampered = encrypted.slice(0, 10) + 'X' + encrypted.slice(11);
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
