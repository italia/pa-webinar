import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Le slide accanto al video pubblicato, lette dal database: quale
 * registrazione è il video della pagina, quali materiali si possono ancora
 * mostrare, e le scelte dello staff (accese, scarto).
 */
// Senza memoria fra un test e l'altro.
vi.mock('@/lib/cache', () => ({ getCached: () => null, setCache: () => undefined }));
vi.mock('@/lib/db', () => ({
  prisma: {
    recording: { findFirst: vi.fn() },
    liveAction: { findMany: vi.fn(), findFirst: vi.fn() },
    eventMaterial: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

import { prisma } from '@/lib/db';

import {
  publicRecordingSlides,
  publicSlideFileKey,
  readRecordingSlides,
} from './recording-slides-data';

const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const recordingFindFirst = fn(prisma.recording.findFirst);
const actionsFindMany = fn(prisma.liveAction.findMany);
const actionFindFirst = fn(prisma.liveAction.findFirst);
const materialsFindMany = fn(prisma.eventMaterial.findMany);
const materialFindFirst = fn(prisma.eventMaterial.findFirst);

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const A = '55555555-5555-4555-8555-555555555555';
const B = '66666666-6666-4666-8666-666666666666';
const T0 = new Date('2026-10-21T09:00:00.000Z');
const URL_VIDEO = 'https://storage.example.net/recordings/sala.mp4';
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

/** Avvii e fermate della registrazione riferiti dalla sala. */
let registro: Array<{ at: Date; kind: string }> = [];
/** Le azioni della presentazione. */
let presentazione: Array<{ at: Date; kind: string; data: unknown }> = [];

function registrazione(over: Record<string, unknown> = {}) {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    eventId: EVENT_ID,
    blobKey: 'recordings/sala.mp4',
    // Una composita nasce a file caricato, un po' dopo la fine.
    createdAt: new Date(T0.getTime() + 3_700_000),
    durationSec: 3600,
    slidesEnabled: true,
    slidesOffsetSec: 0,
    callSession: { endedAt: new Date(T0.getTime() + 3_700_000) },
    ...over,
  };
}

function materiale(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: id === A ? 'Slide della sessione' : 'Secondo documento',
    type: 'FILE',
    mimeType: 'application/pdf',
    fileName: id === A ? 'sessione.pdf' : 'secondo',
    url: `https://webinar.example.gov.it/api/assets/document/2026/10/${id}-x.pdf`,
    blobPath: `assets/document/2026/10/${id}-x.pdf`,
    visibility: 'ALWAYS',
    ...over,
  };
}

const evento = (over: Record<string, unknown> = {}) => ({
  id: EVENT_ID,
  slug: 'evento-di-prova',
  status: 'ENDED',
  recordingUrl: URL_VIDEO,
  recordingPublished: true,
  postEventShowMaterials: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  recordingFindFirst.mockResolvedValue(registrazione());
  // L'avvio della registrazione riferito dalla sala alle 9:00: lo zero
  // esatto. Il materiale è stato presentato in sala.
  registro = [{ at: T0, kind: 'recording.started' }];
  actionFindFirst.mockResolvedValue({ id: 'azione' });
  materialFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) =>
    [A, B].includes(where.id) ? materiale(where.id) : null
  );
  presentazione = [
    {
      at: at(-60),
      kind: 'presentation.started',
      data: { materialId: A, title: 'Slide', page: 1 },
    },
    {
      at: at(30),
      kind: 'presentation.page',
      data: { materialId: A, title: 'Slide', page: 2 },
    },
    {
      at: at(300),
      kind: 'presentation.started',
      data: { materialId: B, title: 'Altro', page: 1 },
    },
    {
      at: at(400),
      kind: 'presentation.stopped',
      data: { materialId: B, title: 'Altro' },
    },
  ];
  actionsFindMany.mockImplementation(
    async ({ where }: { where: { kind: { in: string[] } } }) =>
      where.kind.in.includes('recording.started') ? registro : presentazione
  );
  materialsFindMany.mockResolvedValue([materiale(A), materiale(B)]);
});

