// @vitest-environment node
import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Togliere un materiale dalla sala.
 *
 * Un file caricato se ne va con la sua riga, e prima di lei: lasciato nello
 * storage resterebbe scaricabile da chi ha l'URL senza più nulla che lo elenchi
 * o lo cancelli (la pulizia per retention parte dalle righe). Se lo storage non
 * risponde, il materiale resta e si riprova. Il pannello di chi è in sala
 * rilegge subito.
 */
const { storage, poke } = vi.hoisted(() => ({
  storage: {
    current: null as null | { delete: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> },
  },
  poke: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn(), findFirst: vi.fn() },
    eventMaterial: { findUnique: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/storage', () => ({
  getFilesStorage: () => storage.current,
}));
vi.mock('@/lib/live-state/publish', () => ({
  pokeLivePanel: poke,
}));

import { prisma } from '@/lib/db';

import { DELETE } from './route';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedFind = prisma.eventMaterial.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedDelete = prisma.eventMaterial.delete as unknown as ReturnType<typeof vi.fn>;
const mockedOtherRow = prisma.eventMaterial.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedPrivacyNotice = prisma.event.findFirst as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const MATERIAL_ID = '55555555-5555-4555-8555-555555555555';
const SLUG = 'evento-di-prova';
const PRIMARY_TOKEN = 'PRIMARY_MOD_TOKEN';
const KEY = 'assets/document/2026/09/66666666-6666-4666-8666-666666666666-slide.pdf';

const ctx = () => ({ params: Promise.resolve({ param: SLUG, id: MATERIAL_ID }) });

function del(token: string | null = PRIMARY_TOKEN): NextRequest {
  return new Request(`https://webinar.example.gov.it/api/events/${SLUG}/materials/${MATERIAL_ID}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  storage.current = { delete: vi.fn().mockResolvedValue(true), list: vi.fn().mockResolvedValue([]) };
  mockedEvent.mockResolvedValue({ id: EVENT_ID, moderatorToken: PRIMARY_TOKEN });
  mockedGrant.mockResolvedValue(null);
  mockedFind.mockResolvedValue({ id: MATERIAL_ID, eventId: EVENT_ID, type: 'FILE', blobPath: KEY });
  mockedDelete.mockResolvedValue({});
  mockedOtherRow.mockResolvedValue(null);
  mockedPrivacyNotice.mockResolvedValue(null);
});

describe('DELETE /api/events/[slug]/materials/[id]', () => {
  it('un file caricato: via il blob e poi la riga, e la sala rilegge', async () => {
    const res = await DELETE(del(), ctx());
    expect(res.status).toBe(200);
    expect(mockedDelete).toHaveBeenCalledWith({ where: { id: MATERIAL_ID } });
    expect(storage.current!.delete).toHaveBeenCalledWith(KEY);
    expect(storage.current!.delete.mock.invocationCallOrder[0]).toBeLessThan(
      mockedDelete.mock.invocationCallOrder[0]!,
    );
    // La riga che se ne va non conta come «ancora usata».
    expect(mockedOtherRow).toHaveBeenCalledWith({
      where: { blobPath: KEY, id: { notIn: [MATERIAL_ID] } },
      select: { id: true },
    });
    expect(poke).toHaveBeenCalledWith(EVENT_ID, 'materials');
  });

  it('un file che un’altra riga usa ancora resta nello storage', async () => {
    mockedOtherRow.mockResolvedValue({ id: 'riga-di-un-altro-evento' });
    const res = await DELETE(del(), ctx());
    expect(res.status).toBe(200);
    expect(mockedDelete).toHaveBeenCalled();
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });

  it('una chiave fuori dai materiali non si cancella', async () => {
    mockedFind.mockResolvedValue({
      id: MATERIAL_ID,
      eventId: EVENT_ID,
      type: 'FILE',
      blobPath: 'assets/image/2026/09/66666666-6666-4666-8666-666666666666-logo.png',
    });
    const res = await DELETE(del(), ctx());
    expect(res.status).toBe(200);
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });

  it('un file che è l’informativa privacy di un evento resta nello storage', async () => {
    mockedPrivacyNotice.mockResolvedValue({ id: 'evento-con-quell-informativa' });
    const res = await DELETE(del(), ctx());
    expect(res.status).toBe(200);
    expect(mockedDelete).toHaveBeenCalled();
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });

  it('un link non tocca lo storage', async () => {
    mockedFind.mockResolvedValue({ id: MATERIAL_ID, eventId: EVENT_ID, type: 'LINK', blobPath: null });
    const res = await DELETE(del(), ctx());
    expect(res.status).toBe(200);
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });

  it('una riga che tiene un file lo cancella qualunque sia il tipo', async () => {
    // Righe scritte quando l'area admin accettava un `blobPath` anche sui link:
    // la retention le raccoglie per `blobPath`, e così anche la sala.
    mockedFind.mockResolvedValue({ id: MATERIAL_ID, eventId: EVENT_ID, type: 'LINK', blobPath: KEY });
    const res = await DELETE(del(), ctx());
    expect(res.status).toBe(200);
    expect(storage.current!.delete).toHaveBeenCalledWith(KEY);
  });

  it('se lo storage fallisce, il materiale resta e la risposta lo dice', async () => {
    storage.current!.delete.mockRejectedValue(new Error('down'));
    const res = await DELETE(del(), ctx());
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code?: string }).code).toBe('STORAGE_DELETE_FAILED');
    expect(mockedDelete).not.toHaveBeenCalled();
    expect(poke).not.toHaveBeenCalled();
  });

  it('una cancellazione che lo storage non conferma, con il file ancora lì: 503', async () => {
    storage.current!.delete.mockResolvedValue(false);
    storage.current!.list.mockResolvedValue([{ key: KEY }]);
    const res = await DELETE(del(), ctx());
    expect(res.status).toBe(503);
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('un file che non c’era già più: la riga se ne va', async () => {
    storage.current!.delete.mockResolvedValue(false);
    storage.current!.list.mockResolvedValue([]);
    const res = await DELETE(del(), ctx());
    expect(res.status).toBe(200);
    expect(mockedDelete).toHaveBeenCalled();
  });

  it('se il controllo sul database non riesce, niente è tolto', async () => {
    mockedOtherRow.mockRejectedValue(new Error('db down'));
    const res = await DELETE(del(), ctx());
    expect(res.status).toBe(503);
    expect(storage.current!.delete).not.toHaveBeenCalled();
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('un relatore non cancella: 403, niente storage', async () => {
    mockedGrant.mockResolvedValue({ eventId: EVENT_ID, revokedAt: null, role: 'SPEAKER' });
    const res = await DELETE(del('TOKEN_DEL_RELATORE'), ctx());
    expect(res.status).toBe(403);
    expect(mockedDelete).not.toHaveBeenCalled();
    expect(storage.current!.delete).not.toHaveBeenCalled();
    expect(poke).not.toHaveBeenCalled();
  });

  it('il materiale di un altro evento: 404, niente storage', async () => {
    mockedFind.mockResolvedValue({
      id: MATERIAL_ID,
      eventId: '99999999-9999-4999-8999-999999999999',
      type: 'FILE',
      blobPath: KEY,
    });
    const res = await DELETE(del(), ctx());
    expect(res.status).toBe(404);
    expect(mockedDelete).not.toHaveBeenCalled();
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });
});
