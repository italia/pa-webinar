// @vitest-environment node
/**
 * Un materiale gestito dall'area admin, e il suo file.
 *
 * Il blob di un materiale caricato vive quanto la riga che lo punta: toglierlo
 * dall'area admin, o sostituirne il file, lo cancella dallo storage, prima
 * della riga. Un file rimasto senza riga resterebbe scaricabile da chi ha l'URL
 * e fuori dalla pulizia per retention, che parte dalle righe: se lo storage non
 * risponde, la riga resta e si riprova. La sala aperta rilegge il pannello.
 */

import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { storage, poke } = vi.hoisted(() => ({
  storage: {
    current: null as null | { delete: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> },
  },
  poke: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => ({ value: 'admin-session' }) })),
}));
vi.mock('@/lib/auth/staff-session', () => ({
  requireEventManager: vi.fn(async () => ({ role: 'admin' })),
}));
vi.mock('@/lib/audit/admin-audit', () => ({
  logAdminAction: vi.fn(async () => undefined),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findFirst: vi.fn() },
    eventMaterial: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock('@/lib/storage', () => ({
  getFilesStorage: () => storage.current,
}));
vi.mock('@/lib/live-state/publish', () => ({
  pokeLivePanel: poke,
}));

import { prisma } from '@/lib/db';

import { DELETE, PATCH } from './route';

const mockedFind = prisma.eventMaterial.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedUpdate = prisma.eventMaterial.update as unknown as ReturnType<typeof vi.fn>;
const mockedDelete = prisma.eventMaterial.delete as unknown as ReturnType<typeof vi.fn>;
const mockedOtherRow = prisma.eventMaterial.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedPrivacyNotice = prisma.event.findFirst as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const MATERIAL_ID = '55555555-5555-4555-8555-555555555555';
const OLD_KEY = 'assets/document/2026/09/66666666-6666-4666-8666-666666666666-vecchio.pdf';
const NEW_KEY = 'assets/document/2026/09/77777777-7777-4777-8777-777777777777-nuovo.pdf';
const servedUrl = (key: string) =>
  `https://webinar.example.gov.it/api/assets/${key.replace(/^assets\//, '')}`;

const ctx = () => ({ params: Promise.resolve({ id: EVENT_ID, materialId: MATERIAL_ID }) });

function row(over: Record<string, unknown> = {}) {
  return {
    id: MATERIAL_ID,
    eventId: EVENT_ID,
    type: 'FILE',
    title: 'Slide',
    url: servedUrl(OLD_KEY),
    description: null,
    addedBy: 'Admin',
    fileName: 'vecchio.pdf',
    fileSize: BigInt(1234),
    mimeType: 'application/pdf',
    blobPath: OLD_KEY,
    visibility: 'ALWAYS',
    createdAt: new Date('2026-09-25T10:00:00.000Z'),
    ...over,
  };
}

function req(method: string, body?: unknown): NextRequest {
  return new Request(
    `https://webinar.example.gov.it/api/admin/events/${EVENT_ID}/materials/${MATERIAL_ID}`,
    {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    },
  ) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  storage.current = { delete: vi.fn().mockResolvedValue(true), list: vi.fn().mockResolvedValue([]) };
  mockedFind.mockResolvedValue(row());
  mockedDelete.mockResolvedValue({});
  mockedOtherRow.mockResolvedValue(null);
  mockedPrivacyNotice.mockResolvedValue(null);
  mockedUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    row(data),
  );
});