describe('publicRecordingSlides', () => {
  it('le slide del video pubblicato, sullo zero della registrazione della sala', async () => {
    const r = await publicRecordingSlides(evento());
    expect(recordingFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: EVENT_ID, callSession: { recordingUrl: URL_VIDEO } },
      })
    );
    expect(r?.cues).toEqual([
      { start: 0, end: 30, materialId: A, page: 1 },
      { start: 30, end: 300, materialId: A, page: 2 },
      { start: 300, end: 400, materialId: B, page: 1 },
    ]);
    expect(r?.materials).toEqual([
      {
        id: A,
        title: 'Slide della sessione',
        fileUrl: `/api/events/evento-di-prova/recording/slides?m=${A}`,
        downloadName: 'sessione.pdf',
      },
      {
        id: B,
        title: 'Secondo documento',
        fileUrl: `/api/events/evento-di-prova/recording/slides?m=${B}`,
        downloadName: 'secondo.pdf',
      },
    ]);
    // La chiave del file non esce verso la pagina.
    expect(JSON.stringify(r)).not.toContain('assets/document');
  });

  it('lo scarto dello staff sposta i cambi', async () => {
    recordingFindFirst.mockResolvedValue(registrazione({ slidesOffsetSec: 5 }));
    const r = await publicRecordingSlides(evento());
    expect(r?.cues.map((c) => c.start)).toEqual([0, 35, 305]);
  });

  it('con i materiali spenti sulla pagina, niente slide: non si leggono nemmeno', async () => {
    expect(
      await publicRecordingSlides(evento({ postEventShowMaterials: false }))
    ).toBeNull();
    expect(recordingFindFirst).not.toHaveBeenCalled();
  });

  it('un materiale tolto, o non visibile dopo l’evento, lascia un vuoto', async () => {
    materialsFindMany.mockResolvedValue([
      materiale(A, { visibility: 'DURING' }),
      materiale(B),
    ]);
    const r = await publicRecordingSlides(evento());
    expect(r?.cues).toEqual([{ start: 300, end: 400, materialId: B, page: 1 }]);
    expect(r?.materials.map((m) => m.id)).toEqual([B]);

    materialsFindMany.mockResolvedValue([materiale(B)]);
    const r2 = await publicRecordingSlides(evento());
    expect(r2?.materials.map((m) => m.id)).toEqual([B]);
  });

  it('nessun materiale da mostrare: nessuna slide', async () => {
    materialsFindMany.mockResolvedValue([
      materiale(A, { visibility: 'BEFORE' }),
      materiale(B, { type: 'LINK', blobPath: null }),
    ]);
    expect(await publicRecordingSlides(evento())).toBeNull();
  });

  it('nessuna presentazione nel tempo del video: nessuna slide', async () => {
    presentazione = [
      { at: at(4000), kind: 'presentation.started', data: { materialId: A, page: 1 } },
    ];
    expect(await publicRecordingSlides(evento())).toBeNull();
  });

  it('slide spente dallo staff: nessuna slide, e il registro non si legge', async () => {
    recordingFindFirst.mockResolvedValue(registrazione({ slidesEnabled: false }));
    expect(await publicRecordingSlides(evento())).toBeNull();
    expect(actionsFindMany).not.toHaveBeenCalled();
  });

  it('video caricato a mano, non della sala: nessuna slide', async () => {
    recordingFindFirst.mockResolvedValue(null);
    expect(await publicRecordingSlides(evento())).toBeNull();
  });

  it('segnaposto multitraccia senza il video: nessuna slide', async () => {
    recordingFindFirst.mockResolvedValue(
      registrazione({ blobKey: `recordings/multitrack/${EVENT_ID}/x/` })
    );
    expect(await publicRecordingSlides(evento())).toBeNull();
  });

  it('video non pubblicato o evento non concluso: niente, senza leggere il database', async () => {
    expect(await publicRecordingSlides(evento({ recordingPublished: false }))).toBeNull();
    expect(await publicRecordingSlides(evento({ status: 'LIVE' }))).toBeNull();
    expect(await publicRecordingSlides(evento({ recordingUrl: null }))).toBeNull();
    expect(recordingFindFirst).not.toHaveBeenCalled();
  });
});

