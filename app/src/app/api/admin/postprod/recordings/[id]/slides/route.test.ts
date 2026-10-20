// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Le slide sincronizzate di una registrazione, lato staff: cosa vede il
 * pannello (scelte, fatti della presentazione, materiali con il motivo) e
 * cosa si può cambiare (accese, scarto), validato e registrato nell'audit.
 */
const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  readRecordingSlides: vi.fn(),
  requireRecordingManager: vi.fn(),
  logAdminAction: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock('@/lib/auth/staff-session', () => ({
  requireRecordingManager: m.requireRecordingManager,
}));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: m.logAdminAction }));
vi.mock('@/lib/db', () => ({
  prisma: { recording: { findUnique: m.findUnique, update: m.update } },
}));
vi.mock('@/lib/presentation/recording-slides-data', () => ({
  RECORDING_SLIDES_SELECT: { id: true },
  readRecordingSlides: m.readRecordingSlides,
}));

import { ForbiddenError } from '@/lib/errors';

import { GET, PATCH } from './route';

const ID = '11111111-2222-4333-8444-555555555555';
const A = '55555555-5555-4555-8555-555555555555';
const B = '66666666-6666-4666-8666-666666666666';
const URL_VIDEO = 'https://storage.example.net/recordings/sala.mp4';

const ctx = () => ({ params: Promise.resolve({ id: ID }) }) as never;
const leggi = () =>
  GET(new Request(`http://x/api/admin/postprod/recordings/${ID}/slides`) as never, ctx());
const cambia = (body: unknown) =>
  PATCH(
    new Request(`http://x/api/admin/postprod/recordings/${ID}/slides`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
    ctx()
  );

function registrazione(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    eventId: 'ev',
    blobKey: 'recordings/sala.mp4',
    mediaStartedAt: null,
    createdAt: new Date('2026-10-21T10:35:00Z'),
    durationSec: 5400,
    slidesEnabled: true,
    slidesOffsetSec: -2,
    callSession: { endedAt: new Date('2026-10-21T10:35:00Z'), recordingUrl: URL_VIDEO },
    event: {
      slug: 'evento-di-prova',
      recordingUrl: URL_VIDEO,
      recordingPublished: false,
      postEventShowMaterials: true,
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRecordingManager.mockResolvedValue({ role: 'admin' });
  m.findUnique.mockResolvedValue(registrazione());
  m.readRecordingSlides.mockResolvedValue({
    marks: [{ t: 12, kind: 'started', materialId: A, page: 1 }],
    exactZero: true,
    durationSec: 5400,
    materials: [
      {
        id: A,
        title: 'Slide',
        fileName: 'slide.pdf',
        problem: null,
        blobPath: 'assets/document/2026/10/x-slide.pdf',
      },
      { id: B, title: 'Tolto', fileName: null, problem: 'deleted', blobPath: null },
    ],
  });
  m.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    slidesEnabled: data.slidesEnabled ?? true,
    slidesOffsetSec: data.slidesOffsetSec ?? -2,
  }));
});

describe('GET slides', () => {
  it('scelte, fatti, materiali e dove leggere il video e i PDF per l’anteprima', async () => {
    const res = await leggi();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json();
    expect(body).toEqual({
      enabled: true,
      offsetSec: -2,
      exactZero: true,
      durationSec: 5400,
      hasVideo: true,
      isEventVideo: true,
      eventVideoPublished: false,
      eventShowsMaterials: true,
      eventSlug: 'evento-di-prova',
      mediaUrl: `/api/admin/postprod/recordings/${ID}/media`,
      marks: [{ t: 12, kind: 'started', materialId: A, page: 1 }],
      materials: [
        {
          id: A,
          title: 'Slide',
          problem: null,
          fileUrl: `/api/admin/postprod/recordings/${ID}/slides/file?m=${A}`,
        },
        { id: B, title: 'Tolto', problem: 'deleted', fileUrl: null },
      ],
    });
  });

  it('un altro segmento della stessa sala non è il video dell’evento', async () => {
    m.findUnique.mockResolvedValue(
      registrazione({
        callSession: {
          endedAt: null,
          recordingUrl: 'https://storage.example.net/altro.mp4',
        },
      })
    );
    expect((await (await leggi()).json()).isEventVideo).toBe(false);
  });

  it('senza video: niente anteprima', async () => {
    m.findUnique.mockResolvedValue(registrazione({ blobKey: '' }));
    const body = await (await leggi()).json();
    expect(body.hasVideo).toBe(false);
    expect(body.mediaUrl).toBeNull();
  });

  it('registrazione inesistente: 404', async () => {
    m.findUnique.mockResolvedValue(null);
    expect((await leggi()).status).toBe(404);
  });

  it('chi non gestisce l’evento: 403, senza leggere nulla', async () => {
    m.requireRecordingManager.mockRejectedValue(new ForbiddenError());
    expect((await leggi()).status).toBe(403);
    expect(m.findUnique).not.toHaveBeenCalled();
  });
});

describe('PATCH slides', () => {
  it('accende o spegne, e lo scrive nell’audit', async () => {
    const res = await cambia({ enabled: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, offsetSec: -2 });
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID }, data: { slidesEnabled: false } })
    );
    expect(m.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'POSTPROD_SLIDES_UPDATE',
        target: ID,
        details: { enabled: false },
      })
    );
  });

  it('salva lo scarto, positivo o negativo, in secondi interi', async () => {
    expect((await cambia({ offsetSec: 7 })).status).toBe(200);
    expect(m.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { slidesOffsetSec: 7 } })
    );
    expect((await cambia({ offsetSec: -3600, enabled: true })).status).toBe(200);
    expect(m.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { slidesEnabled: true, slidesOffsetSec: -3600 } })
    );
  });

  it('valori fuori misura, decimali, campi sconosciuti o niente da cambiare: 422', async () => {
    for (const body of [
      { offsetSec: 3601 },
      { offsetSec: -3601 },
      { offsetSec: 1.5 },
      { offsetSec: '5' },
      { enabled: 'si' },
      { enabled: true, altro: 1 },
      {},
    ]) {
      expect((await cambia(body)).status).toBe(422);
    }
    expect(m.update).not.toHaveBeenCalled();
  });

  it('registrazione inesistente: 404, e niente audit', async () => {
    m.update.mockRejectedValue(Object.assign(new Error('not found'), { code: 'P2025' }));
    expect((await cambia({ enabled: true })).status).toBe(404);
    expect(m.logAdminAction).not.toHaveBeenCalled();
  });

  it('chi non gestisce l’evento: 403', async () => {
    m.requireRecordingManager.mockRejectedValue(new ForbiddenError());
    expect((await cambia({ enabled: true })).status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });
});
