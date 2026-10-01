import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Le tracce per partecipante si cancellano dopo la trascrizione, oppure — se
 * nessuno le trascrive, come in un'installazione senza post-produzione AI —
 * alla scadenza della conservazione dei dati dell'evento.
 */
vi.mock('@/lib/db', () => ({
  prisma: { recordingTrack: { findMany: vi.fn(), update: vi.fn() }, event: { findMany: vi.fn() } },
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));
const del = vi.fn(async () => undefined);
vi.mock('@/lib/storage/postprod', () => ({
  isPostprodStorageConfigured: () => true,
  getPostprodStorage: () => ({ delete: del }),
}));

import { prisma } from '@/lib/db';

import { GET } from './route';

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  recordingTrack: { findMany: Fn; update: Fn };
  event: { findMany: Fn };
};
const ctx = { params: Promise.resolve({}) };
const req = () => new Request('https://portale.example.test/api/cron/multitrack-purge');
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

beforeEach(() => {
  vi.clearAllMocks();
  db.recordingTrack.update.mockResolvedValue({});
});

describe('GET /api/cron/multitrack-purge', () => {
  it('purges untranscribed tracks only of events past their data retention', async () => {
    db.event.findMany.mockResolvedValue([
      { id: 'e-old', status: 'ENDED', endsAt: daysAgo(40), lastActiveAt: null, dataRetentionDays: 30 },
      { id: 'e-new', status: 'ENDED', endsAt: daysAgo(5), lastActiveAt: null, dataRetentionDays: 30 },
    ]);
    db.recordingTrack.findMany
      .mockResolvedValueOnce([{ id: 't1', blobKey: 'recordings/multitrack/e/a.ogg' }])
      .mockResolvedValueOnce([{ id: 't2', blobKey: 'recordings/multitrack/e-old/b.ogg' }]);
    const body = await (await GET(req() as never, ctx as never)).json();
    expect(body).toMatchObject({ ok: true, candidates: 2, untranscribedExpired: 1, purged: 2 });
    const second = db.recordingTrack.findMany.mock.calls[1]?.[0] as {
      where: { recording: { eventId: { in: string[] } } };
      orderBy: unknown;
    };
    expect(second.where.recording.eventId.in).toEqual(['e-old']);
    expect(second.orderBy).toEqual({ createdAt: 'asc' });
    expect(del).toHaveBeenCalledWith('recordings/multitrack/e-old/b.ogg');
  });

  it('does not look for untranscribed tracks when no event has expired', async () => {
    db.event.findMany.mockResolvedValue([
      { id: 'e-live', status: 'LIVE', endsAt: daysAgo(1), lastActiveAt: null, dataRetentionDays: 30 },
    ]);
    db.recordingTrack.findMany.mockResolvedValueOnce([]);
    const body = await (await GET(req() as never, ctx as never)).json();
    expect(body).toMatchObject({ candidates: 0, purged: 0 });
    expect(db.recordingTrack.findMany).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
  });
});
