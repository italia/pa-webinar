// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Le statistiche del catalogo dell'istanza: quanti eventi di ciascun tipo e da
 * ciascun modello, mese per mese, con i partecipanti medi e la durata media
 * (GET /api/admin/analytics, pagina Statistiche dell'amministrazione).
 *
 * Solo conteggi e medie: nessun titolo, nessun nome di persona. Il tipo e il
 * modello vengono dal catalogo salvato sull'evento (lib/events/catalog).
 *
 * Le misure, scelte perche' valgono per ogni tipo di evento (chiamate rapide
 * comprese, che non hanno iscrizioni ne' una registrazione), e diverse da
 * quelle della scheda Statistiche del singolo evento (lib/analytics/event-stats),
 * che legge la sessione piu' recente e la durata della registrazione:
 * - un evento conta nel mese in cui comincia, nel fuso dell'istanza; le bozze
 *   non contano;
 * - un evento «si e' tenuto» se la sua sala si e' aperta (almeno una
 *   CallSession);
 * - i partecipanti sono il picco di presenti contemporanei dell'evento
 *   (Event.peakParticipants, ospiti compresi), mediato sugli eventi tenuti;
 * - la durata e' il tempo di sala misurato, la somma delle sessioni chiuse, e
 *   non la finestra programmata (per le chiamate rapide e' di ore, a vuoto);
 *   e' mediata sugli eventi tenuti con almeno una sessione chiusa.
 *
 * Qui la regola, pura (la importa anche la pagina); la lettura dalla banca
 * dati e' in catalog-stats-query.ts.
 */

import type { EventFormatClass } from '@prisma/client';

import { TIPI_CATALOGO, tipoDiCatalogo, type TipoCatalogo } from '@/lib/events/catalog';

/** I periodi che si possono scegliere, in mesi (compreso quello in corso). */
export const MESI_CATALOGO = [3, 6, 12, 24] as const;
export type MesiCatalogo = (typeof MESI_CATALOGO)[number];
export const MESI_CATALOGO_PREDEFINITI: MesiCatalogo = 12;

/** Un periodo letto dall'indirizzo: fuori elenco, quello predefinito. */
export function mesiDelCatalogo(valore: string | null): MesiCatalogo {
  const n = Number(valore);
  return (MESI_CATALOGO as readonly number[]).includes(n)
    ? (n as MesiCatalogo)
    : MESI_CATALOGO_PREDEFINITI;
}

/** I numeri di un gruppo di eventi (un tipo, un modello) in un periodo. */
export interface CellaCatalogo {
  events: number;
  /** Eventi la cui sala si e' aperta. */
  held: number;
  /** Picco medio di presenti contemporanei, sugli eventi tenuti. */
  avgParticipants: number | null;
  /** Durata media misurata, in minuti, sugli eventi tenuti con una durata. */
  avgDurationMinutes: number | null;
}

/** Un gruppo con i suoi numeri nel periodo e mese per mese (allineati a `months`). */
export interface GruppoCatalogo extends CellaCatalogo {
  key: string;
  byMonth: CellaCatalogo[];
}

export interface GruppoTipo extends GruppoCatalogo {
  type: TipoCatalogo;
}

/**
 * Un gruppo per modello. `special`: le chiamate rapide e gli archivi importati
 * (che non nascono da un modello), gli eventi senza modello. Un modello
 * cancellato si ritrova col nome che aveva (`deleted`).
 */
export interface GruppoModello extends GruppoCatalogo {
  special: 'INSTANT' | 'LEGACY' | 'NONE' | null;
  templateId: string | null;
  name: string | null;
  deleted: boolean;
}

export interface StatisticheCatalogo {
  /** I mesi del periodo, `AAAA-MM`, dal piu' vecchio. */
  months: string[];
  timezone: string;
  /** Tutti i tipi, anche senza eventi, dal piu' ricorrente. */
  byType: GruppoTipo[];
  /** I modelli con almeno un evento nel periodo, dal piu' ricorrente. */
  byTemplate: GruppoModello[];
}

/** Un evento come lo leggono le statistiche. */
export interface RigaCatalogo {
  eventType: string;
  formatClass: EventFormatClass | null;
  templateId: string | null;
  /** Il nome del modello quando l'evento l'ha preso. */
  templateName: string | null;
  /** Il nome del modello oggi, se esiste ancora. */
  templateCurrentName: string | null;
  startsAt: Date;
  peakParticipants: number;
  /** Sessioni di sala, aperte o chiuse. */
  sessions: number;
  /** Somma delle sessioni chiuse, in secondi; null senza sessioni chiuse. */
  durationSec: number | null;
}

/** Un formattatore per fuso: costruirne uno per ogni evento costa. */
const FORMATI_DEL_MESE = new Map<string, Intl.DateTimeFormat>();

function formatoDelMese(timezone: string): Intl.DateTimeFormat {
  let formato = FORMATI_DEL_MESE.get(timezone);
  if (!formato) {
    formato = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
    });
    FORMATI_DEL_MESE.set(timezone, formato);
  }
  return formato;
}

/** Il mese di una data nel fuso dato, `AAAA-MM`. */
export function meseNelFuso(data: Date, timezone: string): string {
  const parti = formatoDelMese(timezone).formatToParts(data);
  const anno = parti.find((p) => p.type === 'year')?.value ?? '0000';
  const mese = parti.find((p) => p.type === 'month')?.value ?? '01';
  return `${anno}-${mese}`;
}

