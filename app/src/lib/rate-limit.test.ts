import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rateLimit, getClientIp } from './rate-limit';

describe('rateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests under limit', () => {
    const key = `test-allow-${Date.now()}`;
    const r1 = rateLimit(key, { limit: 3, windowMs: 60_000 });
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = rateLimit(key, { limit: 3, windowMs: 60_000 });
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = rateLimit(key, { limit: 3, windowMs: 60_000 });
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it('blocks requests over limit', () => {
    const key = `test-block-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      rateLimit(key, { limit: 3, windowMs: 60_000 });
    }
    const result = rateLimit(key, { limit: 3, windowMs: 60_000 });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('resets after window expires', () => {
    const key = `test-reset-${Date.now()}`;
    // Exhaust the limit
    for (let i = 0; i < 3; i++) {
      rateLimit(key, { limit: 3, windowMs: 10_000 });
    }
    const blocked = rateLimit(key, { limit: 3, windowMs: 10_000 });
    expect(blocked.allowed).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(11_000);

    const afterReset = rateLimit(key, { limit: 3, windowMs: 10_000 });
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(2);
  });

  it('different keys have separate limits', () => {
    const keyA = `test-a-${Date.now()}`;
    const keyB = `test-b-${Date.now()}`;

    // Exhaust key A
    for (let i = 0; i < 2; i++) {
      rateLimit(keyA, { limit: 2, windowMs: 60_000 });
    }
    const blockedA = rateLimit(keyA, { limit: 2, windowMs: 60_000 });
    expect(blockedA.allowed).toBe(false);

    // Key B should still be allowed
    const allowedB = rateLimit(keyB, { limit: 2, windowMs: 60_000 });
    expect(allowedB.allowed).toBe(true);
  });

  it('returns resetAt in the future', () => {
    const key = `test-reset-at-${Date.now()}`;
    const result = rateLimit(key, { limit: 5, windowMs: 60_000 });
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });
});

describe('getClientIp', () => {
  it('returns X-Forwarded-For first IP', () => {
    const request = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    });
    expect(getClientIp(request)).toBe('1.2.3.4');
  });

  it('returns X-Real-IP when no forwarded', () => {
    const request = new Request('http://localhost', {
      headers: { 'x-real-ip': '10.0.0.1' },
    });
    expect(getClientIp(request)).toBe('10.0.0.1');
  });

  it('returns "unknown" when no IP headers', () => {
    const request = new Request('http://localhost');
    expect(getClientIp(request)).toBe('unknown');
  });

  it('trims whitespace from X-Forwarded-For', () => {
    const request = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '  1.2.3.4  ' },
    });
    expect(getClientIp(request)).toBe('1.2.3.4');
  });
});
