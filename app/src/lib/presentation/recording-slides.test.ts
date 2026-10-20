import { describe, expect, it } from 'vitest';

import {
  SLIDE_OFFSET_MAX_SEC,
  buildSlideCues,
  chapterIndexes,
  cuePosition,
  marksFromActions,
  offsetToAlign,
  titlesFromActions,
  videoSegmentFromJournal,
  withAvailableMaterials,
  type SlideCue,
} from './recording-slides';

/**
 * Dalla cronologia della sala ai tratti del video: quale pagina si vede a ogni
 * istante della registrazione, con lo scarto corretto dallo staff, con più
 * registrazioni dello stesso evento, con le chiusure e i passaggi di mano.
 */

const A = '55555555-5555-4555-8555-555555555555';
const B = '66666666-6666-4666-8666-666666666666';
const T0 = new Date('2026-10-21T09:00:00.000Z');

/** Un'azione del registro a `sec` secondi dallo zero. */
function az(sec: number, kind: string, data: Record<string, unknown> = {}) {
  return { at: new Date(T0.getTime() + sec * 1000), kind, data };
}
const avvio = (
  sec: number,
  materialId: string,
  page = 1,
  extra: Record<string, unknown> = {}
) => az(sec, 'presentation.started', { materialId, title: 'Slide', page, ...extra });
const pagina = (sec: number, materialId: string, page: number) =>
  az(sec, 'presentation.page', { materialId, title: 'Slide', page, pageCount: 20 });
const chiusura = (sec: number, materialId: string) =>
  az(sec, 'presentation.stopped', { materialId, title: 'Slide' });

function tratti(
  azioni: ReturnType<typeof az>[],
  opts: { offsetSec?: number; durationSec?: number | null; t0?: Date } = {}
): SlideCue[] {
  return buildSlideCues(marksFromActions(azioni, opts.t0 ?? T0), {
    offsetSec: opts.offsetSec ?? 0,
    durationSec: opts.durationSec === undefined ? 600 : opts.durationSec,
  });
}

describe('marksFromActions', () => {
  it('mette le azioni sullo zero, in ordine di tempo, e scarta le altre', () => {
    const marks = marksFromActions(
      [
        pagina(30.5, A, 2),
        avvio(-12, A),
        az(5, 'poll.opened', { question: 'Domanda' }),
        az(40, 'event.ended'),
        chiusura(35, A),
      ],
      T0
    );
    expect(marks).toEqual([
      { t: -12, kind: 'started', materialId: A, page: 1 },
      { t: 30.5, kind: 'page', materialId: A, page: 2 },
      { t: 35, kind: 'stopped', materialId: A, page: null },
      { t: 40, kind: 'closed', materialId: null, page: null },
    ]);
  });

  it('scarta un avvio senza materiale e una pagina senza numero valido', () => {
    const marks = marksFromActions(
      [
        az(1, 'presentation.started', { title: 'x' }),
        az(2, 'presentation.page', { materialId: A, page: 0 }),
        az(3, 'presentation.page', { materialId: A, page: 'tre' }),
        az(4, 'presentation.page', { materialId: A, page: 2.5 }),
      ],
      T0
    );
    expect(marks).toEqual([]);
  });

  it('a pari ora tiene l’ordine di arrivo', () => {
    const marks = marksFromActions([chiusura(10, A), avvio(10, B)], T0);
    expect(marks.map((m) => m.kind)).toEqual(['stopped', 'started']);
  });
});

describe('titlesFromActions', () => {
  it('l’ultimo titolo scritto per ogni materiale', () => {
    const titoli = titlesFromActions([
      az(1, 'presentation.started', { materialId: A, title: 'Prima' }),
      az(2, 'presentation.page', { materialId: A, title: '  Dopo  ', page: 2 }),
      az(3, 'presentation.started', { materialId: B, title: '' }),
      az(4, 'poll.opened', { materialId: B, title: 'Non conta' }),
    ]);
    expect(titoli.get(A)).toBe('Dopo');
    expect(titoli.has(B)).toBe(false);
  });
});