describe('readRecordingSlides', () => {
  it('i materiali presentati, con il motivo per cui uno non si mostra', async () => {
    materialsFindMany.mockResolvedValue([materiale(B, { visibility: 'DURING' })]);
    const dati = await readRecordingSlides(registrazione());
    expect(dati.exactZero).toBe(true);
    expect(dati.materials).toEqual([
      { id: A, title: 'Slide', fileName: null, problem: 'deleted', blobPath: null },
      {
        id: B,
        title: 'Secondo documento',
        fileName: 'secondo',
        problem: 'notVisibleAfter',
        blobPath: null,
      },
    ]);
  });

  it('un id che non è un UUID non arriva al database', async () => {
    presentazione = [
      {
        at: at(10),
        kind: 'presentation.started',
        data: { materialId: 'non-un-uuid', page: 1 },
      },
    ];
    const dati = await readRecordingSlides(registrazione());
    expect(materialsFindMany).not.toHaveBeenCalled();
    expect(dati.materials).toEqual([]);
    expect(dati.marks).toHaveLength(1);
  });

  it('senza avvio riferito lo zero è stimato', async () => {
    registro = [];
    const dati = await readRecordingSlides(registrazione());
    expect(dati.exactZero).toBe(false);
  });

  it('legge solo le azioni della presentazione e la fine dell’evento', async () => {
    await readRecordingSlides(registrazione());
    expect(actionsFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          eventId: EVENT_ID,
          kind: {
            in: [
              'presentation.started',
              'presentation.page',
              'presentation.stopped',
              'event.ended',
            ],
          },
        },
        orderBy: { at: 'asc' },
      })
    );
  });
});

describe('zero e fine del video', () => {
  it('avvii e fermate si leggono fino all’arrivo del file', async () => {
    const dati = await readRecordingSlides(registrazione());
    const where = actionsFindMany.mock.calls
      .map((c) => c[0].where)
      .find((w) => w.kind.in.includes('recording.started'));
    expect(where.kind.in).toEqual(['recording.started', 'recording.stopped']);
    expect(where.at.lte).toEqual(new Date(T0.getTime() + 3_700_000));
    expect(dati.exactZero).toBe(true);
    expect(dati.durationSec).toBe(3600);
    expect(dati.marks[0]).toMatchObject({ t: -60, kind: 'started' });
  });

  it('multitraccia con il mix di Jibri: l’ancora è l’arrivo del file, non la nascita della riga', async () => {
    // La riga multitraccia nasce alle 8:50 con la diretta (e lì partono le
    // tracce); il mix parte alle 9:00 e arriva alle 10:00, dopo un'ora.
    const dati = await readRecordingSlides(
      registrazione({
        createdAt: new Date(T0.getTime() - 600_000),
        callSession: { endedAt: new Date(T0.getTime() + 3_600_000) },
      })
    );
    expect(dati.exactZero).toBe(true);
    expect(dati.marks[0]).toMatchObject({ t: -60 });
  });

  it('fermata e riavviata subito: vale l’avvio più vicino all’inizio stimato', async () => {
    // Un minuto di prova dalle 9:00, ripartita alle 9:01:30; il file del
    // minuto arriva alle 9:02.
    registro = [
      { at: T0, kind: 'recording.started' },
      { at: at(60), kind: 'recording.stopped' },
      { at: at(90), kind: 'recording.started' },
    ];
    const dati = await readRecordingSlides(
      registrazione({ durationSec: 60, callSession: { endedAt: at(120) } })
    );
    expect(dati.marks[0]).toMatchObject({ t: -60 });
  });

  it('senza avvio riferito: l’arrivo meno la durata, dichiarato stimato', async () => {
    registro = [];
    const dati = await readRecordingSlides(
      registrazione({ callSession: { endedAt: new Date(T0.getTime() + 3_600_000) } })
    );
    expect(dati.exactZero).toBe(false);
    expect(dati.marks[0]).toMatchObject({ t: -60 });
  });

  it('senza durata: l’ultimo tratto chiuso prima dell’arrivo, fino alla sua fermata', async () => {
    // Dalle 9:00 alle 9:30, poi un altro tratto dalle 9:31; il file del primo
    // arriva alle 9:33, mentre il secondo è ancora aperto.
    registro = [
      { at: T0, kind: 'recording.started' },
      { at: at(1800), kind: 'recording.stopped' },
      { at: at(1860), kind: 'recording.started' },
    ];
    presentazione = [
      { at: at(10), kind: 'presentation.started', data: { materialId: A, page: 1 } },
      // Presentato nel secondo tratto.
      { at: at(1900), kind: 'presentation.started', data: { materialId: B, page: 1 } },
    ];
    recordingFindFirst.mockResolvedValue(
      registrazione({ durationSec: null, callSession: { endedAt: at(1980) } })
    );
    const r = await publicRecordingSlides(evento());
    expect(r?.cues).toEqual([{ start: 10, end: 1800, materialId: A, page: 1 }]);
    expect(r?.materials.map((m) => m.id)).toEqual([A]);
  });

  it('senza durata né avvio: l’arrivo, stimato, senza fine', async () => {
    registro = [];
    const dati = await readRecordingSlides(registrazione({ durationSec: null }));
    expect(dati.exactZero).toBe(false);
    expect(dati.durationSec).toBeNull();
  });
});

