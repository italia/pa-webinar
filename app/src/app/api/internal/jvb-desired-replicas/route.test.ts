/**
 * GET /api/internal/jvb-desired-replicas — lo scaler dei bridge.
 *
 * Le transizioni stanno in lib/events/lifecycle-tick (modo 'scaler', con i
 * suoi test). Qui si fissa il contratto della rotta: passa al giro ciò che lo
 * scaler ha misurato, restituisce le transizioni con la forma di sempre,
 * avvisa il registratore quando apre una sala e scrive il battito che fa da
 * parte il giro a bridge fisso.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runLifecycleTick: vi.fn(),
  dispatchRecorder: vi.fn(),
  probeBridge: vi.fn(),
  recordScalerHeartbeat: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('@/lib/events/lifecycle-tick', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    runLifecycleTick: mocks.runLifecycleTick,
    dispatchRecorder: mocks.dispatchRecorder,
    probeBridge: mocks.probeBridge,
  };
});
vi.mock('@/lib/events/lifecycle-driver', () => ({
  recordScalerHeartbeat: mocks.recordScalerHeartbeat,
}));
vi.mock('@/lib/db', () => ({ prisma: { event: { findMany: mocks.findMany } } }));
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({
    jvbInactiveGraceMinutes: 45,
    jvbPreScaleMinutes: 15,
    jvbEmptyCloseMinutes: -1,
    eventGracePeriodMinutes: 15,
    jvbStressWarnPercent: 50,
    jvbStressCriticalPercent: 70,
  })),
}));

import { GET } from './route';

const KEY = 'chiave-cron';
const ORIGINALE = process.env.CRON_API_KEY;

const transizioni = {
  liveRefreshed: 1,
  liveEmptyClosed: 0,
  liveToIdle: 0,
  toEnded: 0,
  publishedToProvisioning: 0,
  provisioningToLive: 0,
};

function chiama(query = '') {
  const req = new Request(`http://localhost/api/internal/jvb-desired-replicas${query}`, {
    headers: { 'x-api-key': KEY },
  });
  return GET(req as unknown as Parameters<typeof GET>[0], { params: Promise.resolve({}) });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_API_KEY = KEY;
  mocks.findMany.mockResolvedValue([]);
  mocks.probeBridge.mockResolvedValue({ participants: 0, conferences: 0, stressLevel: 0, reachable: true });
  mocks.runLifecycleTick.mockResolvedValue({ transitions: transizioni, changes: [], sessionsRepaired: 0 });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.env.CRON_API_KEY = ORIGINALE;
  vi.restoreAllMocks();
});

describe('GET /api/internal/jvb-desired-replicas', () => {
  it('passa al giro, in modo scaler, le misure aggregate dello scaler', async () => {
    await chiama('?current=2&ready=2&pollSuccesses=2&participants=7&conferences=1');

    expect(mocks.probeBridge).not.toHaveBeenCalled();
    expect(mocks.runLifecycleTick).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'scaler',
        jvbReachable: true,
        participants: 7,
        scalerAggregated: true,
        currentReplicas: 2,
        windows: { inactiveGraceMin: 45, preScaleMin: 15, emptyCloseMin: -1, siteGrace: 15 },
      }),
    );
  });

  it('senza aggregazione sonda il bridge da sé', async () => {
    mocks.probeBridge.mockResolvedValue({ participants: 3, conferences: 1, stressLevel: 0, reachable: false });

    await chiama('?current=1&ready=1');

    expect(mocks.probeBridge).toHaveBeenCalledTimes(1);
    expect(mocks.runLifecycleTick.mock.calls[0]![0]).toMatchObject({
      jvbReachable: false,
      participants: 3,
      scalerAggregated: false,
      currentReplicas: 1,
    });
  });

  it('restituisce le transizioni con la forma di sempre e scrive il battito', async () => {
    const body = await (await chiama()).json();

    expect(body.transitions).toEqual(transizioni);
    expect(body.inactiveGraceMinutes).toBe(45);
    expect(body.preScaleMinutes).toBe(15);
    expect(mocks.recordScalerHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('avvisa il registratore solo quando una sala passa a LIVE', async () => {
    await chiama();
    expect(mocks.dispatchRecorder).not.toHaveBeenCalled();

    mocks.runLifecycleTick.mockResolvedValue({
      transitions: { ...transizioni, provisioningToLive: 1 },
      changes: [],
      sessionsRepaired: 0,
    });
    await chiama();
    expect(mocks.dispatchRecorder).toHaveBeenCalledTimes(1);
  });

  it('senza chiave cron non gira e non scrive il battito', async () => {
    const req = new Request('http://localhost/api/internal/jvb-desired-replicas');
    const r = await GET(req as unknown as Parameters<typeof GET>[0], { params: Promise.resolve({}) });

    expect(r.status).toBe(401);
    expect(mocks.runLifecycleTick).not.toHaveBeenCalled();
    expect(mocks.recordScalerHeartbeat).not.toHaveBeenCalled();
  });
});
