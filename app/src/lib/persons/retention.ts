// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/** I mesi di conservazione di una voce nuova: il default di `Person.retentionMonths`. */
export const MESI_RUBRICA_PREDEFINITI = 24;

/**
 * Il momento in cui scade una voce della rubrica: `retentionMonths` mesi dal
 * consenso (`optedInAt`).
 *
 * `null` se la voce non ha una data di consenso: non c'e' niente da cui contare,
 * e chi decide una cancellazione la tratta come non scaduta. Trasformarla in
 * una data darebbe il 1970, e la voce sparirebbe alla prima corsa.
 *
 * I conti sono in UTC: l'esito non dipende dal fuso del processo ne' dall'ora
 * legale. Se il mese di arrivo e' piu' corto vale il suo ultimo giorno: il 31
 * gennaio piu' un mese e' il 28 febbraio, non il 3 marzo, cosi' la scadenza non
 * supera mai i mesi dichiarati.
 */
export function scadenzaRubrica({
  optedInAt,
  retentionMonths,
}: {
  optedInAt: Date | null;
  retentionMonths: number;
}): Date | null {
  if (!optedInAt) return null;
  const scadenza = new Date(optedInAt);
  scadenza.setUTCMonth(scadenza.getUTCMonth() + retentionMonths);
  // Il giorno cambia solo se il mese di arrivo non lo ha: Date e' scivolata
  // nel mese dopo, e il giorno 0 di quel mese e' l'ultimo del mese voluto.
  if (scadenza.getUTCDate() !== optedInAt.getUTCDate()) scadenza.setUTCDate(0);
  return scadenza;
}
