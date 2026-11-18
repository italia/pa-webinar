// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Gli intervalli di una registrazione in cui una persona compare o parla, in
 * secondi dall'inizio del video. Logica pura: si prova senza database.
 *
 * Le proposte nascono da tre fonti, con precisioni diverse:
 *  - la presenza in sala (`RoomOccupant` con la voce nel video): ingresso e
 *    uscita come li ha visti Prosody, esatti al secondo;
 *  - chi parla: le frasi dei sottotitoli (ore del server, esatte) e il registro
 *    di chi parla (`CallSession.dominantSpeakerLog`, relativo all'ingresso di
 *    chi modera: approssimato di qualche secondo);
 *  - le tracce per persona: dal primo all'ultimo fotogramma di ogni sessione
 *    di traccia.
 * Sono proposte: lo staff le corregge guardando il video. Per coprire i
 * margini incerti i tempi si arrotondano verso l'esterno e chi parla ha un
 * po' di margine ai due lati.
 */
import { z } from 'zod';

export type FonteIntervallo = 'presence' | 'speech' | 'track';

export interface Intervallo {
  start: number;
  end: number;
}

export interface IntervalloProposto extends Intervallo {
  source: FonteIntervallo;
}

/** Senza la durata del video, un intervallo aperto arriva fin qui: l'editor lo taglia sul video vero. */
export const FINE_IGNOTA_S = 24 * 3600;
/** Margine ai due lati di un intervento: il registro di chi parla e' approssimato. */
export const MARGINE_PAROLA_S = 1;
/** Intervalli piu' vicini di cosi' diventano uno solo. */
export const UNIONE_S = 0.5;
/** Oltre questo numero un elenco di intervalli non e' una richiesta credibile. */
export const MASSIMO_INTERVALLI = 500;

const DECIMO = 10;
const giuDecimo = (s: number) => Math.floor(s * DECIMO) / DECIMO;
const suDecimo = (s: number) => Math.ceil(s * DECIMO) / DECIMO;

/** Taglia sull'inizio e sulla fine del video; null se non resta niente. */
function taglia(i: Intervallo, durata: number | null): Intervallo | null {
  const fine = durata ?? FINE_IGNOTA_S;
  const start = Math.max(0, giuDecimo(i.start));
  const end = Math.min(fine, suDecimo(i.end));
  return end > start ? { start, end } : null;
}

/**
 * Ordina e fonde gli intervalli che si toccano o quasi (`UNIONE_S`). Ognuno si
 * taglia sul video e si arrotonda al decimo di secondo verso l'esterno.
 */
export function unisciIntervalli(
  intervalli: readonly Intervallo[],
  durata: number | null = null
): Intervallo[] {
  const ordinati = intervalli
    .map((i) => taglia(i, durata))
    .filter((i): i is Intervallo => i !== null)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const uniti: Intervallo[] = [];
  for (const i of ordinati) {
    const ultimo = uniti[uniti.length - 1];
    if (ultimo && i.start <= ultimo.end + UNIONE_S) {
      ultimo.end = Math.max(ultimo.end, i.end);
    } else {
      uniti.push({ ...i });
    }
  }
  return uniti;
}

/** I secondi coperti da intervalli gia' uniti. */
export function secondiCoperti(intervalli: readonly Intervallo[]): number {
  return (
    Math.round(intervalli.reduce((s, i) => s + (i.end - i.start), 0) * DECIMO) / DECIMO
  );
}

/** Il corpo con cui lo staff conferma gli intervalli. */
export const intervalliSchema = z
  .array(
    z
      .object({
        start: z.number().finite().min(0),
        end: z.number().finite().min(0),
      })
      .refine((i) => i.end > i.start, { message: 'end must be after start' })
  )
  .min(1)
  .max(MASSIMO_INTERVALLI);

const secondi = (da: Date, t0: Date) => (da.getTime() - t0.getTime()) / 1000;

export interface PresenzaInSala {
  joinedAt: Date;
  leftAt: Date | null;
  /** Fuori dal video: chi non ha il consenso alla registrazione non c'e'. */
  voiceExcluded: boolean;
}

/** Quando la persona era nel video: le sue righe in sala con la voce nel video. */
export function intervalliDiPresenza(
  presenze: readonly PresenzaInSala[],
  t0: Date,
  durata: number | null
): IntervalloProposto[] {
  return unisciIntervalli(
    presenze
      .filter((p) => !p.voiceExcluded)
      .map((p) => ({
        start: secondi(p.joinedAt, t0),
        end: p.leftAt ? secondi(p.leftAt, t0) : (durata ?? FINE_IGNOTA_S),
      })),
    durata
  ).map((i) => ({ ...i, source: 'presence' as const }));
}

