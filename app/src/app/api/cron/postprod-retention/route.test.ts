// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * GET /api/cron/postprod-retention — la registrazione resta oltre la
 * conservazione dei dati dell'evento: alla scadenza dei dati se ne vanno solo le
 * tracce per persona, e gli output della post-produzione se ne vanno alla
 * scadenza della registrazione (`Recording.retentionUntil`).
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
  trackDeleteMany: vi.fn(),
  eventFindMany: vi.fn(),
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
    recordingTrack: { findMany: m.trackFindMany, deleteMany: m.trackDeleteMany, updateMany: vi.fn() },
    event: { findMany: m.eventFindMany },
    siteSetting: { findUnique: vi.fn(async () => ({ aiArtifactRetentionDays: 0 })) },
  },
}));

import { GET } from './route';

const GIORNO = 86_400_000;
const scaduto = { endsAt: new Date(Date.now() - 60 * GIORNO), dataRetentionDays: 30 };
const giro = async () =>
  (await GET(new Request('http://x/api/cron/postprod-retention') as never, { params: Promise.resolve({}) } as never)).json();

beforeEach(() => {
  vi.clearAllMocks();
  m.jobFindFirst.mockResolvedValue(null);
  m.deleteBlob.mockResolvedValue(true);
  m.storageDelete.mockResolvedValue(true);
  m.trackFindMany.mockResolvedValue([]);
  m.trackDeleteMany.mockResolvedValue({ count: 0 });
  m.artifactDeleteMany.mockResolvedValue({ count: 2 });
  m.eventFindMany.mockResolvedValue([]);
  m.recordingFindMany.mockResolvedValue([]);
  m.artifactFindMany.mockResolvedValue([
    { id: 'sintesi', blobKey: 'postprod/rec-1/summary.md' },
    { id: 'traduzione', blobKey: '' },
  ]);
});

describe('GET /api/cron/postprod-retention — tracce alla conservazione dei dati', () => {
  const conTracce = () => {
    m.eventFindMany.mockResolvedValue([
      { id: 'ev-scaduto', ...scaduto },
      { id: 'ev-vivo', endsAt: new Date(Date.now() - GIORNO), dataRetentionDays: 30 },
    ]);
    m.recordingFindMany.mockImplementation(async (args: { where: { eventId?: unknown } }) =>
      args.where.eventId ? [{ id: 'rec-1', eventId: 'ev-scaduto' }] : [],
    );
    m.trackFindMany.mockResolvedValue([
      { blobKey: 'recordings/multitrack/ev-scaduto/rec-1/a.ogg', audioPurgedAt: null },
    ]);
  };

  it('sceglie le registrazioni degli eventi scaduti, pubblicati o no', async () => {
    conTracce();
    await giro();
    const scelta = m.recordingFindMany.mock.calls
      .map((c) => c[0] as { where: Record<string, unknown> })
      .find((a) => a.where.eventId);
    expect(scelta?.where).toEqual({
      eventId: { in: ['ev-scaduto'] },
      retentionUntil: null,
      tracks: { some: {} },
    });
    // Nessun filtro sulla pubblicazione: la voce isolata va via comunque.
    expect(JSON.stringify(m.eventFindMany.mock.calls[0]![0])).not.toContain('Published');
  });

  it('toglie le tracce e lascia gli artefatti della registrazione', async () => {
    conTracce();
    const res = await giro();
    expect(m.storageDelete).toHaveBeenCalledWith('recordings/multitrack/ev-scaduto/rec-1/a.ogg');
    expect(m.trackDeleteMany).toHaveBeenCalledWith({ where: { recordingId: 'rec-1' } });
    expect(m.artifactFindMany).not.toHaveBeenCalled();
    expect(m.artifactDeleteMany).not.toHaveBeenCalled();
    expect(res.tracksPurged).toBe(1);
  });

  it('senza eventi scaduti non cerca registrazioni', async () => {
    m.eventFindMany.mockResolvedValue([
      { id: 'ev-vivo', endsAt: new Date(Date.now() - GIORNO), dataRetentionDays: 30 },
    ]);
    const res = await giro();
    expect(m.recordingFindMany.mock.calls.some((c) => (c[0] as { where: { eventId?: unknown } }).where.eventId)).toBe(false);
    expect(res.tracksPurged).toBe(0);
  });

  it('un lavoro che legge le tracce le fa aspettare', async () => {
    conTracce();
    m.jobFindFirst.mockResolvedValue({ id: 'job' });
    const res = await giro();
    expect(m.trackDeleteMany).not.toHaveBeenCalled();
    expect(res.deferredActiveJob).toBe(1);
  });
});

describe('GET /api/cron/postprod-retention — scadenza della registrazione', () => {
  it('toglie tutti gli output, file compresi, e archivia', async () => {
    m.recordingFindMany.mockImplementation(async (args: { where: { retentionUntil?: unknown } }) =>
      args.where.retentionUntil ? [{ id: 'rec-1', eventId: 'ev-1' }] : [],
    );
    const res = await giro();
    expect(m.artifactFindMany).toHaveBeenCalledWith({
      where: { recordingId: 'rec-1' },
      select: { id: true, blobKey: true },
    });
    // Solo i file che ci sono: un artefatto tenuto nel database non ne ha.
    expect(m.deleteBlob).toHaveBeenCalledTimes(1);
    expect(m.deleteBlob).toHaveBeenCalledWith('postprod/rec-1/summary.md');
    expect(m.artifactDeleteMany).toHaveBeenCalledWith({ where: { recordingId: 'rec-1' } });
    expect(res.expiredRecordings).toBe(1);
  });

  it('senza una data di scadenza gli artefatti restano', async () => {
    const res = await giro();
    expect(m.artifactDeleteMany).not.toHaveBeenCalled();
    expect(res.artifactsDeleted).toBe(0);
  });
});

describe('GET /api/cron/postprod-retention — manifesto delle tracce', () => {
  const scadutaIl = (blobKey: string) => {
    m.recordingFindMany.mockImplementation(async (args: { where: { retentionUntil?: unknown } }) =>
      args.where.retentionUntil ? [{ id: 'rec-m', eventId: 'ev-1', blobKey }] : [],
    );
  };
  const manifesto = 'recordings/multitrack/ev-1/rec-m/tracks.json';

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
