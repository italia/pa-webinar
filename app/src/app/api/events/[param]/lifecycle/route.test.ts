/**
 * GET /api/events/[slug]/lifecycle — la fase del warm-up.
 *
 * Senza scaler il bridge è fisso e non c'è un'accensione da stimare: la fase
 * 'scheduled' fa dire alla sala d'attesa che si apre all'orario d'inizio o
 * all'avvio del moderatore, invece di «meno di un minuto… 3–5 minuti».
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  scalerDriverActive: vi.fn(),
  readJvbSnapshot: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: { event: { findUnique: mocks.findUnique } } }));
vi.mock('@/lib/events/lifecycle-driver', () => ({
  scalerDriverActive: mocks.scalerDriverActive,
}));
vi.mock('@/lib/jvb-snapshot', () => ({ readJvbSnapshot: mocks.readJvbSnapshot }));

import { GET } from './route';

const MIN = 60_000;

function evento(status: string) {
  const now = Date.now();
  return {
    id: 'evt-1',
    status,
    startsAt: new Date(now + 5 * MIN),
    endsAt: new Date(now + 65 * MIN),
    provisioningStartedAt: new Date(now - MIN),
    lastActiveAt: null,
  };
}

async function leggi() {
  const req = new Request('http://localhost/api/events/evento/lifecycle');
  const res = await GET(req as unknown as Parameters<typeof GET>[0], {
    params: Promise.resolve({ param: 'evento' }),
  });
  return res.json();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readJvbSnapshot.mockResolvedValue(null);
});

describe('GET /lifecycle', () => {
  it('senza scaler, in preparazione: fase scheduled, nessun cronometro, nessuna lettura dello snapshot', async () => {
    mocks.scalerDriverActive.mockResolvedValue(false);
    mocks.findUnique.mockResolvedValue(evento('PROVISIONING'));

    const body = await leggi();

    expect(body.jvb).toMatchObject({ phase: 'scheduled', startedAt: null });
    expect(mocks.readJvbSnapshot).not.toHaveBeenCalled();
  });

  it('con lo scaler e nessuno snapshot: la fase storica queued, col cronometro', async () => {
    mocks.scalerDriverActive.mockResolvedValue(true);
    mocks.findUnique.mockResolvedValue(evento('PROVISIONING'));

    const body = await leggi();

    expect(body.jvb.phase).toBe('queued');
    expect(body.jvb.startedAt).not.toBeNull();
  });

  it('fuori dal warm-up non c\'è telemetria e non si chiede chi conduce', async () => {
    mocks.findUnique.mockResolvedValue(evento('PUBLISHED'));

    const body = await leggi();

    expect(body.jvb).toBeUndefined();
    expect(mocks.scalerDriverActive).not.toHaveBeenCalled();
  });
});
