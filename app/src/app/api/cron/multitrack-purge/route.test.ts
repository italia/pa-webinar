import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Le tracce per partecipante si cancellano dopo la trascrizione, oppure — se
 * nessuno le trascrive, come in un'installazione senza post-produzione AI —
 * alla scadenza della conservazione dei dati dell'evento.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    recordingTrack: { findMany: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
    event: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));
const ritirati = vi.hoisted(() => vi.fn(async (_e: string, _ep: string[]) => new Set<string>()));
vi.mock('@/lib/captions/room', () => ({ endpointRitirati: ritirati }));
const del = vi.fn(async (_key: string) => true);
vi.mock('@/lib/storage/postprod', () => ({
  isPostprodStorageConfigured: () => true,
  getPostprodStorage: () => ({ delete: del }),
}));

import { prisma } from '@/lib/db';

import { GET } from './route';

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  recordingTrack: { findMany: Fn; update: Fn; groupBy: Fn };
  event: { findMany: Fn };
};
const ctx = { params: Promise.resolve({}) };
const req = () => new Request('https://portale.example.test/api/cron/multitrack-purge');
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

beforeEach(() => {
  vi.clearAllMocks();
  db.recordingTrack.update.mockResolvedValue({});
  db.recordingTrack.groupBy.mockResolvedValue([]);
  db.recordingTrack.findMany.mockResolvedValue([]);
});

const traccia = (id: string, eventId: string, recordingId: string) => ({
  id,
  blobKey: `recordings/multitrack/${eventId}/${recordingId}/audio/${id}.opus`,
  recordingId,
  recording: { eventId },
});

describe('GET /api/cron/multitrack-purge', () => {
  it('purges at once the tracks of whoever withdrew the transcription consent, also when tracks are kept', async () => {
    db.event.findMany.mockResolvedValue([]);
    db.recordingTrack.findMany
      .mockResolvedValueOnce([]) // trascritte
      .mockResolvedValueOnce([
        { ...traccia('t-via', 'e1', 'r1'), participantId: 'ep-via' },
        { ...traccia('t-resta', 'e1', 'r1'), participantId: 'ep-resta' },
      ]);
    ritirati.mockResolvedValueOnce(new Set(['ep-via']));
    const res = await GET(req() as never, ctx as never);
    const body = (await res.json()) as { purged: number; withdrawnConsent: number };
    expect(ritirati).toHaveBeenCalledWith('e1', ['ep-via', 'ep-resta']);
    expect(body.withdrawnConsent).toBe(1);
    expect(del).toHaveBeenCalledWith('recordings/multitrack/e1/r1/audio/t-via.opus');
    expect(del).not.toHaveBeenCalledWith('recordings/multitrack/e1/r1/audio/t-resta.opus');
    // Si aspetta solo un job che le ha gia' prese in carico.
    const where = db.recordingTrack.findMany.mock.calls[1]![0].where as {
      recording: { jobs: { none: { status: { in: string[] } } } };
    };
    expect(where.recording.jobs.none.status.in).toEqual(['CLAIMED', 'RUNNING']);
  });

  it('purges untranscribed tracks only of events past their data retention', async () => {
    db.event.findMany.mockResolvedValue([
      { id: 'e-old', status: 'ENDED', endsAt: daysAgo(40), lastActiveAt: null, dataRetentionDays: 30 },
      { id: 'e-new', status: 'ENDED', endsAt: daysAgo(5), lastActiveAt: null, dataRetentionDays: 30 },
    ]);
    db.recordingTrack.findMany
      .mockResolvedValueOnce([traccia('t1', 'e', 'r1')])
      .mockResolvedValueOnce([traccia('t2', 'e-old', 'r2')]);
    const body = await (await GET(req() as never, ctx as never)).json();
    expect(body).toMatchObject({ ok: true, candidates: 2, untranscribedExpired: 1, purged: 2 });
    const second = db.recordingTrack.findMany.mock.calls[1]?.[0] as {
      where: { recording: { eventId: { in: string[] } } };
      orderBy: unknown;
    };
    expect(second.where.recording.eventId.in).toEqual(['e-old']);
    expect(second.orderBy).toEqual({ createdAt: 'asc' });
    expect(del).toHaveBeenCalledWith('recordings/multitrack/e-old/r2/audio/t2.opus');
  });

  it('does not look for untranscribed tracks when no event has expired', async () => {
    db.event.findMany.mockResolvedValue([
      { id: 'e-live', status: 'LIVE', endsAt: daysAgo(1), lastActiveAt: null, dataRetentionDays: 30 },
    ]);
    db.recordingTrack.findMany.mockResolvedValueOnce([]);
    const body = await (await GET(req() as never, ctx as never)).json();
    expect(body).toMatchObject({ candidates: 0, purged: 0 });
    // Le trascritte e quelle dei consensi ritirati; nessuna ricerca delle
    // tracce mai trascritte di eventi scaduti.
    expect(db.recordingTrack.findMany).toHaveBeenCalledTimes(2);
    const cerche = db.recordingTrack.findMany.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(cerche.some((c) => c.includes('"eventId":{"in"'))).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });

  it('deletes the manifest with the last track of a recording, not before', async () => {
    db.event.findMany.mockResolvedValue([]);
    db.recordingTrack.findMany.mockResolvedValueOnce([
      traccia('t1', 'e', 'r-finita'),
      traccia('t2', 'e', 'r-aperta'),
    ]);
    // Della seconda registrazione resta una traccia con l'audio.
    db.recordingTrack.groupBy.mockResolvedValue([{ recordingId: 'r-aperta' }]);
    const body = await (await GET(req() as never, ctx as never)).json();
    expect(body).toMatchObject({ purged: 2, manifestsDeleted: 1 });
    expect(del).toHaveBeenCalledWith('recordings/multitrack/e/r-finita/tracks.json');
    expect(del).not.toHaveBeenCalledWith('recordings/multitrack/e/r-aperta/tracks.json');
  });

  it('leaves the manifest alone when no track of the recording was purged', async () => {
    db.event.findMany.mockResolvedValue([]);
    db.recordingTrack.findMany.mockResolvedValueOnce([traccia('t1', 'e', 'r1')]);
    del.mockRejectedValueOnce(new Error('storage giù'));
    const body = await (await GET(req() as never, ctx as never)).json();
    expect(body).toMatchObject({ purged: 0, failed: 1, manifestsDeleted: 0 });
    expect(db.recordingTrack.groupBy).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('counts a manifest that could not be deleted as a failure', async () => {
    db.event.findMany.mockResolvedValue([]);
    db.recordingTrack.findMany.mockResolvedValueOnce([traccia('t1', 'e', 'r1')]);
    // La traccia va, il manifesto no.
    del.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('storage giù'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const body = await (await GET(req() as never, ctx as never)).json();
      expect(body).toMatchObject({ purged: 1, failed: 1, manifestsDeleted: 0 });
    } finally {
      warn.mockRestore();
    }
  });
});
