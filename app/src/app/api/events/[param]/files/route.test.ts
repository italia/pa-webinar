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
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findFirst: vi.fn() },
    eventMaterial: { findMany: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
  },
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

import { GET } from './route';

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