describe('buildSlideCues', () => {
  it('avvio, pagine e chiusura diventano tratti del video', () => {
    expect(
      tratti([avvio(10, A), pagina(70, A, 2), pagina(130, A, 3), chiusura(200, A)])
    ).toEqual([
      { start: 10, end: 70, materialId: A, page: 1 },
      { start: 70, end: 130, materialId: A, page: 2 },
      { start: 130, end: 200, materialId: A, page: 3 },
    ]);
  });

  it('una presentazione rimasta aperta arriva alla fine del video', () => {
    expect(tratti([avvio(10, A), pagina(70, A, 2)])).toEqual([
      { start: 10, end: 70, materialId: A, page: 1 },
      { start: 70, end: 600, materialId: A, page: 2 },
    ]);
  });

  it('senza durata nota l’ultimo tratto resta aperto', () => {
    expect(tratti([avvio(10, A)], { durationSec: null })).toEqual([
      { start: 10, end: null, materialId: A, page: 1 },
    ]);
  });

  it('cominciata prima della registrazione: il video si apre sulla pagina di quel momento', () => {
    expect(tratti([avvio(-300, A), pagina(-120, A, 4), pagina(60, A, 5)])).toEqual([
      { start: 0, end: 60, materialId: A, page: 4 },
      { start: 60, end: 600, materialId: A, page: 5 },
    ]);
  });

  it('chiusa prima della registrazione: nessuna slide', () => {
    expect(tratti([avvio(-300, A), chiusura(-10, A)])).toEqual([]);
  });

  it('i fatti dopo la fine del video non ci sono', () => {
    expect(
      tratti([avvio(10, A), pagina(590, A, 2), pagina(600, A, 3), pagina(700, A, 4)])
    ).toEqual([
      { start: 10, end: 590, materialId: A, page: 1 },
      { start: 590, end: 600, materialId: A, page: 2 },
    ]);
  });

  it('lo scarto positivo sposta i cambi più tardi nel video', () => {
    expect(tratti([avvio(10, A), pagina(70, A, 2)], { offsetSec: 5 })).toEqual([
      { start: 15, end: 75, materialId: A, page: 1 },
      { start: 75, end: 600, materialId: A, page: 2 },
    ]);
  });

  it('lo scarto negativo li anticipa, e ciò che cade prima dello zero apre il video', () => {
    expect(tratti([avvio(10, A), pagina(70, A, 2)], { offsetSec: -20 })).toEqual([
      { start: 0, end: 50, materialId: A, page: 1 },
      { start: 50, end: 600, materialId: A, page: 2 },
    ]);
  });

  it('lo scarto può portare dentro il video un fatto che era dopo la fine', () => {
    expect(tratti([avvio(10, A), pagina(610, A, 2)], { offsetSec: -30 })).toEqual([
      { start: 0, end: 580, materialId: A, page: 1 },
      { start: 580, end: 600, materialId: A, page: 2 },
    ]);
  });

  it('passaggio di mano sulla stessa pagina: nessun cambio visibile, un tratto solo', () => {
    expect(
      tratti([
        avvio(10, A, 1),
        pagina(40, A, 3),
        avvio(90, A, 3, { handover: true }),
        pagina(150, A, 4),
      ])
    ).toEqual([
      { start: 10, end: 40, materialId: A, page: 1 },
      { start: 40, end: 150, materialId: A, page: 3 },
      { start: 150, end: 600, materialId: A, page: 4 },
    ]);
  });

  it('passaggio di mano da un’altra pagina: la slide cambia', () => {
    expect(tratti([avvio(10, A, 1), avvio(90, A, 6, { handover: true })])).toEqual([
      { start: 10, end: 90, materialId: A, page: 1 },
      { start: 90, end: 600, materialId: A, page: 6 },
    ]);
  });

  it('un altro documento sostituisce quello a schermo, senza chiusura in mezzo', () => {
    expect(
      tratti([avvio(10, A), pagina(50, A, 2), avvio(100, B), pagina(160, B, 2)])
    ).toEqual([
      { start: 10, end: 50, materialId: A, page: 1 },
      { start: 50, end: 100, materialId: A, page: 2 },
      { start: 100, end: 160, materialId: B, page: 1 },
      { start: 160, end: 600, materialId: B, page: 2 },
    ]);
  });

  it('la chiusura di un documento non più a schermo non chiude quello nuovo', () => {
    expect(tratti([avvio(10, A), avvio(100, B), chiusura(101, A)])).toEqual([
      { start: 10, end: 100, materialId: A, page: 1 },
      { start: 100, end: 600, materialId: B, page: 1 },
    ]);
  });

  it('pausa: chiusa e ripresa più tardi, nel mezzo nessuna slide', () => {
    expect(
      tratti([avvio(10, A), pagina(40, A, 5), chiusura(100, A), avvio(300, A, 5)])
    ).toEqual([
      { start: 10, end: 40, materialId: A, page: 1 },
      { start: 40, end: 100, materialId: A, page: 5 },
      { start: 300, end: 600, materialId: A, page: 5 },
    ]);
  });

  it('la fine dell’evento chiude la presentazione', () => {
    expect(tratti([avvio(10, A), az(400, 'event.ended')])).toEqual([
      { start: 10, end: 400, materialId: A, page: 1 },
    ]);
  });

  it('una pagina dice anche il documento a schermo, anche senza il suo avvio', () => {
    expect(tratti([pagina(10, A, 2)])).toEqual([
      { start: 10, end: 600, materialId: A, page: 2 },
    ]);
    expect(tratti([avvio(10, A), pagina(20, B, 3)])).toEqual([
      { start: 10, end: 20, materialId: A, page: 1 },
      { start: 20, end: 600, materialId: B, page: 3 },
    ]);
  });

  it('più fatti nello stesso istante: conta come finisce', () => {
    expect(
      tratti([avvio(10, A), pagina(50, A, 2), pagina(50, A, 1), pagina(80, A, 3)])
    ).toEqual([
      { start: 10, end: 80, materialId: A, page: 1 },
      { start: 80, end: 600, materialId: A, page: 3 },
    ]);
  });

  it('più registrazioni dello stesso evento: ciascuna con il suo tratto di cronologia', () => {
    // Prima registrazione dalle 9:00 per 10 minuti, seconda dalle 9:20 per 15.
    const azioni = [
      avvio(300, A),
      pagina(900, A, 2),
      pagina(1500, A, 3),
      chiusura(2000, A),
    ];
    expect(tratti(azioni, { durationSec: 600 })).toEqual([
      { start: 300, end: 600, materialId: A, page: 1 },
    ]);
    const t0Seconda = new Date(T0.getTime() + 1200 * 1000);
    expect(tratti(azioni, { durationSec: 900, t0: t0Seconda })).toEqual([
      { start: 0, end: 300, materialId: A, page: 2 },
      { start: 300, end: 800, materialId: A, page: 3 },
    ]);
  });

  it('uno scarto non numerico vale zero', () => {
    expect(tratti([avvio(10, A)], { offsetSec: Number.NaN })).toEqual([
      { start: 10, end: 600, materialId: A, page: 1 },
    ]);
  });
});

