/**
 * I campi dell'evento che descrivono il video pubblicato, azzerati insieme: chi
 * toglie il video lascia una pagina senza date, peso o durata di un file che non
 * c'e' piu'.
 */
export const CAMPI_VIDEO_VUOTI = {
  recordingUrl: null,
  recordingPublished: false,
  recordingPublishedAt: null,
  recordingFileSize: null,
  recordingDuration: null,
} as const;
