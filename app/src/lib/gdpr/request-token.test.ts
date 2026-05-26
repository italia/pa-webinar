import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  GDPR_TOKEN_TTL_SECONDS,
  issueGdprToken,
  verifyGdprToken,
} from './request-token';

const SECRET = 'a'.repeat(64);
const EMAIL_HASH = 'b'.repeat(64);

describe('GDPR request-token', () => {
  beforeEach(() => {
    vi.stubEnv('APP_SECRET', SECRET);
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trips an export token', () => {
    const t = issueGdprToken('export', EMAIL_HASH);
    expect(verifyGdprToken(t, 'export')).toEqual({ emailHash: EMAIL_HASH });
  });

  it('round-trips an erasure token', () => {
    const t = issueGdprToken('erasure', EMAIL_HASH);
    expect(verifyGdprToken(t, 'erasure')).toEqual({ emailHash: EMAIL_HASH });
  });

  it('rejects an export token when verifying as erasure', () => {
    const t = issueGdprToken('export', EMAIL_HASH);
    expect(verifyGdprToken(t, 'erasure')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const t = issueGdprToken('export', EMAIL_HASH);
    const [p, sig] = t.split('.');
    const tampered = `${p}x.${sig}`;
    expect(verifyGdprToken(tampered, 'export')).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const t = issueGdprToken('export', EMAIL_HASH);
    const [p, sig] = t.split('.');
    const tamperedSig = sig!.slice(0, -2) + (sig!.endsWith('aa') ? 'bb' : 'aa');
    expect(verifyGdprToken(`${p}.${tamperedSig}`, 'export')).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const t = issueGdprToken('export', EMAIL_HASH);
    vi.stubEnv('APP_SECRET', 'c'.repeat(64));
    expect(verifyGdprToken(t, 'export')).toBeNull();
  });

  it('rejects an expired token', () => {
    const past = new Date(Date.now() - (GDPR_TOKEN_TTL_SECONDS + 60) * 1000);
    const t = issueGdprToken('export', EMAIL_HASH, past);
    expect(verifyGdprToken(t, 'export')).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyGdprToken('not-a-token', 'export')).toBeNull();
    expect(verifyGdprToken('.', 'export')).toBeNull();
    expect(verifyGdprToken('', 'export')).toBeNull();
  });
});