export interface VoceDelRegistro {
  /** Millisecondi dall'ingresso di chi l'ha riferito, che e' circa l'inizio della sessione. */
  atMs: number;
  participantId: string;
}

export interface RegistroDiSessione {
  /** L'inizio della sessione di chiamata che porta il registro. */
  startedAt: Date;
  log: readonly VoceDelRegistro[];
}

/**
 * Quando la persona parlava secondo il registro di chi parla: ogni sua voce
 * dura fino alla voce successiva (di chiunque), e l'ultima al massimo un
 * minuto, perche' dopo non si sa piu' niente.
 */
export function intervalliDiParola(
  registri: readonly RegistroDiSessione[],
  endpoint: ReadonlySet<string>,
  t0: Date,
  durata: number | null
): IntervalloProposto[] {
  const grezzi: Intervallo[] = [];
  for (const r of registri) {
    const voci = [...r.log]
      .filter((v) => Number.isFinite(v.atMs) && typeof v.participantId === 'string')
      .sort((a, b) => a.atMs - b.atMs);
    for (let i = 0; i < voci.length; i += 1) {
      const v = voci[i]!;
      if (!endpoint.has(v.participantId)) continue;
      const inizio = r.startedAt.getTime() + v.atMs;
      const prossima = voci[i + 1];
      const fine = prossima ? r.startedAt.getTime() + prossima.atMs : inizio + 60_000;
      grezzi.push({
        start: (inizio - t0.getTime()) / 1000 - MARGINE_PAROLA_S,
        end: (fine - t0.getTime()) / 1000 + MARGINE_PAROLA_S,
      });
    }
  }
  return unisciIntervalli(grezzi, durata).map((i) => ({
    ...i,
    source: 'speech' as const,
  }));
}

export interface FraseDetta {
  startedAt: Date;
  endedAt: Date;
}

/** Le frasi dei sottotitoli della persona: ore del server, con un po' di margine. */
export function intervalliDelleFrasi(
  frasi: readonly FraseDetta[],
  t0: Date,
  durata: number | null
): IntervalloProposto[] {
  return unisciIntervalli(
    frasi.map((f) => ({
      start: secondi(f.startedAt, t0) - MARGINE_PAROLA_S,
      end: secondi(f.endedAt, t0) + MARGINE_PAROLA_S,
    })),
    durata
  ).map((i) => ({ ...i, source: 'speech' as const }));
}

export interface SessioneDiTraccia {
  startOffsetMs: number;
  durationMs: number | null;
}

/** Le sessioni delle tracce per persona: dall'inizio alla fine di ciascuna. */
export function intervalliDelleTracce(
  tracce: readonly SessioneDiTraccia[],
  durata: number | null
): IntervalloProposto[] {
  return unisciIntervalli(
    tracce
      .filter((t) => t.durationMs !== null && t.durationMs > 0)
      .map((t) => ({
        start: t.startOffsetMs / 1000,
        end: (t.startOffsetMs + (t.durationMs ?? 0)) / 1000,
      })),
    durata
  ).map((i) => ({ ...i, source: 'track' as const }));
}

/**
 * Le proposte di tutte le fonti, ciascuna unita per conto suo e in ordine di
 * tempo: l'editor le mostra per fonte e parte dalla loro unione.
 */
export function proposte(
  ...fonti: ReadonlyArray<readonly IntervalloProposto[]>
): IntervalloProposto[] {
  return fonti.flat().sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Legge gli intervalli proposti salvati con la richiesta; scarta quello che non lo e'. */
export function leggiProposte(valore: unknown): IntervalloProposto[] {
  if (!Array.isArray(valore)) return [];
  const fonti = new Set<FonteIntervallo>(['presence', 'speech', 'track']);
  return valore.flatMap((v) => {
    const i = v as Partial<IntervalloProposto> | null;
    if (
      !i ||
      typeof i.start !== 'number' ||
      typeof i.end !== 'number' ||
      !Number.isFinite(i.start) ||
      !Number.isFinite(i.end) ||
      i.end <= i.start ||
      !fonti.has(i.source as FonteIntervallo)
    ) {
      return [];
    }
    return [{ start: i.start, end: i.end, source: i.source as FonteIntervallo }];
  });
}

/** Legge gli intervalli confermati; vuoto se non ci sono o non sono validi. */
export function leggiIntervalli(valore: unknown): Intervallo[] {
  const r = intervalliSchema.safeParse(valore);
  return r.success ? r.data : [];
}
