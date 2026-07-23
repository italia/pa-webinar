import { describe, it, expect, afterEach } from 'vitest';

import { appBaseUrl } from './env';

const ORIG = process.env.NEXT_PUBLIC_APP_URL;
afterEach(() => {
  if (ORIG === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = ORIG;
});

describe('appBaseUrl', () => {
  it('restituisce l’URL per un http(s) valido', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://eventi.gov.it';
    expect(appBaseUrl()?.origin).toBe('https://eventi.gov.it');
  });

  it('null su un URL senza schema, invece di lanciare', () => {
    // È il misconfig che faceva 500 tre route diverse. Deve degradare, non
    // rompere.
    process.env.NEXT_PUBLIC_APP_URL = 'webinar.gov.it';
    expect(appBaseUrl()).toBeNull();
  });

  it('null su uno schema non http(s)', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'file:///etc/passwd';
    expect(appBaseUrl()).toBeNull();
  });
});
