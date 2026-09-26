// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn(async (): Promise<unknown[]> => []) }));
vi.mock('@/lib/db', () => ({ prisma: { event: { findMany } } }));

import {
  bridgeMode,
  fetchColibriStats,
  fetchJibriHealth,
  loadJvbDemand,
} from './bridge';
import { __resetProbeCache } from './probes';

beforeEach(() => {
  __resetProbeCache();
  findMany.mockReset();
  findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('bridgeMode', () => {
  it('lo scaler dichiarato dal chart vince su tutto', () => {
    expect(bridgeMode({ JVB_SCALER_ENABLED: 'true', JVB_HEALTH_URL: 'http://jvb:8080' })).toBe('scaler');
    expect(bridgeMode({ JVB_SCALER_ENABLED: 'true' })).toBe('scaler');
  });

  it('senza scaler, con un indirizzo del bridge: bridge fissi', () => {
    expect(bridgeMode({ JVB_SCALER_ENABLED: 'false', JVB_HEALTH_URL: 'http://jvb:8080' })).toBe('fixed');
  });

  it('senza scaler e senza indirizzo (Compose, Jitsi esterno): non monitorato', () => {
    expect(bridgeMode({ JVB_MAX_REPLICAS: '4' })).toBe('unmonitored');
    expect(bridgeMode({})).toBe('unmonitored');
  });
});

describe('fetchColibriStats', () => {
  it('risponde: le statistiche; non risponde: null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ participants: 3, healthy: true })));
    expect(await fetchColibriStats({ JVB_HEALTH_URL: 'http://jvb:8080' })).toEqual({
      participants: 3,
      healthy: true,
    });

    __resetProbeCache();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('giù'); }));
    expect(await fetchColibriStats({ JVB_HEALTH_URL: 'http://jvb:8080' })).toBeNull();
  });

  it('senza indirizzo non interroga niente', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchColibriStats({})).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('richieste ravvicinate: una sonda sola', async () => {
    const fetchMock = vi.fn(async () => Response.json({ participants: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const env = { JVB_HEALTH_URL: 'http://jvb:8080' };
    await Promise.all([fetchColibriStats(env), fetchColibriStats(env)]);
    await fetchColibriStats(env);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchJibriHealth', () => {
  it('legge salute e stato di occupazione', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ status: { busyStatus: 'BUSY', health: { healthStatus: 'HEALTHY' } } }),
      ),
    );
    expect(await fetchJibriHealth({ JIBRI_HEALTH_URL: 'http://jibri:2222' })).toEqual({
      healthy: true,
      busyStatus: 'BUSY',
    });
  });

  it('senza indirizzo o senza risposta: null', async () => {
    expect(await fetchJibriHealth({})).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })));
    expect(await fetchJibriHealth({ JIBRI_HEALTH_URL: 'http://jibri:2222' })).toBeNull();
  });
});

describe('loadJvbDemand', () => {
  const now = new Date('2026-09-01T10:00:00Z');
  const evento = (over: Record<string, unknown> = {}) => ({
    id: 'e1',
    status: 'LIVE',
    startsAt: new Date('2026-09-01T09:00:00Z'),
    provisioningStartedAt: null,
    maxParticipants: 300,
    expectedSenderRatioPct: null,
    participantsCanStartVideo: true,
    recordingEnabled: false,
    ...over,
  });

  it('nessun evento: nessun bridge richiesto', async () => {
    const d = await loadJvbDemand({}, now);
    expect(d.desired).toBe(0);
  });

  it('la stessa regola dello scaler, entro il tetto', async () => {
    vi.stubEnv('JVB_MAX_REPLICAS', '2');
    findMany.mockResolvedValue([evento()]);
    const d = await loadJvbDemand({}, now);
    // 300 posti con video al 30%: 3 bridge da 16 core, tagliati a 2.
    expect(d.desired).toBe(2);
    expect(d.maxReplicas).toBe(2);
  });

  it('interroga LIVE e PROVISIONING, più i PUBLISHED entro il pre-scale', async () => {
    await loadJvbDemand({ jvbPreScaleMinutes: 20 }, now);
    const where = (findMany.mock.calls[0] as unknown as [{ where: { OR: unknown[] } }])[0].where;
    expect(where.OR).toEqual([
      { status: { in: ['LIVE', 'PROVISIONING'] } },
      {
        status: 'PUBLISHED',
        startsAt: { lte: new Date('2026-09-01T10:20:00Z') },
        endsAt: { gte: now },
      },
    ]);
  });
});
