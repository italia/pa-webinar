import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { event: { count: mocks.count } } }));

import { __resetProbeCache } from '@/lib/status/probes';

import {
  CAPTIONS_COMPONENT_STATUS,
  CAPTIONS_NODE_STATUS,
  captionsStateFrom,
  fetchCaptionsGateway,
  getCaptionsStatus,
  type CaptionsGatewayStatus,
} from './captions';

const gateway = (state: CaptionsGatewayStatus['state']): CaptionsGatewayStatus => ({
  state, engine: 'up', activeStreams: 1, maxStreams: 4, streamLimit: 4, lagP95Ms: 80, pausedUntil: null, conferences: 1,
});

describe('captionsStateFrom', () => {
  it('senza servizio installato o spenti nell’istanza non guarda altro', () => {
    expect(captionsStateFrom({ installed: false, siteEnabled: true, expected: true, gateway: gateway('ok') })).toBe('not_installed');
    expect(captionsStateFrom({ installed: true, siteEnabled: false, expected: true, gateway: gateway('ok') })).toBe('disabled');
  });

  it('servizio che non risponde: in avvio se un evento lo aspetta, in attesa altrimenti', () => {
    expect(captionsStateFrom({ installed: true, siteEnabled: true, expected: true, gateway: null })).toBe('starting');
    expect(captionsStateFrom({ installed: true, siteEnabled: true, expected: false, gateway: null })).toBe('standby');
  });

  it('riporta lo stato di carico del servizio', () => {
    const base = { installed: true, siteEnabled: true, expected: true };
    expect(captionsStateFrom({ ...base, gateway: gateway('ok') })).toBe('operational');
    expect(captionsStateFrom({ ...base, gateway: gateway('degraded') })).toBe('degraded');
    expect(captionsStateFrom({ ...base, gateway: gateway('paused') })).toBe('paused');
    expect(captionsStateFrom({ ...base, gateway: gateway('unavailable') })).toBe('unavailable');
  });
});

describe('getCaptionsStatus', () => {
  const ORIGINALE = process.env.CAPTIONS_STATUS_URL;
  beforeEach(() => {
    __resetProbeCache();
    mocks.count.mockReset();
  });
  afterEach(() => {
    process.env.CAPTIONS_STATUS_URL = ORIGINALE;
    vi.unstubAllGlobals();
  });

  it('senza CAPTIONS_STATUS_URL: non installato, senza sonde né query', async () => {
    delete process.env.CAPTIONS_STATUS_URL;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await getCaptionsStatus({ liveCaptionsEnabled: true })).toEqual({ state: 'not_installed' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it('legge lo stato del servizio e ne riporta carico e sospensione', async () => {
    process.env.CAPTIONS_STATUS_URL = 'http://captions:8080/status';
    mocks.count.mockResolvedValue(1);
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ...gateway('paused'), pausedUntil: Date.UTC(2026, 9, 9, 21, 0, 0) }), { status: 200 }),
    ));
    expect(await getCaptionsStatus({ liveCaptionsEnabled: true })).toEqual({
      state: 'paused',
      activeStreams: 1,
      maxStreams: 4,
      lagP95Ms: 80,
      pausedUntil: '2026-10-09T21:00:00.000Z',
    });
  });

  it('una risposta con forma sconosciuta vale come servizio che non risponde', async () => {
    process.env.CAPTIONS_STATUS_URL = 'http://captions:8080/status';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state: 'strano' }), { status: 200 })));
    expect(await fetchCaptionsGateway()).toBeNull();
  });
});

describe('mappe di stato', () => {
  it('un guasto dei sottotitoli degrada la pagina di stato, non la interrompe', () => {
    expect(CAPTIONS_COMPONENT_STATUS.unavailable).toBe('degraded');
    expect(CAPTIONS_COMPONENT_STATUS.paused).toBe('degraded');
    expect(CAPTIONS_COMPONENT_STATUS.standby).toBe('standby');
  });

  it('sulla mappa, il motore che non risponde è un nodo giù e l’avvio è in corso', () => {
    expect(CAPTIONS_NODE_STATUS.unavailable).toBe('down');
    expect(CAPTIONS_NODE_STATUS.starting).toBe('scaling');
    expect(CAPTIONS_NODE_STATUS.operational).toBe('healthy');
  });
});
