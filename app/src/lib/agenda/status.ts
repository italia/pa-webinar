/**
 * Gli stati di un argomento dell'agenda e cosa scrivere per passarci.
 *
 * PENDING (da discutere) → CURRENT (in corso) → DONE (discusso), oppure
 * SKIPPED (saltato). Uno solo alla volta e' in corso: avviarne uno chiude il
 * precedente come discusso (la rotta lo fa nella stessa transazione).
 *
 * `completed` resta allineato (vero solo per DONE): lo leggono la sintesi
 * della post-produzione e i client della versione precedente.
 */

import { z } from 'zod';

export const AGENDA_STATUSES = ['PENDING', 'CURRENT', 'DONE', 'SKIPPED'] as const;

/** Minuti previsti per un argomento: da 1 a 10 ore. */
export const plannedMinutesSchema = z.number().int().min(1).max(600);

/** Argomenti al massimo in un'agenda: il riordino manda l'elenco intero. */
export const MAX_AGENDA_ITEMS = 200;
export type AgendaStatus = (typeof AGENDA_STATUSES)[number];

export interface AgendaStatusData {
  status: AgendaStatus;
  completed: boolean;
  completedAt: Date | null;
  startedAt?: Date | null;
}

/** I campi da scrivere per portare un argomento a `status`. */
export function agendaStatusData(status: AgendaStatus, now: Date = new Date()): AgendaStatusData {
  switch (status) {
    case 'CURRENT':
      return { status, completed: false, completedAt: null, startedAt: now };
    case 'DONE':
      // L'ora d'inizio resta: dice quanto e' durato.
      return { status, completed: true, completedAt: now };
    case 'SKIPPED':
      return { status, completed: false, completedAt: null };
    case 'PENDING':
      return { status, completed: false, completedAt: null, startedAt: null };
  }
}

/** Il vecchio campo `completed` (client precedenti) tradotto in stato. */
export function statusFromCompleted(completed: boolean): AgendaStatus {
  return completed ? 'DONE' : 'PENDING';
}

/** Minuti trascorsi da `iso`, mai negativi: «in corso da N minuti». */
export function minutesSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
}

/** Minuti, arrotondati e mai meno di uno, tra l'inizio e la fine di un
 *  argomento: «discusso in 12 min». Senza uno dei due estremi, niente. */
export function minutesBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.max(1, Math.round(ms / 60_000));
}

/**
 * Il testo del campo «nuovo argomento» diviso in argomenti, uno per riga.
 * Chi incolla un'agenda da un documento la incolla con i suoi elenchi
 * puntati o numerati: «1. Apertura», «- Apertura», «• Apertura» diventano
 * «Apertura». Le righe vuote si saltano.
 */
export function splitAgendaLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((riga) => riga.replace(/^\s*(?:[-*•–—]|\d{1,3}[.)])\s+/u, '').trim())
    .filter((riga) => riga.length > 0);
}
