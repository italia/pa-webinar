// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * La durata della registrazione negli eventi nati prima che si separasse dai
 * dati dei partecipanti (`Event.legacyRecordingRetention`). A chi si e' iscritto
 * a quegli eventi si e' detto che un video non pubblicato si cancella con i suoi
 * dati: finche' il video non e' pubblicato, la registrazione scade al piu' tardi
 * alla conservazione dei dati (`dataRetentionDays` dalla stessa fine da cui conta
 * quella, lib/gdpr/cleanup-selection), qualunque durata ci sia sull'evento. Chi
 * organizza puo' accorciarla, non toglierla ne' allungarla. Un video pubblicato
 * segue la sua durata dalla pubblicazione, come prima; se si toglie la
 * pubblicazione, torna la promessa.
 *
 * Il modulo e' puro: lo usano la pulizia, la rotta dell'evento, il pannello della
 * registrazione e la scheda privacy.
 */
export interface EventoDurataPrecedente {
  legacyRecordingRetention?: boolean | null;
  recordingPublished: boolean;
  dataRetentionDays: number;
}

/**
 * Il massimo di giorni della registrazione non pubblicata, o null dove non c'e'
 * una promessa da tenere (eventi nuovi, o video pubblicato).
 */
export function limiteDurataPrecedente(evento: EventoDurataPrecedente): number | null {
  return evento.legacyRecordingRetention && !evento.recordingPublished
    ? evento.dataRetentionDays
    : null;
}

/**
 * La durata che vale davvero, in giorni (null: nessuna scadenza): quella scelta,
 * o la promessa se e' piu' corta o se non ce n'e' una.
 */
export function durataEffettiva(
  evento: EventoDurataPrecedente & { recordingDeleteAfterDays: number | null }
): number | null {
  const scelta = evento.recordingDeleteAfterDays || null;
  const limite = limiteDurataPrecedente(evento);
  if (limite === null) return scelta;
  return scelta === null ? limite : Math.min(scelta, limite);
}

/** Una durata nuova si puo' salvare: dentro la promessa, dove ce n'e' una. */
export function durataAmmessa(
  evento: EventoDurataPrecedente,
  giorni: number | null
): boolean {
  const limite = limiteDurataPrecedente(evento);
  return limite === null || (giorni !== null && giorni <= limite);
}
