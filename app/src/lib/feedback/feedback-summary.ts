/**
 * La valutazione complessiva di un evento, calcolata in un modo solo per la
 * pagina pubblica, il riepilogo e le statistiche: una media per risposta
 * (le domande a scala del questionario di fine evento, riportate su 1-5),
 * insieme alle valutazioni a stelle raccolte prima dei questionari. Chi ha
 * risposto a tre domande conta una volta, come chi ha dato una stella.
 * Si calcola al momento: le risposte arrivano anche dopo la fine.
 */

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';

export interface FeedbackSummary {
  /** Media su 1-5, null senza valutazioni. */
  average: number | null;
  count: number;
  /** Quante valutazioni per stella, da 5 a 1 (la media di una risposta si
   *  arrotonda alla stella piu' vicina). */
  distribution: { rating: number; count: number }[];
}

/** La valutazione di un evento. */
export async function getFeedbackSummary(eventId: string): Promise<FeedbackSummary> {
  return getFeedbackSummaryFor({ id: eventId });
}

/**
 * La valutazione di piu' eventi insieme (le statistiche dell'istanza): la
 * stessa regola, su tutti gli eventi che rispondono al filtro.
 */
export async function getFeedbackSummaryFor(eventi: Prisma.EventWhereInput): Promise<FeedbackSummary> {
  const [stelle, scale] = await Promise.all([
    prisma.eventFeedback.findMany({ where: { event: eventi }, select: { rating: true } }),
    prisma.questionnaireAnswer.findMany({
      where: {
        valueScale: { not: null },
        item: { type: 'LIKERT' },
        response: { questionnaire: { placement: 'POST_EVENT', event: eventi } },
      },
      select: { responseId: true, valueScale: true, item: { select: { scaleMin: true, scaleMax: true } } },
    }),
  ]);
  const perRisposta = new Map<string, number[]>();
  for (const a of scale) {
    const min = a.item.scaleMin ?? 1;
    const max = a.item.scaleMax ?? 5;
    if (a.valueScale == null || max <= min) continue;
    const suCinque = 1 + ((a.valueScale - min) / (max - min)) * 4;
    perRisposta.set(a.responseId, [...(perRisposta.get(a.responseId) ?? []), suCinque]);
  }
  const valori = [
    ...stelle.map((s) => s.rating),
    ...[...perRisposta.values()].map((v) => v.reduce((x, y) => x + y, 0) / v.length),
  ];
  const conteggi: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const v of valori) {
    const stella = Math.min(5, Math.max(1, Math.round(v)));
    conteggi[stella] = (conteggi[stella] ?? 0) + 1;
  }
  return {
    average: valori.length > 0 ? valori.reduce((x, y) => x + y, 0) / valori.length : null,
    count: valori.length,
    distribution: [5, 4, 3, 2, 1].map((rating) => ({ rating, count: conteggi[rating] ?? 0 })),
  };
}
