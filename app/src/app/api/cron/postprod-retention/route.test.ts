// @vitest-environment node
/**
 * GET /api/cron/postprod-retention — il giro della trascrizione pubblicata da
 * sola: alla scadenza dell'evento restano il testo della trascrizione e niente
 * altro (sintesi, traduzioni, doppiaggio se ne vanno).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  recordingFindMany: vi.fn(),
  artifactFindMany: vi.fn(),
  artifactDeleteMany: vi.fn(),
  jobFindFirst: vi.fn(),
  deleteBlob: vi.fn(),
  storageDelete: vi.fn(),
  trackFindMany: vi.fn(),
}));

vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));
vi.mock('@/lib/storage/postprod', () => ({
  isPostprodStorageConfigured: () => true,
  deletePostprodBlob: m.deleteBlob,
  getPostprodStorage: () => ({ delete: m.storageDelete }),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    recording: { findMany: m.recordingFindMany, findUnique: vi.fn(), update: vi.fn() },
    postprodArtifact: { findMany: m.artifactFindMany, deleteMany: m.artifactDeleteMany },
    postprodJob: { findFirst: m.jobFindFirst, updateMany: vi.fn() },
    postprodOriginalBody: { deleteMany: vi.fn() },
    speaker: { deleteMany: vi.fn() },
    recordingTrack: { findMany: m.trackFindMany, deleteMany: vi.fn(), updateMany: vi.fn() },
    siteSetting: { findUnique: vi.fn(async () => ({ aiArtifactRetentionDays: 0 })) },
  },
}));

import { GET } from './route';

const scaduto = { endsAt: new Date(Date.now() - 60 * 86_400_000), dataRetentionDays: 30 };

beforeEach(() => {
  vi.clearAllMocks();
  m.jobFindFirst.mockResolvedValue(null);
  m.deleteBlob.mockResolvedValue(true);
  m.storageDelete.mockResolvedValue(true);
  m.trackFindMany.mockResolvedValue([]);
  m.artifactDeleteMany.mockResolvedValue({ count: 2 });
  m.recordingFindMany.mockImplementation(async (args: { where: { event?: { transcriptPublished?: boolean } } }) =>
    args.where.event?.transcriptPublished === true ? [{ id: 'rec-1', event: scaduto }] : [],
  );
  m.artifactFindMany.mockResolvedValue([
    { id: 'sintesi', blobKey: 'postprod/rec-1/summary.md' },
    { id: 'traduzione', blobKey: '' },
  ]);
});

describe('GET /api/cron/postprod-retention — trascrizione pubblicata da sola', () => {
  it('cerca solo le registrazioni che hanno ancora altro oltre alla trascrizione', async () => {
    await GET(new Request('http://x/api/cron/postprod-retention') as never, { params: Promise.resolve({}) } as never);
    const giro = m.recordingFindMany.mock.calls
      .map((c) => c[0] as { where: Record<string, unknown> })
      .find((a) => (a.where.event as { transcriptPublished?: boolean } | undefined)?.transcriptPublished === true);
    expect(giro?.where).toMatchObject({
      artifacts: { some: { type: { not: 'TRANSCRIPT_JSON' } } },
      event: { recordingPublished: false, transcriptPublished: true },
    });
  });

  it('alla scadenza toglie tutto tranne la trascrizione, file compresi', async () => {
    const res = await GET(new Request('http://x/api/cron/postprod-retention') as never, { params: Promise.resolve({}) } as never);
    expect(m.artifactFindMany).toHaveBeenCalledWith({
      where: { recordingId: 'rec-1', type: { not: 'TRANSCRIPT_JSON' } },
      select: { id: true, blobKey: true },
    });
    // Solo i file che ci sono: un artefatto tenuto nel database non ne ha.
    expect(m.deleteBlob).toHaveBeenCalledTimes(1);
    expect(m.deleteBlob).toHaveBeenCalledWith('postprod/rec-1/summary.md');
    expect(m.artifactDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['sintesi', 'traduzione'] } } });
    expect((await res.json()).transcriptOnlyRecordings).toBe(1);
  });

  it('prima della scadenza non tocca niente', async () => {
    m.recordingFindMany.mockImplementation(async (args: { where: { event?: { transcriptPublished?: boolean } } }) =>
      args.where.event?.transcriptPublished === true
        ? [{ id: 'rec-1', event: { endsAt: new Date(), dataRetentionDays: 30 } }]
        : [],
    );
    await GET(new Request('http://x/api/cron/postprod-retention') as never, { params: Promise.resolve({}) } as never);
    expect(m.artifactFindMany).not.toHaveBeenCalled();
    expect(m.artifactDeleteMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/cron/postprod-retention — manifesto delle tracce', () => {
  const scadutaIl = (blobKey: string) => {
    m.recordingFindMany.mockImplementation(async (args: { where: { retentionUntil?: unknown } }) =>
      args.where.retentionUntil ? [{ id: 'rec-m', eventId: 'ev-1', blobKey }] : [],
    );
  };
  const manifesto = 'recordings/multitrack/ev-1/rec-m/tracks.json';
  const giro = async () =>
    (await GET(new Request('http://x/api/cron/postprod-retention') as never, { params: Promise.resolve({}) } as never)).json();

  it('lo cancella con le tracce', async () => {
    scadutaIl('recordings/ev-1/rec-m.mp4');
    m.trackFindMany.mockResolvedValue([{ blobKey: 'recordings/multitrack/ev-1/rec-m/a.ogg', audioPurgedAt: null }]);
    await giro();
    expect(m.storageDelete).toHaveBeenCalledWith('recordings/multitrack/ev-1/rec-m/a.ogg');
    expect(m.storageDelete).toHaveBeenCalledWith(manifesto);
  });

  it('lo cancella anche senza righe di traccia, ancora al segnaposto', async () => {
    scadutaIl('recordings/multitrack/ev-1/rec-m/');
    await giro();
    expect(m.storageDelete).toHaveBeenCalledWith(manifesto);
  });

  it('lo cancella anche senza righe di traccia quando il mix ha preso il posto del segnaposto', async () => {
    scadutaIl('recordings/ev-1/rec-m.mp4');
    await giro();
    expect(m.storageDelete).toHaveBeenCalledWith(manifesto);
  });

  it('una cancellazione fallita conta tra i file non cancellati', async () => {
    scadutaIl('recordings/multitrack/ev-1/rec-m/');
    m.storageDelete.mockRejectedValue(new Error('rete'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await giro();
      expect(res.blobsFailed).toBe(1);
      expect(warn).toHaveBeenCalledWith('[recorder/manifest] manifest delete failed', expect.objectContaining({ recordingId: 'rec-m' }));
    } finally {
      warn.mockRestore();
    }
  });
});
