// @vitest-environment node
import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Il PDF di una slide accanto alla registrazione pubblicata.
 *
 * Solo per la pagina post-evento pubblica, solo un materiale che la pagina
 * mostra accanto al video (ricalcolato a ogni richiesta), letto lato server
 * con un URL firmato che non esce dalla rotta.
 */
const { storage, slides, accesso } = vi.hoisted(() => ({
  storage: {
    current: null as null | { getDownloadUrl: ReturnType<typeof vi.fn> },
  },
  slides: { publicSlideFileKey: vi.fn() },
  accesso: { accessoRegistrazione: vi.fn() },
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/storage', () => ({ getFilesStorage: () => storage.current }));
vi.mock('@/lib/presentation/recording-slides-data', () => slides);
vi.mock('@/lib/recording/audience', () => accesso);
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

import { prisma } from '@/lib/db';

import { GET } from './route';

const mockedEvent = prisma.event.findFirst as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const MATERIAL_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_ID = '66666666-6666-4666-8666-666666666666';
const SLUG = 'evento-di-prova';
const KEY = 'assets/document/2026/10/77777777-7777-4777-8777-777777777777-slide.pdf';
const SAS = 'https://storage.example.net/files/assets/document/slide.pdf?sig=segreta';
const PDF = new TextEncoder().encode('%PDF-1.7\n%%EOF\n');

const ctx = () => ({ params: Promise.resolve({ param: SLUG }) });

function req(m: string | null = MATERIAL_ID): NextRequest {
  const query = m === null ? '' : `?m=${m}`;
  return new Request(
    `https://webinar.example.gov.it/api/events/${SLUG}/recording/slides${query}`
  ) as unknown as NextRequest;
}

function evento(over: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    slug: SLUG,
    status: 'ENDED',
    eventType: 'SCHEDULED',
    endsAt: new Date('2026-10-21T10:30:00Z'),
    postEventPublic: true,
    postEventPublicUntil: null,
    recordingUrl: 'https://storage.example.net/recordings/sala.mp4',
    recordingPublished: true,
    postEventShowMaterials: true,
    ...over,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  storage.current = { getDownloadUrl: vi.fn().mockResolvedValue(SAS) };
  mockedEvent.mockResolvedValue(evento());
  accesso.accessoRegistrazione.mockResolvedValue('pubblico');
  slides.publicSlideFileKey.mockImplementation(async (_e: unknown, m: string) =>
    m === MATERIAL_ID ? KEY : null
  );
  fetchMock.mockResolvedValue(
    new Response(PDF, {
      status: 200,
      headers: { 'content-length': String(PDF.byteLength) },
    })
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/events/[slug]/recording/slides', () => {
  it('serve il PDF di una slide mostrata accanto al video, letto lato server', async () => {
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(slides.publicSlideFileKey).toHaveBeenCalledWith(
      expect.objectContaining({ id: EVENT_ID, slug: SLUG, postEventShowMaterials: true }),
      MATERIAL_ID
    );
    expect(storage.current!.getDownloadUrl).toHaveBeenCalledWith(KEY, {
      expiresInMinutes: 10,
    });
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('attachment');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
    expect(JSON.stringify([...res.headers])).not.toContain('sig=');
  });

  it('un materiale che la pagina non mostra accanto al video: 404, lo storage non si tocca', async () => {
    const res = await GET(req(OTHER_ID), ctx());
    expect(res.status).toBe(404);
    expect(storage.current!.getDownloadUrl).not.toHaveBeenCalled();
  });

  it('nessuna slide accanto al video (spente, video non della sala, non pubblicato): 404', async () => {
    slides.publicSlideFileKey.mockResolvedValue(null);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
    expect(storage.current!.getDownloadUrl).not.toHaveBeenCalled();
  });

  it('pagina post-evento non pubblica: 404 prima di calcolare le slide', async () => {
    mockedEvent.mockResolvedValue(evento({ postEventPublic: false }));
    expect((await GET(req(), ctx())).status).toBe(404);
    mockedEvent.mockResolvedValue(
      evento({ postEventPublicUntil: new Date('2020-01-01') })
    );
    expect((await GET(req(), ctx())).status).toBe(404);
    mockedEvent.mockResolvedValue(evento({ status: 'DRAFT' }));
    expect((await GET(req(), ctx())).status).toBe(404);
    expect(slides.publicSlideFileKey).not.toHaveBeenCalled();
  });

  it('registrazione riservata agli iscritti, senza prova: 404 prima di calcolare le slide', async () => {
    accesso.accessoRegistrazione.mockResolvedValue(null);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
    expect(slides.publicSlideFileKey).not.toHaveBeenCalled();
  });

  it('lo staff in anteprima vede le slide del video non ancora pubblicato', async () => {
    mockedEvent.mockResolvedValue(evento({ recordingPublished: false }));
    accesso.accessoRegistrazione.mockResolvedValue('staff');
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(slides.publicSlideFileKey).toHaveBeenCalledWith(
      expect.objectContaining({ recordingPublished: true }),
      MATERIAL_ID,
    );
  });

  it('evento inesistente: 404', async () => {
    mockedEvent.mockResolvedValue(null);
    expect((await GET(req(), ctx())).status).toBe(404);
  });

  it('un id che non è un UUID, o nessun id: 404 senza leggere il database', async () => {
    expect((await GET(req('nope'), ctx())).status).toBe(404);
    expect((await GET(req(null), ctx())).status).toBe(404);
    expect(mockedEvent).not.toHaveBeenCalled();
  });

  it('storage non configurato: 503; storage che non risponde: 502', async () => {
    storage.current = null;
    expect((await GET(req(), ctx())).status).toBe(503);
    storage.current = { getDownloadUrl: vi.fn().mockResolvedValue(SAS) };
    fetchMock.mockRejectedValue(new Error('rete'));
    const errori = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await GET(req(), ctx())).status).toBe(502);
    errori.mockRestore();
  });
});