describe('withAvailableMaterials', () => {
  it('i tratti di un materiale tolto lasciano un vuoto', () => {
    const cues = tratti([avvio(10, A), avvio(100, B), avvio(200, A)]);
    expect(withAvailableMaterials(cues, (id) => id === A)).toEqual([
      { start: 10, end: 100, materialId: A, page: 1 },
      { start: 200, end: 600, materialId: A, page: 1 },
    ]);
  });
});

describe('cuePosition', () => {
  const cues = tratti([avvio(10, A), pagina(70, A, 2), chiusura(100, A), avvio(300, B)], {
    durationSec: null,
  });
  const pos = (t: number) => cuePosition(cues, t);

  it('il tratto in corso, con l’inizio incluso e la fine esclusa', () => {
    expect(pos(0)).toEqual({ last: -1, active: false });
    expect(pos(9.999)).toEqual({ last: -1, active: false });
    expect(pos(10)).toEqual({ last: 0, active: true });
    expect(pos(69.9)).toEqual({ last: 0, active: true });
    expect(pos(70)).toEqual({ last: 1, active: true });
    expect(pos(99.99)).toEqual({ last: 1, active: true });
  });

  it('nel vuoto fra due presentazioni: l’ultimo tratto passato, non in corso', () => {
    expect(pos(100)).toEqual({ last: 1, active: false });
    expect(pos(299)).toEqual({ last: 1, active: false });
    expect(pos(300)).toEqual({ last: 2, active: true });
    expect(pos(99_999)).toEqual({ last: 2, active: true });
  });

  it('nessun tratto: nessuna slide', () => {
    expect(cuePosition([], 5)).toEqual({ last: -1, active: false });
  });
});

