// @vitest-environment node
import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * I byte del PDF presentato.
 *
 * Solo a chi sta nella stanza, solo il materiale presentato adesso, solo un
 * file dei materiali dell'evento, letto lato server con un URL firmato che non
 * esce dalla rotta. La risposta non resta in nessuna cache condivisa.
 */
const { storage } = vi.hoisted(() => ({
  storage: {
    current: null as null | { getDownloadUrl: ReturnType<typeof vi.fn> },
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findFirst: vi.fn() },
    eventPresentation: { findUnique: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
    registration: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/storage', () => ({ getFilesStorage: () => storage.current }));
vi.mock('@/lib/cache', () => ({ getCached: vi.fn(() => null), setCache: vi.fn(), deleteCache: vi.fn() }));
vi.mock('@/lib/events/join-grant', () => ({ hasJoinGrant: vi.fn(async () => false) }));
const { siteSettings } = vi.hoisted(() => ({ siteSettings: { guestAccessEnabled: true } }));
vi.mock('@/lib/settings', () => ({ getSettings: async () => siteSettings }));

import { prisma } from '@/lib/db';

import { GET } from './route';

const mockedEvent = prisma.event.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedRow = prisma.eventPresentation.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedRegistration = prisma.registration.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator.findUnique as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const MATERIAL_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_ID = '66666666-6666-4666-8666-666666666666';
const SLUG = 'evento-di-prova';
const KEY = 'assets/document/2026/10/77777777-7777-4777-8777-777777777777-slide.pdf';
const SAS = 'https://storage.example.net/files/assets/document/slide.pdf?sig=segreta';
const PDF = new TextEncoder().encode('%PDF-1.7\n%%EOF\n');

const ctx = () => ({ params: Promise.resolve({ param: SLUG }) });

function req(m: string | null = MATERIAL_ID, token: string | null = null): NextRequest {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const query = m === null ? '' : `?m=${m}`;
  return new Request(`https://webinar.example.gov.it/api/events/${SLUG}/presentation/file${query}`, {
    headers,
  }) as unknown as NextRequest;
}

function riga(over: Record<string, unknown> = {}) {
  return {
    materialId: MATERIAL_ID,
    material: {
      id: MATERIAL_ID,
      title: 'Slide',
      type: 'FILE',
      mimeType: 'application/pdf',
      fileName: 'slide.pdf',
      url: `https://webinar.example.gov.it/api/${KEY}`,
      blobPath: KEY,
    },
    ...over,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  siteSettings.guestAccessEnabled = true;
  storage.current = { getDownloadUrl: vi.fn().mockResolvedValue(SAS) };
  mockedEvent.mockResolvedValue({
    id: EVENT_ID,
    status: 'LIVE',
    eventType: 'SCHEDULED',
    moderatorToken: 'PRIMARY',
    joinPasswordHash: null,
  });
  mockedRow.mockResolvedValue(riga());
  mockedRegistration.mockResolvedValue(null);
  mockedGrant.mockResolvedValue(null);
  fetchMock.mockResolvedValue(
    new Response(PDF, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(PDF.byteLength) } }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/events/[slug]/presentation/file', () => {
  it('serve il PDF presentato, letto dallo storage lato server', async () => {
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(storage.current!.getDownloadUrl).toHaveBeenCalledWith(KEY, { expiresInMinutes: 10 });
    expect(fetchMock).toHaveBeenCalledWith(SAS);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toBe('attachment');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-length')).toBe(String(PDF.byteLength));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
    // L'URL firmato non esce dalla rotta.
    expect(JSON.stringify([...res.headers])).not.toContain('sig=');
  });

  it('un materiale che non è quello presentato: 404, lo storage non si tocca', async () => {
    const res = await GET(req(OTHER_ID), ctx());
    expect(res.status).toBe(404);
    expect(storage.current!.getDownloadUrl).not.toHaveBeenCalled();
  });

  it('presentazione chiusa: 404', async () => {
    mockedRow.mockResolvedValue({ materialId: null, material: null });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
  });

  it('un id che non è un UUID, o nessun id: 404', async () => {
    expect((await GET(req('nope'), ctx())).status).toBe(404);
    expect((await GET(req(null), ctx())).status).toBe(404);
    expect(mockedEvent).not.toHaveBeenCalled();
  });

  it('chi non sta nella stanza: 401 prima di leggere la presentazione', async () => {
    mockedEvent.mockResolvedValue({
      id: EVENT_ID,
      status: 'PUBLISHED',
      eventType: 'SCHEDULED',
      moderatorToken: 'PRIMARY',
      joinPasswordHash: null,
    });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(401);
    expect(mockedRow).not.toHaveBeenCalled();
  });

  it('evento concluso: la presentazione rimasta aperta non si serve più', async () => {
    mockedEvent.mockResolvedValue({
      id: EVENT_ID,
      status: 'ENDED',
      eventType: 'SCHEDULED',
      moderatorToken: 'PRIMARY',
      joinPasswordHash: null,
    });
    mockedRegistration.mockResolvedValue({ id: 'reg-1', eventId: EVENT_ID });
    const res = await GET(req(MATERIAL_ID, 'TOKEN_ISCRITTO'), ctx());
    expect(res.status).toBe(404);
    expect(storage.current!.getDownloadUrl).not.toHaveBeenCalled();
  });

  it('un iscritto con il suo token legge anche fuori dalla finestra degli ospiti', async () => {
    siteSettings.guestAccessEnabled = false;
    mockedRegistration.mockResolvedValue({ id: 'reg-1', eventId: EVENT_ID });
    const res = await GET(req(MATERIAL_ID, 'TOKEN_ISCRITTO'), ctx());
    expect(res.status).toBe(200);
  });

  it('una chiave che non è il file di un materiale non si serve: 404', async () => {
    mockedRow.mockResolvedValue(
      riga({
        material: {
          ...riga().material,
          blobPath: 'recordings/2026/10/registrazione.mp4',
        },
      }),
    );
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
    expect(storage.current!.getDownloadUrl).not.toHaveBeenCalled();
  });

  it('storage non configurato: 503', async () => {
    storage.current = null;
    const res = await GET(req(), ctx());
    expect(res.status).toBe(503);
  });

  it('il file non c’è più nello storage: 404', async () => {
    fetchMock.mockResolvedValue(new Response('no', { status: 404 }));
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
  });

  it('lo storage non risponde: 502', async () => {
    fetchMock.mockRejectedValue(new Error('rete'));
    const errori = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(req(), ctx());
    expect(res.status).toBe(502);
    errori.mockRestore();
  });
});
