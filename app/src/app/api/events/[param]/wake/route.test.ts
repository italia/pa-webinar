/**
 * POST /api/events/[slug]/wake
 *
 * Con lo scaler, scalda la sala (PUBLISHED/IDLE → PROVISIONING) come sempre.
 * Senza, un evento PUBLISHED resta PUBLISHED: nessuno lo porterebbe da
 * PROVISIONING a LIVE, e un PROVISIONING incagliato nascondeva al moderatore
 * l'avvio e rifiutava il token a tutti.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  scalerDriverActive: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { event: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } },
}));
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({ jvbPreScaleMinutes: 15, waitingRoomLeadMinutes: 15 })),
}));
vi.mock('@/lib/events/lifecycle-driver', () => ({
  scalerDriverActive: mocks.scalerDriverActive,
}));

import { POST } from './route';

const MIN = 60_000;
let n = 0;

function evento(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: 'evt-1',
    status: 'PUBLISHED',
    startsAt: new Date(now + 5 * MIN),
    endsAt: new Date(now + 65 * MIN),
    eventType: 'SCHEDULED',
    provisioningStartedAt: null,
    ...over,
  };
}

async function sveglia() {
  // Uno slug diverso per chiamata: il limite per IP è per evento.
  const slug = `evento-${++n}`;
  const req = new Request(`http://localhost/api/events/${slug}/wake`, { method: 'POST' });
  const res = await POST(req as unknown as Parameters<typeof POST>[0], {
    params: Promise.resolve({ param: slug }),
  });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe('POST /wake senza scaler', () => {
  beforeEach(() => mocks.scalerDriverActive.mockResolvedValue(false));

  it('un evento PUBLISHED resta PUBLISHED: 200 con lo stato com\'è', async () => {
    mocks.findUnique.mockResolvedValue(evento());

    const r = await sveglia();

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'PUBLISHED', provisioningStartedAt: null, alreadyProvisioning: false });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('nemmeno ore prima risponde 409: non c\'è niente da scaldare', async () => {
    mocks.findUnique.mockResolvedValue(evento({ startsAt: new Date(Date.now() + 300 * MIN), endsAt: new Date(Date.now() + 360 * MIN) }));

    const r = await sveglia();

    expect(r.status).toBe(200);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('un evento già LIVE resta la no-op di sempre', async () => {
    mocks.findUnique.mockResolvedValue(evento({ status: 'LIVE' }));

    const r = await sveglia();

    expect(r.body).toMatchObject({ status: 'LIVE', alreadyProvisioning: true });
  });

  it('un evento finito resta 409', async () => {
    mocks.findUnique.mockResolvedValue(evento({ endsAt: new Date(Date.now() - MIN) }));

    expect((await sveglia()).status).toBe(409);
  });
});

describe('POST /wake con lo scaler', () => {
  beforeEach(() => mocks.scalerDriverActive.mockResolvedValue(true));

  it('scalda la sala: PUBLISHED → PROVISIONING', async () => {
    mocks.findUnique.mockResolvedValue(evento());

    const r = await sveglia();

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'PROVISIONING', alreadyProvisioning: false });
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROVISIONING' }) }),
    );
  });

  it('troppo presto: 409 come sempre', async () => {
    mocks.findUnique.mockResolvedValue(evento({ startsAt: new Date(Date.now() + 300 * MIN), endsAt: new Date(Date.now() + 360 * MIN) }));

    expect((await sveglia()).status).toBe(409);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
