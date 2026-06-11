/**
 * Storage layout & naming for the multitrack recorder (ADR-013, Fase 3).
 *
 * LOGICA PURA — nessun side-effect, nessun WebRTC, nessun I/O. Tutto qui
 * dentro è unit-testabile senza un Jitsi reale.
 *
 * Layout concordato nell'ADR ("Architettura & modello dati"):
 *
 *   recordings/multitrack/{eventId}/{recordingId}/
 *     audio/{participantId}.opus      ← una traccia audio per partecipante
 *     tracks.json                     ← manifest track → partecipante
 *
 * Il portale (ingest) e il worker (`infra/ai/worker/multitrack.py`)
 * dipendono da questo layout: NON cambiarlo senza aggiornare entrambi.
 */

/** Codec/container delle tracce audio. Opus-in-WebM è il formato nativo
 * che `MediaRecorder` / l'encoder Jitsi producono; lo trattiamo come
 * `.opus` lato storage perché il worker (ffmpeg/WhisperX) lo apre via
 * estensione. Centralizzato qui per non spargere la stringa nel codice. */
export const TRACK_FILE_EXT = 'opus' as const;

/** Nome del file manifest. */
export const MANIFEST_FILENAME = 'tracks.json' as const;

/** Prefisso radice di tutte le registrazioni multitraccia nello storage. */
export const MULTITRACK_ROOT = 'recordings/multitrack' as const;

/**
 * Sanifica un segmento di path (eventId / recordingId / participantId) per
 * impedire path traversal o chiavi storage malformate. Questi valori
 * arrivano dall'esterno (env, JWT, endpoint id Jitsi) quindi NON sono
 * fidati: un `participantId` tipo `../../foo` deve diventare innocuo.
 *
 * Manteniamo solo caratteri sicuri per object key: alfanumerici, `-`, `_`.
 * Tutto il resto collassa in `_`. Una stringa vuota dopo la sanificazione
 * è un errore di programmazione (id mancante) → throw.
 */
export function sanitizeSegment(segment: string): string {
  const cleaned = segment.replace(/[^A-Za-z0-9_-]/g, '_');
  if (cleaned.length === 0) {
    throw new Error('sanitizeSegment: empty segment after sanitization');
  }
  return cleaned;
}

/** Prefisso (cartella) della registrazione: `recordings/multitrack/{eventId}/{recordingId}`. */
export function recordingPrefix(eventId: string, recordingId: string): string {
  return `${MULTITRACK_ROOT}/${sanitizeSegment(eventId)}/${sanitizeSegment(recordingId)}`;
}

/**
 * Object key della singola traccia audio.
 *
 * `trackFileId` identifica la SESSIONE di traccia, NON il solo partecipante:
 * un rejoin o un mute→unmute dello stesso partecipante produce una nuova
 * sessione (es. `${pid}-0`, `${pid}-1`) e quindi un file/blob DISTINTO.
 * Usare il solo participantId qui causava la sovrascrittura della traccia
 * al secondo intervento (audio perso) — vedi ADR-013 / audit recorder.
 */
export function trackKey(
  eventId: string,
  recordingId: string,
  trackFileId: string,
): string {
  return `${recordingPrefix(eventId, recordingId)}/audio/${sanitizeSegment(trackFileId)}.${TRACK_FILE_EXT}`;
}

/** Object key del manifest `tracks.json` della registrazione. */
export function manifestKey(eventId: string, recordingId: string): string {
  return `${recordingPrefix(eventId, recordingId)}/${MANIFEST_FILENAME}`;
}

/**
 * Nome file locale (su disco, in OUTPUT_DIR) di una SESSIONE di traccia,
 * prima dell'upload. `trackFileId` è univoco per sessione (vedi `trackKey`):
 * due sessioni dello stesso partecipante (rejoin / mute→unmute) scrivono su
 * file DISTINTI, così la seconda non tronca la prima. Volutamente PIATTO
 * (niente sottocartelle); la mappa locale→remoto la fa `trackKey`.
 */
export function localTrackFilename(trackFileId: string): string {
  return `${sanitizeSegment(trackFileId)}.${TRACK_FILE_EXT}`;
}