describe('chapterIndexes', () => {
  it('fuori le pagine solo attraversate e ciò che comincia dopo la fine del video', () => {
    const cues = tratti(
      [avvio(10, A), pagina(70, A, 2), pagina(72, A, 3), pagina(74, A, 4)],
      {
        durationSec: null,
      }
    );
    expect(chapterIndexes(cues)).toEqual([0, 3]);
    expect(chapterIndexes(cues, { minSec: 1 })).toEqual([0, 1, 2, 3]);
    expect(chapterIndexes(cues, { videoDurationSec: 72 })).toEqual([0]);
  });
});

describe('offsetToAlign', () => {
  const cues = tratti([avvio(10, A), pagina(70, A, 2), chiusura(130, A)]);

  it('fa cadere all’istante indicato il cambio più vicino', () => {
    // Il video mostra il cambio a 70, la persona parla di pagina 2 a 74.
    expect(offsetToAlign(cues, 0, 74)).toBe(4);
    // Da uno scarto già corretto si somma.
    expect(offsetToAlign(cues, 3, 66)).toBe(-1);
  });

  it('la fine del video non è un cambio di slide', () => {
    const aperta = tratti([avvio(10, A)]);
    expect(offsetToAlign(aperta, 0, 590, 600)).toBe(580);
  });

  it('nessun cambio da allineare: null', () => {
    expect(offsetToAlign([], 0, 10)).toBeNull();
  });

  it('resta entro lo scarto massimo', () => {
    const lontano = tratti([avvio(10, A)], { durationSec: null });
    expect(offsetToAlign(lontano, 0, 99_999)).toBe(SLIDE_OFFSET_MAX_SEC);
  });
});

describe('videoSegmentFromJournal', () => {
  const ora = (min: number, sec = 0) =>
    new Date(T0.getTime() + min * 60_000 + sec * 1000);
  const segmento = (o: {
    avvii: Date[];
    fermate?: Date[];
    arrivo: Date;
    durationSec: number | null;
  }) => videoSegmentFromJournal({ fermate: [], ...o });

  it('con la durata: l’avvio del tratto chiuso che le corrisponde', () => {
    // Un'ora dalle 9:00, caricata in tre minuti.
    expect(
      segmento({
        avvii: [ora(0)],
        fermate: [ora(60)],
        arrivo: ora(63),
        durationSec: 3600,
      })
    ).toEqual({ t0: ora(0), exact: true, durationSec: 3600 });
  });

  it('fermata e riavviata subito: non l’avvio successivo', () => {
    // Un minuto di prova dalle 9:00, ripartita alle 9:01:30; il file del minuto
    // arriva alle 9:02. Con le fermate e senza.
    const avvii = [ora(0), ora(1, 30)];
    expect(
      segmento({ avvii, fermate: [ora(1)], arrivo: ora(2), durationSec: 60 }).t0
    ).toEqual(ora(0));
    expect(segmento({ avvii, arrivo: ora(2), durationSec: 60 }).t0).toEqual(ora(0));
  });

  it('due file caricati in ordine inverso: decide la durata', () => {
    // A dalle 9:00 alle 9:30, arriva alle 9:40; B dalle 9:31 alle 9:35, arriva prima.
    const avvii = [ora(0), ora(31)];
    const fermate = [ora(30), ora(35)];
    expect(segmento({ avvii, fermate, arrivo: ora(40), durationSec: 1800 }).t0).toEqual(
      ora(0)
    );
    expect(segmento({ avvii, fermate, arrivo: ora(37), durationSec: 240 }).t0).toEqual(
      ora(31)
    );
  });

  it('senza avvio plausibile: la stima, dichiarata', () => {
    expect(segmento({ avvii: [ora(-300)], arrivo: ora(63), durationSec: 3600 })).toEqual({
      t0: ora(3),
      exact: false,
      durationSec: 3600,
    });
  });

  it('senza durata: l’ultimo tratto chiuso, non quello ancora aperto', () => {
    expect(
      segmento({
        avvii: [ora(0), ora(31)],
        fermate: [ora(30)],
        arrivo: ora(33),
        durationSec: null,
      })
    ).toEqual({ t0: ora(0), exact: true, durationSec: 1800 });
  });

  it('senza durata né fermate: dall’ultimo avvio all’arrivo; senza avvii, l’arrivo', () => {
    expect(segmento({ avvii: [ora(0)], arrivo: ora(20), durationSec: null })).toEqual({
      t0: ora(0),
      exact: true,
      durationSec: 1200,
    });
    expect(segmento({ avvii: [], arrivo: ora(20), durationSec: null })).toEqual({
      t0: ora(20),
      exact: false,
      durationSec: null,
    });
  });
});
