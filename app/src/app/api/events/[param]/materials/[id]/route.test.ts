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
    eventMaterial: { findUnique: vi.fn(), findFirst: vi.fn(), delete: vi.fn(), update: vi.fn() },
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

import { DELETE, PATCH } from './route';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedFind = prisma.eventMaterial.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedDelete = prisma.eventMaterial.delete as unknown as ReturnType<typeof vi.fn>;
const mockedOtherRow = prisma.eventMaterial.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedPrivacyNotice = prisma.event.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedUpdate = prisma.eventMaterial.update as unknown as ReturnType<typeof vi.fn>;

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

/**
 * Correggere un materiale dalla sala: titolo, descrizione e fase in cui il
 * pubblico lo vede. Stessa autorizzazione della cancellazione; il pannello di
 * chi è in sala rilegge subito, perché cambiare la fase può farlo comparire o
 * sparire per il pubblico.
 */
describe('PATCH /api/events/[slug]/materials/[id]', () => {
  function patch(body: unknown, token: string | null = PRIMARY_TOKEN, id = MATERIAL_ID) {
    const req = new Request(
      `https://webinar.example.gov.it/api/events/${SLUG}/materials/${id}`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      },
    ) as unknown as NextRequest;
    return PATCH(req, { params: Promise.resolve({ param: SLUG, id }) });
  }

  beforeEach(() => {
    mockedFind.mockResolvedValue({ id: MATERIAL_ID, eventId: EVENT_ID });
    mockedUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: MATERIAL_ID,
      eventId: EVENT_ID,
      type: 'LINK',
      title: 'Slide',
      url: 'https://example.org/slide',
      description: null,
      addedBy: '',
      fileName: null,
      fileSize: null,
      mimeType: null,
      blobPath: 'non/deve/uscire',
      visibility: 'ALWAYS',
      openCount: 7,
      createdAt: new Date('2026-09-25T10:00:00.000Z'),
      ...data,
    }));
  });

  it('aggiorna titolo, descrizione e fase; la sala rilegge', async () => {
    const res = await patch({ title: '  Slide finali ', description: 'Versione 2', visibility: 'AFTER' });
    expect(res.status).toBe(200);
    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: MATERIAL_ID },
      data: { title: 'Slide finali', description: 'Versione 2', visibility: 'AFTER' },
    });
    expect(poke).toHaveBeenCalledWith(EVENT_ID, 'materials');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ id: MATERIAL_ID, title: 'Slide finali', visibility: 'AFTER', openCount: 7 });
    expect(body).not.toHaveProperty('blobPath');
  });

  it('solo i campi mandati; una descrizione vuota la toglie', async () => {
    const res = await patch({ description: '' });
    expect(res.status).toBe(200);
    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: MATERIAL_ID },
      data: { description: null },
    });
  });

  it('un co-moderatore può correggere', async () => {
    mockedGrant.mockResolvedValue({ eventId: EVENT_ID, revokedAt: null, role: 'MODERATOR' });
    const res = await patch({ title: 'Nuovo' }, 'TOKEN_DEL_COMODERATORE');
    expect(res.status).toBe(200);
  });

  it('senza token: 401', async () => {
    const res = await patch({ title: 'Nuovo' }, null);
    expect(res.status).toBe(401);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('un relatore non corregge: 403, niente avviso', async () => {
    mockedGrant.mockResolvedValue({ eventId: EVENT_ID, revokedAt: null, role: 'SPEAKER' });
    const res = await patch({ title: 'Nuovo' }, 'TOKEN_DEL_RELATORE');
    expect(res.status).toBe(403);
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(poke).not.toHaveBeenCalled();
  });

  it.each([
    ['un titolo vuoto', { title: '   ' }],
    ['un titolo oltre il limite', { title: 'x'.repeat(301) }],
    ['una descrizione oltre il limite', { description: 'x'.repeat(501) }],
    ['una fase sconosciuta', { visibility: 'SEMPRE' }],
    ['l’indirizzo, che dalla sala non si cambia', { url: 'https://example.org/altro' }],
    ['niente da cambiare', {}],
  ])('%s: 422, niente scritto', async (_caso, body) => {
    const res = await patch(body);
    expect(res.status).toBe(422);
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(poke).not.toHaveBeenCalled();
  });

  it('il materiale di un altro evento: 404', async () => {
    mockedFind.mockResolvedValue({ id: MATERIAL_ID, eventId: '99999999-9999-4999-8999-999999999999' });
    const res = await patch({ title: 'Nuovo' });
    expect(res.status).toBe(404);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('un id che non è un UUID: 404 senza interrogare il materiale', async () => {
    const res = await patch({ title: 'Nuovo' }, PRIMARY_TOKEN, 'non-un-uuid');
    expect(res.status).toBe(404);
    expect(mockedFind).not.toHaveBeenCalled();
  });

  it('tolto nel frattempo da qualcun altro: 404, non 500', async () => {
    mockedUpdate.mockRejectedValue(Object.assign(new Error('not found'), { code: 'P2025' }));
    const res = await patch({ title: 'Nuovo' });
    expect(res.status).toBe(404);
  });
});
