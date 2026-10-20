import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Lo stato della presentazione lato server: cosa si può presentare, come si
 * legge la riga, e la chiusura quando il materiale presentato viene tolto.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    eventPresentation: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock('@/lib/live-state/publish', () => ({ publishPresentation: vi.fn() }));
vi.mock('@/lib/live/actions', () => ({ recordLiveAction: vi.fn(async () => undefined) }));
vi.mock('@/lib/crypto/pii', () => ({
  tryDecryptPII: (v: string) => {
    if (v === 'CHIAVE_SBAGLIATA') throw new Error('chiave');
    return v.startsWith('enc:') ? v.slice(4) : v;
  },
}));

import { prisma } from '@/lib/db';
import { recordLiveAction } from '@/lib/live/actions';
import { publishPresentation } from '@/lib/live-state/publish';

import {
  NO_PRESENTATION,
  endPresentationOfMaterial,
  isPresentableMaterial,
  isPresentationOpen,
  pointerForStatus,
  presentationStateOf,
  readPresentationPointer,
  type PresentationRow,
} from './state';

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const MATERIAL_ID = '55555555-5555-4555-8555-555555555555';
const KEY = 'assets/document/2026/10/77777777-7777-4777-8777-777777777777-slide.pdf';

const mockedFind = prisma.eventPresentation.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const mockedUpdateMany = prisma.eventPresentation.updateMany as unknown as ReturnType<
  typeof vi.fn
>;
const publish = publishPresentation as unknown as ReturnType<typeof vi.fn>;
const journal = recordLiveAction as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe('isPresentableMaterial', () => {
  const base = {
    type: 'FILE',
    mimeType: 'application/pdf',
    fileName: 'slide.pdf',
    url: `https://webinar.example.gov.it/api/${KEY}`,
    blobPath: KEY,
  };

  it('un PDF caricato fra i materiali sì', () => {
    expect(isPresentableMaterial(base, EVENT_ID)).toBe(true);
    // Anche il caricamento per evento, e una riga senza tipo con estensione .pdf.
    expect(
      isPresentableMaterial(
        { ...base, mimeType: null, blobPath: `events/${EVENT_ID}/files/slide.pdf` },
        EVENT_ID
      )
    ).toBe(true);
  });

  it('un link, un altro formato, un file senza blob o fuori dai materiali no', () => {
    expect(
      isPresentableMaterial({ ...base, type: 'LINK', blobPath: null }, EVENT_ID)
    ).toBe(false);
    expect(
      isPresentableMaterial(
        { ...base, mimeType: 'text/plain', fileName: 'note.txt' },
        EVENT_ID
      )
    ).toBe(false);
    expect(isPresentableMaterial({ ...base, blobPath: null }, EVENT_ID)).toBe(false);
    expect(
      isPresentableMaterial({ ...base, blobPath: 'recordings/x.pdf' }, EVENT_ID)
    ).toBe(false);
    // Il caricamento per evento di un ALTRO evento.
    expect(
      isPresentableMaterial(
        {
          ...base,
          blobPath: 'events/99999999-9999-4999-8999-999999999999/files/slide.pdf',
        },
        EVENT_ID
      )
    ).toBe(false);
  });
});

describe('readPresentationPointer', () => {
  it('senza riga: nessuna presentazione, versione zero', async () => {
    mockedFind.mockResolvedValue(null);
    expect(await readPresentationPointer(EVENT_ID)).toEqual(NO_PRESENTATION);
  });

  it('chiusa: la pagina non conta, la versione sì', async () => {
    mockedFind.mockResolvedValue({ materialId: null, page: 7, version: 9 });
    expect(await readPresentationPointer(EVENT_ID)).toEqual({
      materialId: null,
      page: 1,
      version: 9,
    });
  });
});

