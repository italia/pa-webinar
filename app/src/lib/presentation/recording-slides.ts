/**
 * Le slide presentate in sala, accanto alla registrazione pubblicata.
 *
 * PERCHÉ. Il PDF presentato in sala si vede nel riquadro della sala, non nella
 * videochiamata: la registrazione non lo contiene. Il registro della sala
 * (`live_actions`, lib/live/actions.ts) dice però quale pagina era a schermo
 * e da quando, con l'ora del server: messo sullo zero del video (l'avvio
 * della registrazione riferito dalla sala, ./recording-slides-data),
 * diventa una serie di tratti del video, ciascuno con la sua pagina. La pagina pubblica dell'evento mostra la pagina del tratto in cui
 * si trova il video.
 *
 * COME. I fatti della presentazione (`presentation.started`, `.page`,
 * `.stopped`, e la fine dell'evento, che chiude la sala) si leggono in ordine
 * di tempo come una macchina a stati: avvio di un documento, cambio di
 * pagina, chiusura. Ciò che succede prima del primo fotogramma decide la
 * pagina con cui il video si apre; ciò che succede dopo la sua fine non
 * conta. Un passaggio di mano sullo stesso documento e la stessa pagina non
 * cambia nulla di visibile, quindi non apre un tratto nuovo. Lo scarto
 * (`offsetSec`) sposta tutti i cambi sul video: positivo più tardi, negativo
 * prima, quando lo zero è fuori di qualche secondo.
 *
 * Pura e senza import di runtime: la usano il server (pagina pubblica, rotte)
 * e il browser (l'anteprima dello staff ricalcola i tratti a ogni correzione
 * dello scarto, senza chiedere nulla al server).
 */

import { PRESENTATION_PAGE_MAX } from './types';

/** Lo scarto massimo, in secondi, in un verso o nell'altro: un'ora. */
export const SLIDE_OFFSET_MAX_SEC = 3600;

/**
 * Un tratto più breve di così è una pagina solo attraversata (chi presenta ne
 * ha girate diverse di fila): si vede nel video, ma non entra nell'elenco
 * delle slide, dove sarebbe rumore. Lo stesso criterio della cronologia della
 * post-produzione (`withoutFleetingPages`).
 */
export const SLIDE_CHAPTER_MIN_SEC = 5;

/** Un fatto della presentazione, in secondi dallo zero della registrazione. */
export interface PresentationMark {
  /** Secondi dallo zero della registrazione (negativi: prima del primo fotogramma). */
  t: number;
  /**
   * started: un documento a schermo, da una pagina; page: un cambio di
   * pagina; stopped: la presentazione chiusa; closed: l'evento concluso, che
   * chiude la sala e con lei la presentazione.
   */
  kind: 'started' | 'page' | 'stopped' | 'closed';
  materialId: string | null;
  page: number | null;
}

/** Un tratto del video in cui si vede una pagina. */
export interface SlideCue {
  /** Inizio, in secondi dal primo fotogramma, incluso. */
  start: number;
  /** Fine esclusa; null fino alla fine del video, quando la sua durata non si conosce. */
  end: number | null;
  materialId: string;
  /** Pagina del PDF, da 1. */
  page: number;
}

/** Un materiale le cui pagine compaiono accanto al video. */
export interface SlideMaterialView {
  id: string;
  title: string;
  /** Dove pdf.js legge il documento: una rotta che controlla chi può leggerlo. */
  fileUrl: string;
  /** Il nome con cui scaricarlo; null se la pagina non offre lo scaricamento. */
  downloadName: string | null;
}

/** Le slide accanto al video, come le riceve la pagina che le mostra. */
export interface RecordingSlidesView {
  cues: SlideCue[];
  materials: SlideMaterialView[];
}

/** Le azioni del registro che contano per le slide. */
export const SLIDE_ACTION_KINDS = [
  'presentation.started',
  'presentation.page',
  'presentation.stopped',
  'event.ended',
] as const;

const KIND: Record<(typeof SLIDE_ACTION_KINDS)[number], PresentationMark['kind']> = {
  'presentation.started': 'started',
  'presentation.page': 'page',
  'presentation.stopped': 'stopped',
  'event.ended': 'closed',
};

