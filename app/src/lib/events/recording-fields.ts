// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * I campi dell'evento che descrivono il video pubblicato, azzerati insieme: chi
 * toglie il video lascia una pagina senza date, peso o durata di un file che non
 * c'e' piu'.
 *
 * La durata della registrazione (`recordingDeleteAfterDays`) resta: e' una
 * scelta dell'evento, presa nel wizard o dal modello, non del singolo file. Vale
 * per cio' che della registrazione resta (trascrizioni, sintesi, traduzioni) e
 * per il video che verra' dopo (lib/gdpr/cleanup-selection).
 */
export const CAMPI_VIDEO_VUOTI = {
  recordingUrl: null,
  recordingPublished: false,
  recordingPublishedAt: null,
  recordingFileSize: null,
  recordingDuration: null,
} as const;

/**
 * Le sessioni che puntano a un file tolto dall'evento, senza piu' quel file: il
 * pannello delle sessioni non lo offre piu', le prove dei consensi non lo contano
 * come video (lib/gdpr/retained-consent-proofs), e se il file e' rimasto nello
 * storage la riconciliazione lo vede come orfano. Si passa a
 * `callSession.updateMany`, nella stessa transazione che toglie il video.
 */
export function sessioniSenzaFile(eventId: string, recordingUrl: string) {
  return {
    where: { eventId, recordingUrl },
    data: {
      recordingUrl: null,
      recordingFileSize: null,
      recordingDuration: null,
      recordingFilename: null,
    },
  };
}
