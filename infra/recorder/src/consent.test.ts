import { describe, expect, it, vi } from 'vitest';

import { makeConsentCheck } from './consent.js';

const risposta = (record: boolean) => new Response(JSON.stringify({ record }), { status: 200 });

describe('makeConsentCheck', () => {
  it('chiede al portale per evento ed endpoint, con la chiave', async () => {
    const fetchImpl = vi.fn(async () => risposta(true));
    const check = makeConsentCheck({ portalUrl: 'http://portale', cronApiKey: 'k', eventId: 'ev', fetchImpl });
    expect(await check('ab12')).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('http://portale/api/internal/recorder/consent?eventId=ev&endpoint=ab12');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
  });

  it('un «no» si richiede: Prosody puo\' arrivare un attimo dopo la traccia', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(risposta(false)).mockResolvedValueOnce(risposta(true));
    const check = makeConsentCheck({
      portalUrl: 'http://portale', cronApiKey: 'k', eventId: 'ev', fetchImpl, sleep: async () => {},
    });
    expect(await check('ab12')).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('nel dubbio non si registra', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('giu');
    });
    const check = makeConsentCheck({
      portalUrl: 'http://portale', cronApiKey: 'k', eventId: 'ev', fetchImpl, sleep: async () => {},
    });
    expect(await check('ab12')).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('se il portale non conosce l\'endpoint lo scrive nel log', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ record: false, reason: 'unknown' }), { status: 200 }));
    const log = vi.fn();
    const check = makeConsentCheck({
      portalUrl: 'http://portale', cronApiKey: 'k', eventId: 'ev', fetchImpl, sleep: async () => {}, log,
    });
    expect(await check('ab12')).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toContain('mod_pa_occupants');
  });

  it('un «no» di chi e\' riconosciuto non va nel log', async () => {
    const fetchImpl = vi.fn(async () => risposta(false));
    const log = vi.fn();
    const check = makeConsentCheck({
      portalUrl: 'http://portale', cronApiKey: 'k', eventId: 'ev', fetchImpl, sleep: async () => {}, log,
    });
    expect(await check('ab12')).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });
});