/** Gli ultimi `n` mesi fino a quello di `ora` compreso, nel fuso dato. */
export function mesiFinoA(ora: Date, n: number, timezone: string): string[] {
  const [anno, mese] = meseNelFuso(ora, timezone).split('-').map(Number) as [
    number,
    number,
  ];
  const mesi: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(anno, mese - 1 - i, 1));
    mesi.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return mesi;
}

/** La finestra di date da leggere per i mesi dati: un giorno di margine per
 *  parte, il fuso lo decide poi `meseNelFuso`. */
export function finestraDeiMesi(mesi: readonly string[]): { since: Date; until: Date } {
  const [primoAnno, primoMese] = (mesi[0] ?? '1970-01').split('-').map(Number) as [
    number,
    number,
  ];
  const [ultimoAnno, ultimoMese] = (mesi[mesi.length - 1] ?? '1970-01')
    .split('-')
    .map(Number) as [number, number];
  const giorno = 86_400_000;
  return {
    since: new Date(Date.UTC(primoAnno, primoMese - 1, 1) - giorno),
    until: new Date(Date.UTC(ultimoAnno, ultimoMese, 1) + giorno),
  };
}

interface Accumulo {
  events: number;
  held: number;
  sommaPartecipanti: number;
  conDurata: number;
  sommaDurataSec: number;
}

const vuoto = (): Accumulo => ({
  events: 0,
  held: 0,
  sommaPartecipanti: 0,
  conDurata: 0,
  sommaDurataSec: 0,
});

function aggiungi(a: Accumulo, r: RigaCatalogo): void {
  a.events += 1;
  if (r.sessions > 0) {
    a.held += 1;
    a.sommaPartecipanti += Math.max(0, r.peakParticipants);
    if (r.durationSec != null && r.durationSec > 0) {
      a.conDurata += 1;
      a.sommaDurataSec += r.durationSec;
    }
  }
}

function cella(a: Accumulo): CellaCatalogo {
  return {
    events: a.events,
    held: a.held,
    avgParticipants:
      a.held > 0 ? Math.round((a.sommaPartecipanti / a.held) * 10) / 10 : null,
    avgDurationMinutes:
      a.conDurata > 0 ? Math.round(a.sommaDurataSec / a.conDurata / 60) : null,
  };
}

/** Il gruppo per modello di un evento. */
function gruppoModello(
  r: RigaCatalogo
): Omit<GruppoModello, keyof GruppoCatalogo> & { key: string } {
  if (r.eventType === 'INSTANT') {
    return {
      key: 'instant',
      special: 'INSTANT',
      templateId: null,
      name: null,
      deleted: false,
    };
  }
  if (r.eventType === 'LEGACY') {
    return {
      key: 'legacy',
      special: 'LEGACY',
      templateId: null,
      name: null,
      deleted: false,
    };
  }
  if (r.templateId) {
    return {
      key: `t:${r.templateId}`,
      special: null,
      templateId: r.templateId,
      // Il nome di oggi; quello di allora se il modello non risponde piu'.
      name: r.templateCurrentName ?? r.templateName,
      deleted: false,
    };
  }
  if (r.templateName) {
    return {
      key: `n:${r.templateName}`,
      special: null,
      templateId: null,
      name: r.templateName,
      deleted: true,
    };
  }
  return { key: 'none', special: 'NONE', templateId: null, name: null, deleted: false };
}

/** Dal piu' ricorrente; a pari eventi, quello tenuto piu' spesso. */
function perRicorrenza(a: CellaCatalogo, b: CellaCatalogo): number {
  return b.events - a.events || b.held - a.held;
}

/** Le statistiche del catalogo sulle righe date. Pura. */
export function aggregaCatalogo(
  righe: readonly RigaCatalogo[],
  months: readonly string[],
  timezone: string
): Omit<StatisticheCatalogo, 'timezone'> {
  const indice = new Map(months.map((m, i) => [m, i]));
  const tipi = new Map<TipoCatalogo, { totale: Accumulo; mesi: Accumulo[] }>(
    TIPI_CATALOGO.map((t) => [t, { totale: vuoto(), mesi: months.map(vuoto) }])
  );
  const modelli = new Map<
    string,
    { info: ReturnType<typeof gruppoModello>; totale: Accumulo; mesi: Accumulo[] }
  >();

  for (const r of righe) {
    const i = indice.get(meseNelFuso(r.startsAt, timezone));
    if (i === undefined) continue;

    const info = gruppoModello(r);
    if (!modelli.has(info.key)) {
      modelli.set(info.key, { info, totale: vuoto(), mesi: months.map(vuoto) });
    }
    for (const gruppo of [tipi.get(tipoDiCatalogo(r)), modelli.get(info.key)]) {
      const mese = gruppo?.mesi[i];
      if (!gruppo || !mese) continue;
      aggiungi(gruppo.totale, r);
      aggiungi(mese, r);
    }
  }

  const byType: GruppoTipo[] = [...tipi.entries()]
    .map(([type, g]) => ({
      key: type,
      type,
      ...cella(g.totale),
      byMonth: g.mesi.map(cella),
    }))
    .sort(perRicorrenza);
  const byTemplate: GruppoModello[] = [...modelli.values()]
    .map((g) => ({ ...g.info, ...cella(g.totale), byMonth: g.mesi.map(cella) }))
    .sort(perRicorrenza);

  return { months: [...months], byType, byTemplate };
}
