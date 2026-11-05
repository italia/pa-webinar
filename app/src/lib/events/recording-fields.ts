// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * I campi dell'evento che descrivono il video pubblicato, azzerati insieme: chi
 * toglie il video lascia una pagina senza date, peso o durata di un file che non
 * c'e' piu', e il prossimo video non eredita la scadenza di questo.
 */
export const CAMPI_VIDEO_VUOTI = {
  recordingUrl: null,
  recordingPublished: false,
  recordingPublishedAt: null,
  recordingFileSize: null,
  recordingDuration: null,
  recordingDeleteAfterDays: null,
} as const;
