// @vitest-environment node
import { createHash } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import { encryptPII } from './crypto/pii';
import { gravatarHash, gravatarRef, readGravatarRef } from './gravatar-ref';

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
});

const EMAIL = 'Mario.Rossi@Example.COM';
const MD5 = createHash('md5').update('mario.rossi@example.com').digest('hex');

describe('gravatarHash', () => {
  it('normalises case and surrounding space, as Gravatar requires', () => {
    expect(gravatarHash(EMAIL)).toBe(MD5);
    expect(gravatarHash('  mario.rossi@example.com ')).toBe(MD5);
  });

  it('rejects anything that is not an address', () => {
    expect(gravatarHash('mario')).toBeNull();
    expect(gravatarHash('')).toBeNull();
  });
});

describe('gravatarRef', () => {
  it('carries the hash, never the address', () => {
    const ref = gravatarRef(EMAIL)!;
    expect(ref).not.toContain('mario');
    expect(ref).not.toContain('example.com');
    // E nemmeno l'hash in chiaro: quel valore viaggia in presenza a TUTTA la
    // sala, e un MD5 di un'email è un oracolo di re-identificazione.
    expect(ref).not.toContain(MD5);
    expect(readGravatarRef(ref)).toBe(MD5);
  });

  it('gives a different ciphertext each time (fresh IV)', () => {
    expect(gravatarRef(EMAIL)).not.toBe(gravatarRef(EMAIL));
  });

  it('refuses a junk address instead of hashing it anyway', () => {
    expect(gravatarRef('not-an-address')).toBeNull();
  });
});

describe('readGravatarRef', () => {
  it('returns null for tampered, foreign or empty input', () => {
    expect(readGravatarRef('not-base64-at-all')).toBeNull();
    expect(readGravatarRef('')).toBeNull();
    const ref = gravatarRef(EMAIL)!;
    const tampered = Buffer.from(ref, 'base64');
    tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 0xff;
    expect(readGravatarRef(tampered.toString('base64'))).toBeNull();
  });

  it('returns null when the plaintext is not a hash', () => {
    // Difesa in profondità: se un giorno qualcosa cifrasse l'email invece
    // dell'hash, il proxy non deve passarla a gravatar.com come se fosse un MD5.
    expect(readGravatarRef(encryptPII('mario.rossi@example.com'))).toBeNull();
  });
});