function testo(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function pagina(v: unknown): number | null {
  return typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= 1 &&
    v <= PRESENTATION_PAGE_MAX
    ? v
    : null;
}

/** Tre decimali: i tempi del registro sono al millisecondo, oltre è rumore. */
function arrotonda(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * I fatti della presentazione dal registro, in secondi dallo zero `t0`, in
 * ordine di tempo (a pari ora, nell'ordine di arrivo). Le azioni di altro
 * genere e quelle senza un materiale, quando serve, restano fuori.
 */
export function marksFromActions(
  azioni: ReadonlyArray<{ at: Date; kind: string; data: unknown }>,
  t0: Date
): PresentationMark[] {
  const zero = t0.getTime();
  return azioni
    .map((a, i) => ({ a, i }))
    .sort((x, y) => x.a.at.getTime() - y.a.at.getTime() || x.i - y.i)
    .flatMap(({ a }): PresentationMark[] => {
      const kind = KIND[a.kind as keyof typeof KIND];
      if (!kind) return [];
      const data = (a.data && typeof a.data === 'object' ? a.data : {}) as Record<
        string,
        unknown
      >;
      const materialId = testo(data.materialId);
      if ((kind === 'started' || kind === 'page') && !materialId) return [];
      if (kind === 'page' && pagina(data.page) === null) return [];
      return [
        {
          t: arrotonda((a.at.getTime() - zero) / 1000),
          kind,
          materialId,
          page: pagina(data.page),
        },
      ];
    });
}

/**
 * Il titolo di ogni materiale come lo dice il registro, l'ultimo scritto: per
 * nominare anche un materiale che nel frattempo è stato tolto.
 */
export function titlesFromActions(
  azioni: ReadonlyArray<{ kind: string; data: unknown }>
): Map<string, string> {
  const titoli = new Map<string, string>();
  for (const a of azioni) {
    if (!(a.kind in KIND)) continue;
    const data = (a.data && typeof a.data === 'object' ? a.data : {}) as Record<
      string,
      unknown
    >;
    const id = testo(data.materialId);
    const titolo = testo(typeof data.title === 'string' ? data.title.trim() : null);
    if (id && titolo) titoli.set(id, titolo);
  }
  return titoli;
}

interface Schermo {
  materialId: string;
  page: number;
}

/** Cosa c'è a schermo dopo il fatto `m`, a partire da `prima`. */
function applica(prima: Schermo | null, m: PresentationMark): Schermo | null {
  switch (m.kind) {
    case 'started':
      return { materialId: m.materialId!, page: m.page ?? 1 };
    case 'page':
      // Un cambio di pagina dice anche quale documento è a schermo: la rotta
      // lo scrive solo per il documento presentato in quel momento, e due
      // scritture vicinissime possono arrivare al registro in ordine inverso.
      return { materialId: m.materialId!, page: m.page! };
    case 'stopped':
      // La chiusura di un documento che non è più a schermo (ne era già
      // partito un altro) non chiude quello nuovo.
      return !prima || !m.materialId || m.materialId === prima.materialId ? null : prima;
    case 'closed':
      return null;
  }
}

function uguali(a: Schermo | null, b: Schermo | null): boolean {
  return a === b || (!!a && !!b && a.materialId === b.materialId && a.page === b.page);
}

/**
 * I tratti del video, in ordine, senza sovrapposizioni.
 *
 * `durationSec` è la durata del video, quando la si conosce: i fatti da lì in
 * poi non sono nel video, e l'ultimo tratto finisce lì. `offsetSec` sposta i
 * fatti sul video (positivo: più tardi). Un fatto che con lo scarto cade
 * prima del primo fotogramma decide la pagina iniziale.
 */
export function buildSlideCues(
  marks: readonly PresentationMark[],
  opts: { offsetSec: number; durationSec: number | null }
): SlideCue[] {
  const fine = opts.durationSec && opts.durationSec > 0 ? opts.durationSec : null;
  const scarto = Number.isFinite(opts.offsetSec) ? opts.offsetSec : 0;

  // I cambi di ciò che è a schermo, sul tempo del video.
  const cambi: Array<{ v: number; schermo: Schermo | null }> = [{ v: 0, schermo: null }];
  let schermo: Schermo | null = null;
  for (const m of marks) {
    const v = arrotonda(Math.max(0, m.t + scarto));
    if (fine !== null && v >= fine) break;
    schermo = applica(schermo, m);
    const ultimo = cambi[cambi.length - 1]!;
    if (ultimo.v === v) {
      // Più fatti nello stesso istante: conta come finisce.
      ultimo.schermo = schermo;
    } else if (!uguali(ultimo.schermo, schermo)) {
      cambi.push({ v, schermo });
    }
  }

  const tratti: SlideCue[] = [];
  for (let i = 0; i < cambi.length; i++) {
    const c = cambi[i]!;
    // Due cambi di seguito con lo stesso schermo (quello di mezzo è stato
    // assorbito da un fatto nello stesso istante): il tratto continua.
    const ultimo = tratti[tratti.length - 1];
    if (c.schermo && ultimo && ultimo.end === c.v && uguali(ultimo, c.schermo)) {
      ultimo.end = cambi[i + 1]?.v ?? fine;
      continue;
    }
    if (!c.schermo) continue;
    tratti.push({
      start: c.v,
      end: cambi[i + 1]?.v ?? fine,
      materialId: c.schermo.materialId,
      page: c.schermo.page,
    });
  }
  return tratti.filter((c) => c.end === null || c.end > c.start);
}

/**
 * I tratti dei soli materiali che si possono mostrare: gli altri (tolti, o non
 * visibili dopo l'evento) lasciano un vuoto, in cui non si vede nessuna
 * slide.
 */
export function withAvailableMaterials(
  cues: readonly SlideCue[],
  disponibile: (materialId: string) => boolean
): SlideCue[] {
  return cues.filter((c) => disponibile(c.materialId));
}

/**
 * Dove si trova l'istante `t` del video rispetto ai tratti: l'ultimo tratto
 * cominciato (`last`, -1 prima del primo) e se è ancora in corso (`active`).
 * Il prossimo tratto è `last + 1`. Cambia solo quando il video passa un bordo:
 * chi lo segue può ridisegnare ai cambi di slide e non a ogni fotogramma.
 */
export function cuePosition(
  cues: readonly SlideCue[],
  t: number
): { last: number; active: boolean } {
  let lo = 0;
  let hi = cues.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid]!.start <= t) {
      last = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const c = cues[last];
  return { last, active: !!c && (c.end === null || t < c.end) };
}

/**
 * Gli indici dei tratti che entrano nell'elenco delle slide: quelli rimasti a
 * schermo almeno `minSec` secondi (l'ultimo senza fine conta sempre), e che
 * cominciano prima della fine del video, se la si conosce.
 */
export function chapterIndexes(
  cues: readonly SlideCue[],
  opts: { minSec?: number; videoDurationSec?: number | null } = {}
): number[] {
  const min = opts.minSec ?? SLIDE_CHAPTER_MIN_SEC;
  const durata =
    opts.videoDurationSec && opts.videoDurationSec > 0 ? opts.videoDurationSec : null;
  const out: number[] = [];
  cues.forEach((c, i) => {
    if (durata !== null && c.start >= durata) return;
    const fine = c.end ?? durata;
    if (fine !== null && fine - c.start < min) return;
    out.push(i);
  });
  return out;
}

/**
 * Lo scarto che fa cadere all'istante `t` del video il cambio di slide più
 * vicino: chi rivede il video si ferma dove la slide dovrebbe cambiare, e lo
 * scarto si calcola da lì. `cues` sono i tratti con lo scarto `attuale`; la
 * fine del video (`durationSec`) non è un cambio di slide. Null se non c'è
 * nessun cambio da allineare.
 */
export function offsetToAlign(
  cues: readonly SlideCue[],
  attuale: number,
  t: number,
  durationSec: number | null = null
): number | null {
  const bordi = new Set<number>();
  for (const c of cues) {
    if (c.start > 0) bordi.add(c.start);
    if (c.end !== null && (durationSec === null || c.end < durationSec)) bordi.add(c.end);
  }
  let vicino: number | null = null;
  for (const b of bordi) {
    if (vicino === null || Math.abs(b - t) < Math.abs(vicino - t)) vicino = b;
  }
  if (vicino === null) return null;
  const nuovo = Math.round(attuale + (t - vicino));
  return Math.max(-SLIDE_OFFSET_MAX_SEC, Math.min(SLIDE_OFFSET_MAX_SEC, nuovo));
}

/** Dove si cerca l'avvio di un video con durata attorno al suo inizio stimato:
 *  le stesse finestre della pipeline (internal/postprod-claim). */
const AVVIO_PRIMA_MS = 30 * 60_000;
const AVVIO_DOPO_MS = 2 * 60_000;

/**
 * Lo zero e la durata del video composito di una registrazione, dagli avvii
 * e dalle fermate della registrazione riferiti dalla sala e dall'arrivo del
 * file. Il file arriva dopo la fine del video (il caricamento sposta l'arrivo
 * in avanti, mai indietro), quindi il video è cominciato al più tardi
 * all'arrivo meno la durata (la stima).
 *
 *  - Con la durata: fra i tratti chiusi prima dell'arrivo (un avvio e la
 *    fermata che lo segue, senza un altro avvio in mezzo) con l'avvio
 *    attorno alla stima, quello di durata più vicina; a pari, il più
 *    recente. Senza tratti chiusi (le fermate non sempre si registrano),
 *    l'avvio più vicino alla stima fra quelli non dopo di lei, poi fra quelli
 *    appena dopo. Esatto. Senza avvii, la stima.
 *  - Senza la durata: l'ultimo tratto chiuso prima dell'arrivo, fino alla sua
 *    fermata. Un tratto ancora aperto all'arrivo non è di questo file, salvo
 *    che non ce ne sia nessun altro: allora fino all'arrivo. Senza avvii,
 *    l'arrivo, stimato e senza fine.
 */
export function videoSegmentFromJournal(opts: {
  avvii: readonly Date[];
  fermate: readonly Date[];
  arrivo: Date;
  durationSec: number | null;
}): { t0: Date; exact: boolean; durationSec: number | null } {
  const arrivo = opts.arrivo.getTime();
  const avvii = opts.avvii.map((d) => d.getTime()).sort((a, b) => a - b);
  const fermate = opts.fermate.map((d) => d.getTime()).sort((a, b) => a - b);

  // I tratti chiusi prima dell'arrivo, dal più vecchio.
  const chiusi: Array<{ s: number; f: number }> = [];
  avvii.forEach((s, i) => {
    const seguente = avvii[i + 1];
    const f = fermate.find((x) => x > s);
    if (f !== undefined && f <= arrivo && (seguente === undefined || f <= seguente)) {
      chiusi.push({ s, f });
    }
  });

  const durata = opts.durationSec && opts.durationSec > 0 ? opts.durationSec : null;
  if (durata !== null) {
    const stima = arrivo - durata * 1000;
    const plausibile = (s: number) =>
      s >= stima - AVVIO_PRIMA_MS && s <= stima + AVVIO_DOPO_MS;
    let tratto: { s: number; f: number } | null = null;
    for (const c of chiusi) {
      if (!plausibile(c.s)) continue;
      const scarto = Math.abs(c.f - c.s - durata * 1000);
      if (tratto === null || scarto <= Math.abs(tratto.f - tratto.s - durata * 1000))
        tratto = c;
    }
    let s = tratto?.s ?? null;
    if (s === null) {
      const vicino = (lista: number[]) =>
        lista.reduce<number | null>(
          (m, a) => (m === null || Math.abs(a - stima) < Math.abs(m - stima) ? a : m),
          null
        );
      const candidati = avvii.filter(plausibile);
      s = vicino(candidati.filter((a) => a <= stima)) ?? vicino(candidati);
    }
    return { t0: new Date(s ?? stima), exact: s !== null, durationSec: durata };
  }

  const ultimoChiuso = chiusi[chiusi.length - 1];
  if (ultimoChiuso) {
    return {
      t0: new Date(ultimoChiuso.s),
      exact: true,
      durationSec: (ultimoChiuso.f - ultimoChiuso.s) / 1000,
    };
  }
  const prima = avvii.filter((a) => a <= arrivo);
  const ultimo = prima[prima.length - 1];
  if (ultimo === undefined) return { t0: opts.arrivo, exact: false, durationSec: null };
  const sec = (arrivo - ultimo) / 1000;
  return { t0: new Date(ultimo), exact: true, durationSec: sec > 0 ? sec : null };
}
