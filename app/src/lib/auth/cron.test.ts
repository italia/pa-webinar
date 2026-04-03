import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { UnauthorizedError } from '@/lib/errors';

import { assertCronApiKey } from './cron';

describe('assertCronApiKey', () => {
  const originalCronApiKey = process.env.CRON_API_KEY;

  beforeEach(() => {
    process.env.CRON_API_KEY = 'test-cron-key';
  });

  afterEach(() => {
    if (originalCronApiKey === undefined) {
      delete process.env.CRON_API_KEY;
      return;
    }

    process.env.CRON_API_KEY = originalCronApiKey;
  });

  it('accepts requests authenticated via x-api-key', () => {
    const request = new Request('http://localhost/api/cron/reminders', {
      headers: { 'x-api-key': 'test-cron-key' },
    });

    expect(() => assertCronApiKey(request)).not.toThrow();
  });

  it('rejects bearer auth when x-api-key is missing', () => {
    const request = new Request('http://localhost/api/cron/reminders', {
      headers: { Authorization: 'Bearer test-cron-key' },
    });

    expect(() => assertCronApiKey(request)).toThrow(UnauthorizedError);
  });

  it('rejects requests when the configured cron key is missing', () => {
    delete process.env.CRON_API_KEY;

    const request = new Request('http://localhost/api/cron/reminders', {
      headers: { 'x-api-key': 'test-cron-key' },
    });

    expect(() => assertCronApiKey(request)).toThrow(UnauthorizedError);
  });
});
