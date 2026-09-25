import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * L'elenco pubblico dei file di un evento.
 *
 * Stessa soglia e stessa regola dell'elenco dei materiali: niente file per un
 * evento senza pagina pubblica, visibilità per fase per il pubblico, tutto per
 * chi conduce. In più la forma della risposta: il percorso interno nello
 * storage non esce, e la dimensione (BigInt nel DB) arriva come stringa invece
 * di far fallire la serializzazione.
 */
const { storage } = vi.hoisted(() => ({
  storage: {
    current: null as null | { delete: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> },
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findFirst: vi.fn(), findUnique: vi.fn() },
    eventMaterial: { findMany: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/storage', () => ({
  getFilesStorage: () => storage.current,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('@/lib/auth/staff-session', async (importOriginal) => ({
  ...(await importOriginal<typeof StaffSessionModule>()),
  getStaffSession: vi.fn(async () => null),
}));
vi.mock('@/lib/cache', () => ({
  getCached: vi.fn(() => null),
  setCache: vi.fn(),
  deleteCache: vi.fn(),
  deleteCacheByPrefix: vi.fn(),
}));
vi.mock('@/lib/azure/blob-storage', () => ({
  isAzureConfigured: vi.fn(() => false),
  generateUploadSasUrl: vi.fn(),
  deleteBlob: vi.fn(),
  getBlobPath: vi.fn(),
  ensureContainer: vi.fn(),
}));

import type * as StaffSessionModule from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';

import { DELETE, GET } from './route';

const mockedEvent = prisma.event.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedMaterials = prisma.eventMaterial.findMany as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator.findUnique as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const SLUG = 'evento-di-prova';
const PRIMARY_TOKEN = 'PRIMARY_MOD_TOKEN';

function eventRow(over: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    moderatorToken: PRIMARY_TOKEN,
    createdById: null,
    status: 'ENDED',
    eventType: 'SCHEDULED',
    startsAt: new Date('2026-09-01T10:00:00.000Z'),
    endsAt: new Date('2026-09-01T12:00:00.000Z'),
    postEventPublic: true,
    postEventPublicUntil: null,
    ...over,
  };
}

const FILE_ROW = {
  id: 'file-1',
  eventId: EVENT_ID,
  type: 'FILE',
  title: 'Slide',
  url: '',
  description: null,
  addedBy: 'moderator',
  fileName: 'slide.pdf',
  fileSize: BigInt(123456),
  mimeType: 'application/pdf',
  blobPath: 'events/interno/slide.pdf',
  visibility: 'AFTER',
  createdAt: new Date('2026-09-01T12:30:00.000Z'),
};

const ctx = () => ({ params: Promise.resolve({ param: SLUG }) });

function get(headers: HeadersInit = {}): NextRequest {
  return new Request(`https://webinar.example.gov.it/api/events/${SLUG}/files`, {
    headers,
  }) as unknown as NextRequest;
}

function whereInterrogato(): Record<string, unknown> {
  const call = mockedMaterials.mock.calls[0]?.[0] as { where: Record<string, unknown> } | undefined;
  expect(call, 'nessuna interrogazione ai file').toBeDefined();
  return call!.where;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedEvent.mockResolvedValue(eventRow());
  mockedMaterials.mockResolvedValue([FILE_ROW]);
  mockedGrant.mockResolvedValue(null);
});

describe('GET /api/events/[slug]/files', () => {
  it('il pubblico riceve solo i file della fase in corso', async () => {
    const res = await GET(get(), ctx());
    expect(res.status).toBe(200);
    expect(whereInterrogato()).toEqual({
      eventId: EVENT_ID,
      type: 'FILE',
      visibility: { in: ['ALWAYS', 'AFTER'] },
    });
  });

  it('il moderatore li riceve tutti', async () => {
    await GET(get({ Authorization: `Bearer ${PRIMARY_TOKEN}` }), ctx());
    expect(whereInterrogato()).toEqual({ eventId: EVENT_ID, type: 'FILE' });
  });

  it('niente percorso interno dello storage, dimensione come stringa', async () => {
    const res = await GET(get(), ctx());
    const body = (await res.json()) as Record<string, unknown>[];
    expect(body).toHaveLength(1);
    expect(body[0]).not.toHaveProperty('blobPath');
    expect(body[0]).not.toHaveProperty('eventId');
    expect(body[0]!.fileSize).toBe('123456');
    expect(body[0]!.visibility).toBe('AFTER');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('un evento senza pagina pubblica resta 404', async () => {
    mockedEvent.mockResolvedValue(eventRow({ status: 'DRAFT' }));
    expect((await GET(get(), ctx())).status).toBe(404);

    mockedEvent.mockResolvedValue(eventRow({ postEventPublic: false }));
    expect((await GET(get(), ctx())).status).toBe(404);
    expect(mockedMaterials).not.toHaveBeenCalled();
  });
});

/**
 * Togliere un file con il caricamento per evento segue le regole di ogni altra
 * cancellazione di un materiale (lib/events/material-files): il file solo se è
 * di questo evento e nessun'altra riga lo tiene, e prima della riga. Prima il
 * blob si cancellava senza controlli: un materiale che puntava al file di un
 * altro evento glielo toglieva.
 */
describe('DELETE /api/events/[slug]/files', () => {
  const MATERIAL_ID = 'file-1';
  const KEY_ALTRUI = 'assets/document/2026/09/66666666-6666-4666-8666-666666666666-slide.pdf';
  const mockedFindUnique = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
  const mockedMaterial = prisma.eventMaterial.findFirst as unknown as ReturnType<typeof vi.fn>;
  const mockedDelete = prisma.eventMaterial.delete as unknown as ReturnType<typeof vi.fn>;

  function del(): NextRequest {
    return new Request(
      `https://webinar.example.gov.it/api/events/${SLUG}/files?materialId=${MATERIAL_ID}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${PRIMARY_TOKEN}` } },
    ) as unknown as NextRequest;
  }

  beforeEach(() => {
    storage.current = { delete: vi.fn().mockResolvedValue(true), list: vi.fn().mockResolvedValue([]) };
    mockedFindUnique.mockResolvedValue(eventRow());
    mockedEvent.mockResolvedValue(null);
    mockedDelete.mockResolvedValue({});
  });

  it('il file dell’evento: via il blob e poi la riga', async () => {
    const key = `events/${EVENT_ID}/files/slide.pdf`;
    // Prima lettura: il materiale; poi «un'altra riga lo usa?»: no.
    mockedMaterial.mockResolvedValueOnce({ ...FILE_ROW, blobPath: key }).mockResolvedValue(null);
    const res = await DELETE(del(), ctx());
    expect(res.status).toBe(200);
    expect(storage.current!.delete).toHaveBeenCalledWith(key);
    expect(storage.current!.delete.mock.invocationCallOrder[0]).toBeLessThan(
      mockedDelete.mock.invocationCallOrder[0]!,
    );
  });

  it('il file che il materiale di un altro evento tiene ancora resta', async () => {
    mockedMaterial
      .mockResolvedValueOnce({ ...FILE_ROW, blobPath: KEY_ALTRUI })
      .mockResolvedValue({ id: 'materiale-di-un-altro-evento' });
    const res = await DELETE(del(), ctx());
    expect(res.status).toBe(200);
    expect(mockedDelete).toHaveBeenCalled();
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });

  it('la cartella di un altro evento non si tocca', async () => {
    mockedMaterial.mockResolvedValueOnce({
      ...FILE_ROW,
      blobPath: 'events/99999999-9999-4999-8999-999999999999/files/slide.pdf',
    });
    const res = await DELETE(del(), ctx());
    expect(res.status).toBe(200);
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });

  it('se lo storage non risponde, la riga resta: 503', async () => {
    mockedMaterial
      .mockResolvedValueOnce({ ...FILE_ROW, blobPath: `events/${EVENT_ID}/files/slide.pdf` })
      .mockResolvedValue(null);
    storage.current!.delete.mockRejectedValue(new Error('down'));
    const res = await DELETE(del(), ctx());
    expect(res.status).toBe(503);
    expect(mockedDelete).not.toHaveBeenCalled();
  });
});
