import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    liveAction: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@/lib/db';

import { GET } from './route';

const db = prisma as unknown as {
  event: { findUnique: ReturnType<typeof vi.fn> };
  liveAction: { findFirst: ReturnType<typeof vi.fn> };
};

const ctx = { params: Promise.resolve({ param: 'evento' }) };
const req = () => new Request('https://portale.example.test/api/events/evento/flags?orologio=registrazione');

beforeEach(() => {
  vi.clearAllMocks();
  db.event.findUnique.mockResolvedValue({
    id: 'e1',
    qaEnabled: true,
    chatEnabled: true,
    agendaEnabled: false,
    wordCloudEnabled: false,
    recordingEnabled: true,
  });
});

describe('GET /api/events/[slug]/flags — avvio della registrazione', () => {
  it('l’ultima voce è un avvio: ne restituisce l’ora, senza l’id dell’evento', async () => {
    db.liveAction.findFirst.mockResolvedValue({ kind: 'recording.started', at: new Date('2026-10-09T09:10:00Z') });
    const body = await (await GET(req() as never, ctx as never)).json();
    expect(body.recordingStartedAt).toBe('2026-10-09T09:10:00.000Z');
    expect(body).not.toHaveProperty('id');
    expect(body.qaEnabled).toBe(true);
  });

  it('dopo un arresto, o senza voci, è null', async () => {
    db.liveAction.findFirst.mockResolvedValue({ kind: 'recording.stopped', at: new Date() });
    expect((await (await GET(req() as never, ctx as never)).json()).recordingStartedAt).toBeNull();
    db.liveAction.findFirst.mockResolvedValue(null);
    expect((await (await GET(req() as never, ctx as never)).json()).recordingStartedAt).toBeNull();
  });

  it('senza la richiesta dell’orologio non legge la cronologia', async () => {
    const res = await GET(new Request('https://portale.example.test/api/events/evento/flags') as never, ctx as never);
    const body = await res.json();
    expect(body).not.toHaveProperty('recordingStartedAt');
    expect(db.liveAction.findFirst).not.toHaveBeenCalled();
  });
});
