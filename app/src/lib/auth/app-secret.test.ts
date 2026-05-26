import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  MIN_APP_SECRET_LENGTH,
  requireAppSecret,
  requireAppSecretKey,
  tryGetAppSecret,
} from './app-secret';

describe('APP_SECRET helpers', () => {
  beforeEach(() => {
    vi.stubEnv('APP_SECRET', '');
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('tryGetAppSecret returns null when secret is missing', () => {
    vi.stubEnv('APP_SECRET', '');
    expect(tryGetAppSecret()).toBeNull();
  });

  it('tryGetAppSecret returns null when secret is too short', () => {
    vi.stubEnv('APP_SECRET', 'x'.repeat(MIN_APP_SECRET_LENGTH - 1));
    expect(tryGetAppSecret()).toBeNull();
  });

  it('tryGetAppSecret returns the secret when long enough', () => {
    const good = 'x'.repeat(MIN_APP_SECRET_LENGTH);
    vi.stubEnv('APP_SECRET', good);
    expect(tryGetAppSecret()).toBe(good);
  });

  it('requireAppSecret throws in production when secret is too short', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_SECRET', 'short');
    expect(() => requireAppSecret()).toThrowError(/at least 32 bytes/);
  });

  it('requireAppSecret tolerates short secret outside production', () => {
    vi.stubEnv('APP_SECRET', 'short');
    expect(requireAppSecret()).toBe('short');
  });

  it('requireAppSecretKey returns a Uint8Array sized to the secret length', () => {
    const good = 'x'.repeat(MIN_APP_SECRET_LENGTH);
    vi.stubEnv('APP_SECRET', good);
    const key = requireAppSecretKey();
    expect(key.byteLength).toBe(MIN_APP_SECRET_LENGTH);
    expect(typeof key.BYTES_PER_ELEMENT).toBe('number');
  });
});