describe('presentationStateOf: chi presenta', () => {
  const evento = { slug: 'evento-di-prova', moderatorName: 'Conduzione' };
  function riga(over: Partial<PresentationRow> = {}): PresentationRow {
    return {
      materialId: MATERIAL_ID,
      page: 2,
      pageCount: null,
      presenterRole: 'SPEAKER',
      startedAt: null,
      version: 3,
      material: { title: 'Slide' },
      presenter: { name: 'enc:Relatrice di prova' },
      ...over,
    };
  }

  it('una concessione nominale: il suo nome, decifrato', () => {
    expect(presentationStateOf(riga(), evento).presentation?.presenterName).toBe(
      'Relatrice di prova'
    );
  });

  it('il link principale: il nome del conduttore scritto sull’evento, o nessuno', () => {
    const r = riga({ presenter: null, presenterRole: 'MODERATOR' });
    expect(presentationStateOf(r, evento).presentation?.presenterName).toBe('Conduzione');
    expect(
      presentationStateOf(r, { ...evento, moderatorName: null }).presentation
        ?.presenterName
    ).toBeNull();
  });

  it('una concessione cancellata nel frattempo (relatore): nessun nome', () => {
    expect(
      presentationStateOf(riga({ presenter: null }), evento).presentation?.presenterName
    ).toBeNull();
  });

  it('una chiave di cifratura sbagliata non ferma la presentazione', () => {
    const r = riga({ presenter: { name: 'CHIAVE_SBAGLIATA' } });
    expect(presentationStateOf(r, evento).presentation).toMatchObject({
      presenterName: null,
      title: 'Slide',
    });
  });

  it('un ruolo sconosciuto non passa', () => {
    expect(
      presentationStateOf(riga({ presenterRole: 'ALTRO' }), evento).presentation
        ?.presenterRole
    ).toBeNull();
  });
});

describe('evento concluso', () => {
  it('nessuna presentazione dopo la fine, con la stessa versione', () => {
    expect(isPresentationOpen('LIVE')).toBe(true);
    expect(isPresentationOpen('IDLE')).toBe(true);
    expect(isPresentationOpen('ENDED')).toBe(false);
    expect(isPresentationOpen('ARCHIVED')).toBe(false);
    const p = { materialId: MATERIAL_ID, page: 4, version: 6 };
    expect(pointerForStatus(p, 'LIVE')).toBe(p);
    expect(pointerForStatus(p, 'ENDED')).toEqual({
      materialId: null,
      page: 1,
      version: 6,
    });
  });
});

describe('endPresentationOfMaterial', () => {
  it('chiude la presentazione di quel materiale e lo annuncia', async () => {
    mockedUpdateMany.mockResolvedValue({ count: 1 });
    mockedFind.mockResolvedValue({ materialId: null, page: 1, version: 10 });
    await endPresentationOfMaterial(
      EVENT_ID,
      { id: MATERIAL_ID, title: 'Slide' },
      'moderator'
    );
    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { eventId: EVENT_ID, materialId: MATERIAL_ID },
      data: expect.objectContaining({ materialId: null, version: { increment: 1 } }),
    });
    expect(publish).toHaveBeenCalledWith(EVENT_ID, {
      materialId: null,
      page: 1,
      version: 10,
    });
    expect(journal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'presentation.stopped',
        data: { materialId: MATERIAL_ID, title: 'Slide', reason: 'material.deleted' },
      })
    );
  });

  it('un materiale che nessuno presenta: niente annuncio', async () => {
    mockedUpdateMany.mockResolvedValue({ count: 0 });
    await endPresentationOfMaterial(
      EVENT_ID,
      { id: MATERIAL_ID, title: 'Slide' },
      'moderator'
    );
    expect(publish).not.toHaveBeenCalled();
    expect(journal).not.toHaveBeenCalled();
  });

  it('un errore del database non fa fallire chi toglie il materiale', async () => {
    mockedUpdateMany.mockRejectedValue(new Error('db giù'));
    const errori = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      endPresentationOfMaterial(
        EVENT_ID,
        { id: MATERIAL_ID, title: 'Slide' },
        'moderator'
      )
    ).resolves.toBeUndefined();
    errori.mockRestore();
  });
});
