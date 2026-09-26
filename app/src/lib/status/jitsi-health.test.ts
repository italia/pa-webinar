// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getJitsiHealth, worstJitsiStatus } from './jitsi-health';
import { __resetProbeCache } from './probes';

function fetchFailed(code: string): TypeError {
  const err = new TypeError('fetch failed');
  (err as TypeError & { cause: unknown }).cause = Object.assign(new Error(code), { code });
  return err;
}

/** Un `fetch` che risponde per prefisso d'indirizzo. */
function rete(risposte: Record<string, number | string>) {
  return vi.fn(async (url: string) => {
    for (const [prefisso, esito] of Object.entries(risposte)) {
      if (String(url).startsWith(prefisso)) {
        if (typeof esito === 'number') return new Response('x', { status: esito });
        throw fetchFailed(esito);
      }
    }
    throw fetchFailed('ENOTFOUND');
  });
}

const INTERNI = {
  NEXT_PUBLIC_JITSI_DOMAIN: 'jitsi.example.test',
  JITSI_WEB_INTERNAL_URL: 'http://rel-jitsi-meet-web',
  PROSODY_INTERNAL_URL: 'http://rel-jitsi-meet-prosody:5280',
  JICOFO_HEALTH_URL: 'http://rel-jicofo-rest:8888/',
};

beforeEach(() => {
  __resetProbeCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getJitsiHealth — Jitsi incluso, indirizzi interni', () => {
  it('ogni componente ha la sua sonda, e il certificato pubblico non conta', async () => {
    const fetchMock = rete({
      'http://rel-jitsi-meet-web/external_api.js': 200,
      'http://rel-jitsi-meet-prosody:5280/http-bind': 200,
      'http://rel-jicofo-rest:8888/about/version': 200,
      // Se qualcuno interrogasse l'indirizzo pubblico, fallirebbe.
      'https://jitsi.example.test': 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
    vi.stubGlobal('fetch', fetchMock);

    const h = await getJitsiHealth(INTERNI);

    expect(h.web).toMatchObject({ status: 'operational', via: 'internal' });
    expect(h.prosody).toMatchObject({ status: 'operational', via: 'internal' });
    expect(h.jicofo).toMatchObject({ status: 'operational', via: 'internal' });
    const chiamati = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(chiamati.some((u) => u.startsWith('https://jitsi.example.test'))).toBe(false);
    // /about/health risponde solo con i controlli di salute accesi.
    expect(chiamati).toContain('http://rel-jicofo-rest:8888/about/version');
  });

  it('Prosody giù non trascina la sala web, e viceversa', async () => {
    vi.stubGlobal(
      'fetch',
      rete({
        'http://rel-jitsi-meet-web/': 200,
        'http://rel-jitsi-meet-prosody:5280/': 'ECONNREFUSED',
        'http://rel-jicofo-rest:8888/': 503,
      }),
    );

    const h = await getJitsiHealth(INTERNI);

    expect(h.web.status).toBe('operational');
    expect(h.prosody).toMatchObject({ status: 'outage', details: 'ECONNREFUSED' });
    // Ha risposto, ma con un errore: c'è, e non sta bene.
    expect(h.jicofo).toMatchObject({ status: 'degraded', details: 'HTTP 503' });
  });
});

describe('getJitsiHealth — senza indirizzi interni (Compose, Jitsi esterno)', () => {
  const PUBBLICO = { NEXT_PUBLIC_JITSI_DOMAIN: 'jitsi.example.test' };

  it('un certificato che il server non riconosce è «degradato» col codice, non un’interruzione', async () => {
    vi.stubGlobal('fetch', rete({ 'https://jitsi.example.test': 'DEPTH_ZERO_SELF_SIGNED_CERT' }));

    const h = await getJitsiHealth(PUBBLICO);

    expect(h.web).toMatchObject({
      status: 'degraded',
      via: 'public',
      details: 'DEPTH_ZERO_SELF_SIGNED_CERT',
      publicCheckFailed: true,
    });
    // Prosody ha la sua sonda (BOSH attraverso la sala), con lo stesso esito.
    expect(h.prosody).toMatchObject({ status: 'degraded', publicCheckFailed: true });
  });

  it('un nome che non si risolve dal server è «degradato», non un’interruzione', async () => {
    vi.stubGlobal('fetch', rete({ 'https://jitsi.example.test': 'ENOTFOUND' }));
    const h = await getJitsiHealth(PUBBLICO);
    expect(h.web).toMatchObject({ status: 'degraded', details: 'ENOTFOUND', publicCheckFailed: true });
  });

  it('una sala che rifiuta la connessione resta un’interruzione, col motivo', async () => {
    vi.stubGlobal('fetch', rete({ 'https://jitsi.example.test': 'ECONNREFUSED' }));
    const h = await getJitsiHealth(PUBBLICO);
    expect(h.web).toMatchObject({ status: 'outage', details: 'ECONNREFUSED' });
    expect(h.web.publicCheckFailed).toBeUndefined();
  });

  it('Jicofo non ha un indirizzo pubblico: senza il suo, «non monitorato»', async () => {
    vi.stubGlobal('fetch', rete({ 'https://jitsi.example.test': 200 }));
    const h = await getJitsiHealth(PUBBLICO);
    expect(h.web.status).toBe('operational');
    expect(h.prosody.status).toBe('operational');
    expect(h.jicofo).toMatchObject({ status: 'unknown', via: 'none', details: 'Not monitored' });
  });

  it('un dominio locale si interroga in http', async () => {
    const fetchMock = rete({ 'http://localhost:8443': 200 });
    vi.stubGlobal('fetch', fetchMock);
    await getJitsiHealth({ NEXT_PUBLIC_JITSI_DOMAIN: 'localhost:8443' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/^http:\/\/localhost:8443\//);
  });
});

describe('getJitsiHealth — esiti riusati', () => {
  it('N richieste ravvicinate fanno una sonda sola per componente', async () => {
    const fetchMock = rete({ 'http://rel-': 200 });
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([getJitsiHealth(INTERNI), getJitsiHealth(INTERNI), getJitsiHealth(INTERNI)]);
    await getJitsiHealth(INTERNI);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('worstJitsiStatus', () => {
  it('interruzione > rallentato > operativo > ignoto', () => {
    expect(worstJitsiStatus('operational', 'outage')).toBe('outage');
    expect(worstJitsiStatus('degraded', 'operational')).toBe('degraded');
    expect(worstJitsiStatus('unknown', 'operational')).toBe('operational');
    expect(worstJitsiStatus('unknown', 'unknown')).toBe('unknown');
  });
});