describe('publicSlideFileKey', () => {
  it('la chiave del file di una slide mostrata accanto al video', async () => {
    expect(await publicSlideFileKey(evento(), A)).toBe(
      `assets/document/2026/10/${A}-x.pdf`
    );
  });

  it('un materiale non mostrato, o le slide spente: null', async () => {
    materialsFindMany.mockResolvedValue([
      materiale(A, { visibility: 'DURING' }),
      materiale(B),
    ]);
    expect(await publicSlideFileKey(evento(), A)).toBeNull();
    expect(await publicSlideFileKey(evento(), B)).toBe(
      `assets/document/2026/10/${B}-x.pdf`
    );
    expect(
      await publicSlideFileKey(evento({ postEventShowMaterials: false }), B)
    ).toBeNull();
    recordingFindFirst.mockResolvedValue(registrazione({ slidesEnabled: false }));
    expect(await publicSlideFileKey(evento(), B)).toBeNull();
  });

  it('prima i controlli che costano poco: senza di loro la cronologia non si legge', async () => {
    // Non un UUID.
    expect(await publicSlideFileKey(evento(), 'nope')).toBeNull();
    expect(materialFindFirst).not.toHaveBeenCalled();
    // Un materiale di un altro evento, o che non c'è.
    expect(
      await publicSlideFileKey(evento(), '99999999-9999-4999-8999-999999999999')
    ).toBeNull();
    // Visibile solo durante l'evento.
    materialFindFirst.mockResolvedValueOnce(materiale(A, { visibility: 'DURING' }));
    expect(await publicSlideFileKey(evento(), A)).toBeNull();
    // Mai presentato in sala.
    actionFindFirst.mockResolvedValueOnce(null);
    expect(await publicSlideFileKey(evento(), A)).toBeNull();
    expect(actionsFindMany).not.toHaveBeenCalled();
    expect(recordingFindFirst).not.toHaveBeenCalled();
    // La presenza in sala si cerca nei dati delle azioni, per quel materiale.
    expect(actionFindFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ data: { path: ['materialId'], equals: A } }),
      })
    );
  });
});