describe('DELETE /api/admin/events/[id]/materials/[materialId]', () => {
  it('toglie il file e poi la riga, e avvisa la sala', async () => {
    const res = await DELETE(req('DELETE'), ctx());
    expect(res.status).toBe(200);
    expect(mockedDelete).toHaveBeenCalledWith({ where: { id: MATERIAL_ID } });
    expect(storage.current!.delete).toHaveBeenCalledWith(OLD_KEY);
    expect(storage.current!.delete.mock.invocationCallOrder[0]).toBeLessThan(
      mockedDelete.mock.invocationCallOrder[0]!,
    );
    expect(poke).toHaveBeenCalledWith(EVENT_ID, 'materials');
  });

  it('se lo storage non risponde, il materiale resta: 503', async () => {
    storage.current!.delete.mockRejectedValue(new Error('down'));
    const res = await DELETE(req('DELETE'), ctx());
    expect(res.status).toBe(503);
    expect(mockedDelete).not.toHaveBeenCalled();
    expect(poke).not.toHaveBeenCalled();
  });

  it('il file che è l’informativa privacy di un evento resta', async () => {
    mockedPrivacyNotice.mockResolvedValue({ id: 'evento-con-quell-informativa' });
    const res = await DELETE(req('DELETE'), ctx());
    expect(res.status).toBe(200);
    expect(mockedDelete).toHaveBeenCalled();
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });

  it('un link non tocca lo storage', async () => {
    mockedFind.mockResolvedValue(row({ type: 'LINK', blobPath: null }));
    await DELETE(req('DELETE'), ctx());
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });

  it('il file che un altro materiale tiene ancora resta', async () => {
    // Una riga scritta prima che l'area admin rifiutasse le chiavi già in uso:
    // toglierla non deve togliere il file all'altro evento.
    mockedOtherRow.mockResolvedValue({ id: 'materiale-di-un-altro-evento' });
    const res = await DELETE(req('DELETE'), ctx());
    expect(res.status).toBe(200);
    expect(mockedDelete).toHaveBeenCalled();
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });

  it('una riga che punta a un asset che non è un materiale non lo cancella', async () => {
    mockedFind.mockResolvedValue(
      row({ blobPath: 'assets/image/2026/09/88888888-8888-4888-8888-888888888888-logo.png' }),
    );
    await DELETE(req('DELETE'), ctx());
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/events/[id]/materials/[materialId]', () => {
  it('un file sostituito: il vecchio blob se ne va', async () => {
    const res = await PATCH(
      req('PATCH', { url: servedUrl(NEW_KEY), blobPath: NEW_KEY, fileName: 'nuovo.pdf' }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(storage.current!.delete).toHaveBeenCalledWith(OLD_KEY);
    expect(storage.current!.delete).not.toHaveBeenCalledWith(NEW_KEY);
    expect(poke).toHaveBeenCalledWith(EVENT_ID, 'materials');
  });

  it('un file diventato link: il blob se ne va', async () => {
    await PATCH(
      req('PATCH', { type: 'LINK', url: 'https://example.org/doc', blobPath: null }),
      ctx(),
    );
    expect(storage.current!.delete).toHaveBeenCalledWith(OLD_KEY);
  });

  it('un file diventato link senza nominare blobPath: il link non tiene il file', async () => {
    const res = await PATCH(req('PATCH', { type: 'LINK', url: 'https://example.org/doc' }), ctx());
    expect(res.status).toBe(200);
    expect(mockedUpdate.mock.calls[0]![0].data).toMatchObject({ type: 'LINK', blobPath: null });
    expect(storage.current!.delete).toHaveBeenCalledWith(OLD_KEY);
  });

  it('un file nuovo su un link: 422', async () => {
    mockedFind.mockResolvedValue(row({ type: 'LINK', blobPath: null, url: 'https://example.org' }));
    const res = await PATCH(req('PATCH', { url: servedUrl(NEW_KEY), blobPath: NEW_KEY }), ctx());
    expect(res.status).toBe(422);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('un file che un’altra riga usa già: 422, niente scritto né cancellato', async () => {
    mockedOtherRow.mockResolvedValue({ id: 'materiale-di-un-altro-evento' });
    const res = await PATCH(
      req('PATCH', { url: servedUrl(NEW_KEY), blobPath: NEW_KEY }),
      ctx(),
    );
    expect(res.status).toBe(422);
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(storage.current!.delete).not.toHaveBeenCalled();
    // La riga che si modifica non conta.
    expect(mockedOtherRow).toHaveBeenCalledWith({
      where: {
        OR: [{ blobPath: NEW_KEY }, { url: { endsWith: `/api/assets/${NEW_KEY.slice(7)}` } }],
        id: { not: MATERIAL_ID },
      },
      select: { id: true },
    });
  });

  it('se il vecchio file non si cancella, la modifica non avviene: 503', async () => {
    storage.current!.delete.mockRejectedValue(new Error('down'));
    const res = await PATCH(
      req('PATCH', { url: servedUrl(NEW_KEY), blobPath: NEW_KEY, fileName: 'nuovo.pdf' }),
      ctx(),
    );
    expect(res.status).toBe(503);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('il salvataggio che rimanda lo stesso file non lo tocca', async () => {
    // L'editor dell'area admin rimanda tutti i campi, blobPath compreso.
    await PATCH(req('PATCH', { title: 'Slide aggiornate', blobPath: OLD_KEY }), ctx());
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });

  it('un blobPath che non è un documento caricato: 422, niente scritto né cancellato', async () => {
    const logo = 'assets/image/2026/09/88888888-8888-4888-8888-888888888888-logo.png';
    const res = await PATCH(req('PATCH', { url: servedUrl(logo), blobPath: logo }), ctx());
    expect(res.status).toBe(422);
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });

  it('un blobPath diverso dal file che l’URL serve: 422', async () => {
    const res = await PATCH(req('PATCH', { blobPath: NEW_KEY }), ctx());
    expect(res.status).toBe(422);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('una riga con una chiave d’altro tipo si modifica ancora se la chiave non cambia', async () => {
    const legacy = `events/${EVENT_ID}/files/programma.pdf`;
    mockedFind.mockResolvedValue(row({ blobPath: legacy }));
    const res = await PATCH(req('PATCH', { title: 'Programma', blobPath: legacy }), ctx());
    expect(res.status).toBe(200);
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });

  it('una modifica che non nomina il file non lo tocca', async () => {
    await PATCH(req('PATCH', { visibility: 'AFTER' }), ctx());
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });
});
