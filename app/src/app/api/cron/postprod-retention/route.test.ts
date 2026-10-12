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
}));

vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));
vi.mock('@/lib/storage/postprod', () => ({
  isPostprodStorageConfigured: () => true,
  deletePostprodBlob: m.deleteBlob,
  getPostprodStorage: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    recording: { findMany: m.recordingFindMany, findUnique: vi.fn(), update: vi.fn() },
    postprodArtifact: { findMany: m.artifactFindMany, deleteMany: m.artifactDeleteMany },
    postprodJob: { findFirst: m.jobFindFirst, updateMany: vi.fn() },
    postprodOriginalBody: { deleteMany: vi.fn() },
    speaker: { deleteMany: vi.fn() },
    recordingTrack: { findMany: vi.fn(async () => []), deleteMany: vi.fn(), updateMany: vi.fn() },
    siteSetting: { findUnique: vi.fn(async () => ({ aiArtifactRetentionDays: 0 })) },
  },
}));

import { GET } from './route';

const scaduto = { endsAt: new Date(Date.now() - 60 * 86_400_000), dataRetentionDays: 30 };

beforeEach(() => {
  vi.clearAllMocks();
  m.jobFindFirst.mockResolvedValue(null);
  m.deleteBlob.mockResolvedValue(true);
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
