// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Il PDF di una slide per l'anteprima dello staff: solo per chi gestisce
 * l'evento, solo un materiale presentato che la pagina pubblica potrebbe
 * mostrare accanto a questa registrazione.
 */
const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  readRecordingSlides: vi.fn(),
  requireRecordingManager: vi.fn(),
  storage: { current: null as null | { getDownloadUrl: ReturnType<typeof vi.fn> } },
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock('@/lib/auth/staff-session', () => ({
  requireRecordingManager: m.requireRecordingManager,
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    recording: { findUnique: m.findUnique },
  },
}));
vi.mock('@/lib/presentation/recording-slides-data', () => ({
  RECORDING_SLIDES_SELECT: { id: true },
  readRecordingSlides: m.readRecordingSlides,
}));
vi.mock('@/lib/storage', () => ({ getFilesStorage: () => m.storage.current }));

import { ForbiddenError } from '@/lib/errors';

import { GET } from './route';

const ID = '11111111-2222-4333-8444-555555555555';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const A = '55555555-5555-4555-8555-555555555555';
const B = '66666666-6666-4666-8666-666666666666';
const KEY = 'assets/document/2026/10/77777777-7777-4777-8777-777777777777-slide.pdf';

const leggi = (q = `?m=${A}`) =>
  GET(
    new Request(`http://x/api/admin/postprod/recordings/${ID}/slides/file${q}`) as never,
    {
      params: Promise.resolve({ id: ID }),
    } as never
  );

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRecordingManager.mockResolvedValue({ role: 'organizer' });
  m.storage.current = { getDownloadUrl: vi.fn().mockResolvedValue('https://s/x?sig') };
  m.findUnique.mockResolvedValue({ id: ID, eventId: EVENT_ID });
  m.readRecordingSlides.mockResolvedValue({
    marks: [],
    exactZero: true,
    materials: [
      { id: A, title: 'Slide', fileName: null, problem: null, blobPath: KEY },
      {
        id: B,
        title: 'Solo in sala',
        fileName: null,
        problem: 'notVisibleAfter',
        blobPath: null,
      },
    ],
  });
  fetchMock.mockResolvedValue(
    new Response(new Uint8Array([0x25, 0x50]), { status: 200 })
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET slides/file', () => {
  it('serve il PDF di un materiale presentato che si può mostrare', async () => {
    const res = await leggi();
    expect(res.status).toBe(200);
    expect(m.storage.current!.getDownloadUrl).toHaveBeenCalledWith(KEY, {
      expiresInMinutes: 10,
    });
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });

  it('un materiale che la pagina non mostrerebbe, o non presentato: 404', async () => {
    expect((await leggi(`?m=${B}`)).status).toBe(404);
    expect((await leggi('?m=99999999-9999-4999-8999-999999999999')).status).toBe(404);
    expect(m.storage.current!.getDownloadUrl).not.toHaveBeenCalled();
  });

  it('senza un id valido: 404', async () => {
    expect((await leggi('?m=nope')).status).toBe(404);
    expect((await leggi('')).status).toBe(404);
    expect(m.findUnique).not.toHaveBeenCalled();
  });

  it('chi non gestisce l’evento: 403', async () => {
    m.requireRecordingManager.mockRejectedValue(new ForbiddenError());
    expect((await leggi()).status).toBe(403);
    expect(m.findUnique).not.toHaveBeenCalled();
  });
});
