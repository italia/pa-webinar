import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La riconciliazione segna orfani gli oggetti che la banca dati non conosce e
 * li cancella allo scadere della tolleranza. Le tracce per partecipante ancora
 * presenti, e il manifesto della loro registrazione, sono conosciute: le
 * cancella multitrack-purge con le sue regole, non la riconciliazione.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findMany: vi.fn() },
    callSession: { findMany: vi.fn() },
    recordingTrack: { findMany: vi.fn(), updateMany: vi.fn() },
    orphanRecording: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    siteSetting: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));
const listRecordingBlobs = vi.fn();
vi.mock('@/lib/storage/recordings', async (importOriginal) => {
  const reale = await importOriginal<typeof Registrazioni>();
  return {
    isRecordingStorageConfigured: () => true,
    listRecordingBlobs: () => listRecordingBlobs(),
    deleteRecordingBlobByName: vi.fn(async () => true),
    recordingBlobNameFromKey: reale.recordingBlobNameFromKey,
  };
});

import { prisma } from '@/lib/db';
import type * as Registrazioni from '@/lib/storage/recordings';

import { GET } from './route';

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  event: { findMany: Fn };
  callSession: { findMany: Fn };
  recordingTrack: { findMany: Fn; updateMany: Fn };
  orphanRecording: { upsert: Fn; deleteMany: Fn; findMany: Fn; delete: Fn };
  siteSetting: { findFirst: Fn };
};
const ctx = { params: Promise.resolve({}) };
const req = () =>
  new Request('https://portale.example.test/api/cron/recordings-reconcile');
const inConservazione = {
  status: 'ENDED',
  endsAt: new Date(Date.now() - 86_400_000),
  lastActiveAt: null,
  dataRetentionDays: 30,
};
const scaduto = { ...inConservazione, endsAt: new Date(Date.now() - 40 * 86_400_000) };
const traccia = (
  eventId: string,
  recordingId: string,
  file: string,
  event = inConservazione,
  recording: { retentionUntil?: Date | null; jobs?: Array<{ id: string }> } = {}
) => ({
  blobKey: `recordings/multitrack/${eventId}/${recordingId}/audio/${file}`,
  recordingId,
  recording: { eventId, retentionUntil: null, jobs: [], ...recording, event },
});
const blob = (name: string) => ({
  name,
  url: '',
  sizeBytes: 10,
  lastModified: new Date(),
});

beforeEach(() => {
  vi.clearAllMocks();
  db.event.findMany.mockResolvedValue([]);
  db.callSession.findMany.mockResolvedValue([
    { recordingUrl: null, recordingFilename: 'mix.mp4' },
  ]);
  db.orphanRecording.upsert.mockImplementation(async () => ({
    discoveredAt: new Date(),
  }));
  db.orphanRecording.deleteMany.mockResolvedValue({ count: 0 });
  db.orphanRecording.findMany.mockResolvedValue([]);
  db.siteSetting.findFirst.mockResolvedValue({ orphanRecordingGraceDays: 30 });
});

describe('GET /api/cron/recordings-reconcile', () => {
  it('treats present participant tracks and their manifest as linked', async () => {
    db.recordingTrack.findMany.mockResolvedValue([traccia('ev-1', 'rec-1', 'p1-0.opus')]);
    db.orphanRecording.findMany.mockResolvedValue([]);
    listRecordingBlobs.mockResolvedValue([
      blob('mix.mp4'),
      blob('multitrack/ev-1/rec-1/audio/p1-0.opus'),
      blob('multitrack/ev-1/rec-1/tracks.json'),
      // Manifesto di una registrazione senza più tracce: orfano.
      blob('multitrack/ev-2/rec-2/tracks.json'),
    ]);
    const body = await (await GET(req() as never, ctx as never)).json();
    expect(body).toMatchObject({ scanned: 4, linked: 3, orphansDiscovered: 1 });
    expect(db.orphanRecording.upsert).toHaveBeenCalledTimes(1);
    expect(db.orphanRecording.upsert.mock.calls[0]?.[0]).toMatchObject({
      where: { blobName: 'multitrack/ev-2/rec-2/tracks.json' },
    });
    // Le tracce già cancellate non contano come conosciute.
    expect(db.recordingTrack.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { audioPurgedAt: null },
    });
  });

  it('turns a track left past the event data retention into an orphan', async () => {
    db.recordingTrack.findMany.mockResolvedValue([
      traccia('ev-1', 'rec-1', 'p1-0.opus', scaduto),
    ]);
    listRecordingBlobs.mockResolvedValue([
      blob('multitrack/ev-1/rec-1/audio/p1-0.opus'),
      blob('multitrack/ev-1/rec-1/tracks.json'),
    ]);
    const body = await (await GET(req() as never, ctx as never)).json();
    expect(body).toMatchObject({ linked: 0, orphansDiscovered: 2 });
  });

  it('keeps a track past event retention while its recording or a job still holds it', async () => {
    db.recordingTrack.findMany.mockResolvedValue([
      traccia('ev-1', 'rec-1', 'a.opus', scaduto, {
        retentionUntil: new Date(Date.now() + 86_400_000),
      }),
      traccia('ev-1', 'rec-2', 'b.opus', scaduto, { jobs: [{ id: 'job-1' }] }),
    ]);
    listRecordingBlobs.mockResolvedValue([
      blob('multitrack/ev-1/rec-1/audio/a.opus'),
      blob('multitrack/ev-1/rec-2/audio/b.opus'),
    ]);
    const body = await (await GET(req() as never, ctx as never)).json();
    expect(body).toMatchObject({ linked: 2, orphansDiscovered: 0 });
  });

  it('honors a "delete now" decision on a known track', async () => {
    db.recordingTrack.findMany.mockResolvedValue([traccia('ev-1', 'rec-1', 'p1-0.opus')]);
    // La prima lettura cerca le decisioni «elimina subito» sulle tracce, la
    // seconda è quella della pulizia.
    db.orphanRecording.findMany
      .mockResolvedValueOnce([{ blobName: 'multitrack/ev-1/rec-1/audio/p1-0.opus' }])
      .mockResolvedValueOnce([
        { id: 'o-1', blobName: 'multitrack/ev-1/rec-1/audio/p1-0.opus' },
      ]);
    listRecordingBlobs.mockResolvedValue([blob('multitrack/ev-1/rec-1/audio/p1-0.opus')]);
    const body = await (await GET(req() as never, ctx as never)).json();
    expect(body).toMatchObject({ linked: 0, sweepDeleted: 1 });
    // La traccia tolta risulta cancellata, come dopo i lavori di cancellazione.
    expect(db.recordingTrack.updateMany).toHaveBeenCalledWith({
      where: {
        blobKey: 'recordings/multitrack/ev-1/rec-1/audio/p1-0.opus',
        audioPurgedAt: null,
      },
      data: { audioPurgedAt: expect.any(Date) },
    });
    expect(db.orphanRecording.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { decision: 'delete-now', blobName: { startsWith: 'multitrack/' } },
    });
  });

  it('drops a previous orphan row once its track is known', async () => {
    db.recordingTrack.findMany.mockResolvedValue([traccia('ev-1', 'rec-1', 'p1-0.opus')]);
    listRecordingBlobs.mockResolvedValue([blob('multitrack/ev-1/rec-1/audio/p1-0.opus')]);
    await GET(req() as never, ctx as never);
    expect(db.orphanRecording.upsert).not.toHaveBeenCalled();
    expect(db.orphanRecording.deleteMany).toHaveBeenCalledWith({
      where: { blobName: { notIn: [] } },
    });
  });
});
