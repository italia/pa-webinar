// @vitest-environment node
/**
 * Quale file un materiale può puntare, e quando il file se ne va.
 *
 * La colonna `blobPath` arriva dal client nell'area admin, aperta anche
 * all'organizzatore sui propri eventi. Se la cancellazione se ne fidasse,
 * togliere un proprio materiale potrebbe cancellare il logo del sito, un
 * allegato di chat, il file di un altro evento o la sua informativa privacy.
 * Qui si prova che non succede: si cancellano solo chiavi dei materiali, solo
 * quando nessun'altra riga le tiene e nessun evento le usa come informativa, e
 * un file che lo storage non conferma di aver cancellato lo si dice, perché la
 * riga resti.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { storage } = vi.hoisted(() => ({
  storage: {
    current: null as null | { delete: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> },
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findFirst: vi.fn(), findMany: vi.fn() },
    eventMaterial: { findFirst: vi.fn(), findMany: vi.fn() },
    chatMessage: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/storage', () => ({
  getFilesStorage: () => storage.current,
}));

import { prisma } from '@/lib/db';

import {
  discardUploadedBlob,
  isMaterialUploadKey,
  materialBlobClaimProblem,
  materialBlobPathProblem,
  materialBlobsOfEvents,
  removeFilesOfEventsBeingDeleted,
  removeMaterialBlob,
  removeMaterialBlobs,
} from './material-files';

const mockedFindFirst = prisma.eventMaterial.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedFindMany = prisma.eventMaterial.findMany as unknown as ReturnType<typeof vi.fn>;
const mockedPrivacyNotice = prisma.event.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedEvents = prisma.event.findMany as unknown as ReturnType<typeof vi.fn>;
const mockedChat = prisma.chatMessage.findMany as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_EVENT_ID = '99999999-9999-4999-8999-999999999999';
const KEY = 'assets/document/2026/09/66666666-6666-4666-8666-666666666666-slide.pdf';
const URL_OF_KEY = `https://webinar.example.gov.it/api/assets/${KEY.slice('assets/'.length)}`;
const SERVED = `/api/assets/${KEY.slice('assets/'.length)}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  storage.current = { delete: vi.fn().mockResolvedValue(true), list: vi.fn().mockResolvedValue([]) };
  mockedFindFirst.mockResolvedValue(null);
  mockedPrivacyNotice.mockResolvedValue(null);
  mockedEvents.mockResolvedValue([]);
  mockedChat.mockResolvedValue([]);
  mockedFindMany.mockResolvedValue([]);
});

describe('isMaterialUploadKey', () => {
  it('riconosce le chiavi che l’app scrive per i documenti caricati', () => {
    expect(isMaterialUploadKey(KEY)).toBe(true);
    expect(
      isMaterialUploadKey('assets/document/2026/04/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee-file'),
    ).toBe(true);
  });

  it('rifiuta ogni altro asset dello storage', () => {
    for (const key of [
      'assets/image/2026/09/66666666-6666-4666-8666-666666666666-logo.png',
      'assets/audio/2026/09/66666666-6666-4666-8666-666666666666-attesa.mp3',
      `assets/chat/${EVENT_ID}/2026/09/66666666-6666-4666-8666-666666666666-doc.pdf`,
      `events/${EVENT_ID}/recording`,
      'assets/document/../image/2026/09/66666666-6666-4666-8666-666666666666-logo.png',
      'assets/document/2026/09/66666666-6666-4666-8666-666666666666-a/../../x.pdf',
      'assets/document/slide.pdf',
    ]) {
      expect(isMaterialUploadKey(key), key).toBe(false);
    }
  });
});

describe('materialBlobPathProblem', () => {
  it('va bene la chiave di un documento con l’URL che la serve', () => {
    expect(materialBlobPathProblem(KEY, URL_OF_KEY)).toBeNull();
    // Anche con l'app pubblicata sotto un percorso.
    expect(
      materialBlobPathProblem(KEY, `https://ente.example.gov.it/webinar/api/assets/${KEY.slice(7)}`),
    ).toBeNull();
  });

  it('rifiuta una chiave che non è di un documento caricato', () => {
    const logo = 'assets/image/2026/09/66666666-6666-4666-8666-666666666666-logo.png';
    expect(materialBlobPathProblem(logo, `https://x.example/api/assets/${logo.slice(7)}`)).toMatch(
      /blobPath/,
    );
  });

  it('rifiuta una chiave diversa dal file che l’URL serve', () => {
    const other = 'assets/document/2026/09/77777777-7777-4777-8777-777777777777-altro.pdf';
    expect(materialBlobPathProblem(other, URL_OF_KEY)).toMatch(/served by url/);
    expect(materialBlobPathProblem(KEY, 'https://example.org/slide.pdf')).toMatch(/served by url/);
  });
});

describe('materialBlobClaimProblem', () => {
  it('un documento appena caricato, che nessuno usa: va bene', async () => {
    expect(await materialBlobClaimProblem(KEY)).toBeNull();
    expect(mockedFindFirst).toHaveBeenCalledWith({
      where: { OR: [{ blobPath: KEY }, { url: { endsWith: SERVED } }] },
      select: { id: true },
    });
    expect(mockedPrivacyNotice).toHaveBeenCalledWith({
      where: { privacyPolicyUrl: { endsWith: SERVED } },
      select: { id: true },
    });
  });

  it('il file che un altro materiale tiene o mostra: rifiutato', async () => {
    mockedFindFirst.mockResolvedValue({ id: 'materiale-di-un-altro-evento' });
    expect(await materialBlobClaimProblem(KEY)).toMatch(/already used/);
  });

  it('l’informativa privacy di un evento: rifiutata', async () => {
    mockedPrivacyNotice.mockResolvedValue({ id: 'evento-b' });
    expect(await materialBlobClaimProblem(KEY)).toMatch(/already used/);
  });

  it('in una modifica la riga stessa non conta', async () => {
    await materialBlobClaimProblem(KEY, 'mat-1');
    expect(mockedFindFirst).toHaveBeenCalledWith({
      where: { OR: [{ blobPath: KEY }, { url: { endsWith: SERVED } }], id: { not: 'mat-1' } },
      select: { id: true },
    });
  });
});

describe('removeMaterialBlob', () => {
  it('cancella il file che nessun’altra riga tiene', async () => {
    expect(await removeMaterialBlob(KEY, EVENT_ID, { materialIds: ['mat-1'] })).toBe('deleted');
    expect(storage.current!.delete).toHaveBeenCalledWith(KEY);
    // Conta solo chi tiene la chiave, non la riga che se ne va.
    expect(mockedFindFirst).toHaveBeenCalledWith({
      where: { blobPath: KEY, id: { notIn: ['mat-1'] } },
      select: { id: true },
    });
  });

  it('lascia il file che un’altra riga tiene ancora', async () => {
    mockedFindFirst.mockResolvedValue({ id: 'altra-riga' });
    expect(await removeMaterialBlob(KEY, EVENT_ID)).toBe('kept');
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });

  it('un link allo stesso URL non tiene in vita il file', async () => {
    // Un link non possiede il file: che lo si possa aggiungere con un URL
    // qualunque non deve bastare a lasciarlo nello storage per sempre.
    await removeMaterialBlob(KEY, EVENT_ID);
    const where = (mockedFindFirst.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where).not.toHaveProperty('OR');
    expect(where).not.toHaveProperty('url');
    expect(storage.current!.delete).toHaveBeenCalledWith(KEY);
  });

  it('lascia il file che è l’informativa privacy di un evento', async () => {
    mockedPrivacyNotice.mockResolvedValue({ id: 'evento-b' });
    expect(await removeMaterialBlob(KEY, EVENT_ID)).toBe('kept');
    expect(mockedPrivacyNotice).toHaveBeenCalledWith({
      where: { privacyPolicyUrl: { endsWith: SERVED } },
      select: { id: true },
    });
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });

  it('gli eventi in cancellazione non contano, né i materiali né l’informativa', async () => {
    await removeMaterialBlob(KEY, EVENT_ID, { eventIds: [EVENT_ID] });
    expect(mockedFindFirst).toHaveBeenCalledWith({
      where: { blobPath: KEY, eventId: { notIn: [EVENT_ID] } },
      select: { id: true },
    });
    expect(mockedPrivacyNotice).toHaveBeenCalledWith({
      where: { privacyPolicyUrl: { endsWith: SERVED }, id: { notIn: [EVENT_ID] } },
      select: { id: true },
    });
  });

  it('non tocca mai una chiave fuori dai materiali, nemmeno interrogando il DB', async () => {
    for (const key of [
      'assets/image/2026/09/66666666-6666-4666-8666-666666666666-logo.png',
      `assets/chat/${OTHER_EVENT_ID}/2026/09/66666666-6666-4666-8666-666666666666-doc.pdf`,
      `events/${EVENT_ID}/recording`,
    ]) {
      expect(await removeMaterialBlob(key, EVENT_ID), key).toBe('kept');
    }
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });

  it('il caricamento per evento: solo dentro la cartella dello stesso evento', async () => {
    expect(await removeMaterialBlob(`events/${EVENT_ID}/files/slide.pdf`, EVENT_ID)).toBe('deleted');
    expect(await removeMaterialBlob(`events/${OTHER_EVENT_ID}/files/slide.pdf`, EVENT_ID)).toBe(
      'kept',
    );
    expect(
      await removeMaterialBlob(`events/${EVENT_ID}/files/../../assets/image/logo.png`, EVENT_ID),
    ).toBe('kept');
    expect(await removeMaterialBlob(`events/${EVENT_ID}/files/..`, EVENT_ID)).toBe('kept');
    expect(storage.current!.delete).toHaveBeenCalledTimes(1);
    expect(storage.current!.delete).toHaveBeenCalledWith(`events/${EVENT_ID}/files/slide.pdf`);
  });

  it('se il controllo non riesce, il file resta e l’esito lo dice', async () => {
    mockedFindFirst.mockRejectedValue(new Error('db down'));
    expect(await removeMaterialBlob(KEY, EVENT_ID)).toBe('failed');
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });

  it('se lo storage solleva: failed, senza sollevare', async () => {
    storage.current!.delete.mockRejectedValue(new Error('down'));
    await expect(removeMaterialBlob(KEY, EVENT_ID)).resolves.toBe('failed');
  });

  it('una cancellazione non confermata: decide lo storage, cercando la chiave', async () => {
    storage.current!.delete.mockResolvedValue(false);
    storage.current!.list.mockResolvedValue([{ key: KEY }]);
    expect(await removeMaterialBlob(KEY, EVENT_ID)).toBe('failed');
    expect(storage.current!.list).toHaveBeenCalledWith(KEY);

    // Non c'era già più: la riga può andarsene.
    storage.current!.list.mockResolvedValue([]);
    expect(await removeMaterialBlob(KEY, EVENT_ID)).toBe('deleted');
  });

  it('senza chiave o senza storage non fa nulla', async () => {
    expect(await removeMaterialBlob(null, EVENT_ID)).toBe('kept');
    storage.current = null;
    expect(await removeMaterialBlob(KEY, EVENT_ID)).toBe('kept');
  });
});

describe('discardUploadedBlob', () => {
  it('toglie il blob appena scritto senza interrogare il DB', async () => {
    await discardUploadedBlob(KEY);
    expect(storage.current!.delete).toHaveBeenCalledWith(KEY);
    expect(mockedFindFirst).not.toHaveBeenCalled();
  });

  it('non solleva se lo storage fallisce', async () => {
    storage.current!.delete.mockRejectedValue(new Error('down'));
    await expect(discardUploadedBlob(KEY)).resolves.toBeUndefined();
  });
});

describe('materialBlobsOfEvents + removeMaterialBlobs', () => {
  it('legge le righe che tengono un file, qualunque sia il tipo', async () => {
    mockedFindMany.mockResolvedValue([
      { id: 'mat-1', eventId: EVENT_ID, blobPath: KEY },
      { id: 'mat-2', eventId: EVENT_ID, blobPath: null },
    ]);
    const where = { id: { in: [EVENT_ID] }, createdById: 'org-1' };
    const refs = await materialBlobsOfEvents(where);
    expect(mockedFindMany).toHaveBeenCalledWith({
      where: { event: where, blobPath: { not: null } },
      select: { id: true, eventId: true, blobPath: true },
    });
    expect(refs).toEqual([{ id: 'mat-1', eventId: EVENT_ID, blobPath: KEY }]);
  });

  it('cancella ogni file con le stesse regole, e dice quanti e quali no', async () => {
    const refs = Array.from({ length: 12 }, (_, i) => ({
      id: `mat-${i}`,
      eventId: EVENT_ID,
      blobPath: `assets/document/2026/09/66666666-6666-4666-8666-6666666666${String(i).padStart(2, '0')}-f.pdf`,
    }));
    refs.push({ id: 'logo', eventId: EVENT_ID, blobPath: 'assets/image/2026/09/x-logo.png' });
    storage.current!.delete.mockImplementation(async (key: string) => {
      if (key.includes('666666666603-')) throw new Error('down');
      return true;
    });
    const esito = await removeMaterialBlobs(refs);
    expect(esito.deleted).toBe(11);
    expect(esito.failed.map((r) => r.id)).toEqual(['mat-3']);
    expect(storage.current!.delete).toHaveBeenCalledTimes(12);
  });
});

describe('removeFilesOfEventsBeingDeleted', () => {
  const CHAT_KEY = `assets/chat/${EVENT_ID}/2026/09/66666666-6666-4666-8666-666666666666-doc.pdf`;

  beforeEach(() => {
    mockedEvents.mockResolvedValue([{ id: EVENT_ID }]);
    mockedFindMany.mockResolvedValue([{ id: 'mat-1', eventId: EVENT_ID, blobPath: KEY }]);
    mockedChat.mockResolvedValue([{ eventId: EVENT_ID, attachmentBlobPath: CHAT_KEY }]);
  });

  it('cancella i file dei materiali e gli allegati della chat degli eventi', async () => {
    const where = { id: { in: [EVENT_ID] }, createdById: 'org-1' };
    expect(await removeFilesOfEventsBeingDeleted(where)).toBe(2);
    expect(mockedEvents).toHaveBeenCalledWith({ where, select: { id: true } });
    expect(mockedChat).toHaveBeenCalledWith({
      where: { eventId: { in: [EVENT_ID] }, attachmentBlobPath: { not: null } },
      select: { eventId: true, attachmentBlobPath: true },
    });
    expect(storage.current!.delete).toHaveBeenCalledWith(KEY);
    expect(storage.current!.delete).toHaveBeenCalledWith(CHAT_KEY);
    // I materiali degli eventi in cancellazione non tengono in vita il file.
    expect(mockedFindFirst).toHaveBeenCalledWith({
      where: { blobPath: KEY, eventId: { notIn: [EVENT_ID] } },
      select: { id: true },
    });
  });

  it('un allegato fuori dallo spazio del suo evento non si tocca', async () => {
    mockedChat.mockResolvedValue([
      { eventId: EVENT_ID, attachmentBlobPath: `assets/chat/${OTHER_EVENT_ID}/x.pdf` },
    ]);
    expect(await removeFilesOfEventsBeingDeleted({ id: EVENT_ID })).toBe(1);
    expect(storage.current!.delete).not.toHaveBeenCalledWith(`assets/chat/${OTHER_EVENT_ID}/x.pdf`);
  });

  it('un file che non si cancella ferma la cancellazione: 503', async () => {
    storage.current!.delete.mockImplementation(async (key: string) => {
      if (key === CHAT_KEY) throw new Error('down');
      return true;
    });
    await expect(removeFilesOfEventsBeingDeleted({ id: EVENT_ID })).rejects.toMatchObject({
      statusCode: 503,
      code: 'STORAGE_DELETE_FAILED',
    });

    storage.current!.delete.mockImplementation(async (key: string) => key !== KEY);
    storage.current!.list.mockResolvedValue([{ key: KEY }]);
    await expect(removeFilesOfEventsBeingDeleted({ id: EVENT_ID })).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('nessun evento: niente da cancellare', async () => {
    mockedEvents.mockResolvedValue([]);
    expect(await removeFilesOfEventsBeingDeleted({ id: EVENT_ID })).toBe(0);
    expect(mockedFindMany).not.toHaveBeenCalled();
    expect(storage.current!.delete).not.toHaveBeenCalled();
  });
});
