/**
 * GET /api/cron/lifecycle — il giro a bridge fisso.
 *
 * Due promesse: si fa da parte quando lo scaler conduce (mai due conduttori
 * insieme), e altrimenti gira in modo 'fixed' con la sonda del bridge solo se
 * JVB_HEALTH_URL c'è.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  scalerDriverActive: vi.fn(),
  runLifecycleTick: vi.fn(),
  probeBridge: vi.fn(),
  dispatchRecorder: vi.fn(),
}));

vi.mock('@/lib/events/lifecycle-driver', () => ({
  scalerDriverActive: mocks.scalerDriverActive,
}));
vi.mock('@/lib/events/lifecycle-tick', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    runLifecycleTick: mocks.runLifecycleTick,
    probeBridge: mocks.probeBridge,
    dispatchRecorder: mocks.dispatchRecorder,
  };
});
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({
    jvbInactiveGraceMinutes: 45,
    jvbPreScaleMinutes: 15,
    jvbEmptyCloseMinutes: -1,
    eventGracePeriodMinutes: 15,
  })),
}));

import { GET } from './route';

const KEY = 'chiave-cron';
const ORIGINALE = { ...process.env };

function chiama(key: string | null = KEY) {
  const req = new Request('http://localhost/api/cron/lifecycle', {
    headers: key ? { 'x-api-key': key } : {},
  });
  return GET(req as unknown as Parameters<typeof GET>[0], { params: Promise.resolve({}) });
}

const zero = { liveRefreshed: 0, liveEmptyClosed: 0, toLive: 0, toEnded: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_API_KEY = KEY;
  delete process.env.JVB_HEALTH_URL;
  mocks.scalerDriverActive.mockResolvedValue(false);
  mocks.probeBridge.mockResolvedValue({ participants: 0, conferences: 0, stressLevel: 0, reachable: false });
  mocks.runLifecycleTick.mockResolvedValue({ transitions: zero, changes: [], sessionsRepaired: 0 });
});

afterEach(() => {
  process.env = { ...ORIGINALE };
});

describe('GET /api/cron/lifecycle', () => {
  it('senza chiave cron non fa nulla', async () => {
    const r = await chiama('sbagliata');
    expect(r.status).toBe(401);
    expect(mocks.runLifecycleTick).not.toHaveBeenCalled();
  });

  it('con lo scaler al comando si fa da parte', async () => {
    mocks.scalerDriverActive.mockResolvedValue(true);

    const r = await chiama();

    expect(await r.json()).toEqual({ skipped: 'scaler' });
    expect(mocks.runLifecycleTick).not.toHaveBeenCalled();
  });

  it('senza JVB_HEALTH_URL gira in modo fixed con il bridge non sondato', async () => {
    const r = await chiama();
    const body = await r.json();

    expect(r.status).toBe(200);
    expect(mocks.runLifecycleTick).toHaveBeenCalledTimes(1);
    const input = mocks.runLifecycleTick.mock.calls[0]![0];
    expect(input.mode).toBe('fixed');
    expect(input.bridge).toEqual({ probed: false, reachable: false, participants: 0 });
    expect(input.windows).toEqual({
      inactiveGraceMin: 45,
      preScaleMin: 15,
      emptyCloseMin: -1,
      siteGrace: 15,
    });
    expect(body).toMatchObject({ mode: 'fixed', bridgeProbed: false, transitions: zero });
  });

  it('con JVB_HEALTH_URL passa quel che dice la sonda', async () => {
    process.env.JVB_HEALTH_URL = 'http://jvb:8080';
    mocks.probeBridge.mockResolvedValue({ participants: 5, conferences: 1, stressLevel: 0.1, reachable: true });

    await chiama();

    expect(mocks.runLifecycleTick.mock.calls[0]![0].bridge).toEqual({
      probed: true,
      reachable: true,
      participants: 5,
    });
  });

  it('avvisa il registratore solo quando apre una sala', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await chiama();
    expect(mocks.dispatchRecorder).not.toHaveBeenCalled();

    mocks.runLifecycleTick.mockResolvedValue({
      transitions: { ...zero, toLive: 1 },
      changes: [{ id: 'e', status: 'LIVE' }],
      sessionsRepaired: 0,
    });
    await chiama();
    expect(mocks.dispatchRecorder).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
