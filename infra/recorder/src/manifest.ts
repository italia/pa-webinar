/**
 * Manifest builder for the multitrack recorder (ADR-013, Fase 3).
 *
 * LOGICA PURA — nessun side-effect, nessun WebRTC. Costruisce il
 * `tracks.json` che il portale legge in ingest per creare le righe
 * `RecordingTrack` e che il worker (`infra/ai/worker/multitrack.py`) usa
 * per allineare i segmenti sulla timeline comune via `startOffsetMs`.
 *
 * NB GDPR (ADR-013 "Implicazioni GDPR"): `displayName` qui è IN CHIARO.
 * È PII (nome reale dal JWT del portale). La cifratura at-rest è
 * responsabilità del PORTALE all'ingest (come già fa per i partecipanti
 * della CallSession, vedi `encryptJSON` in
 * `app/src/app/api/webhooks/recording/route.ts`). Il recorder non ha le
 * chiavi PII e non deve averle: minimizzazione.
 */

import { trackKey } from './paths.js';

/**
 * Stato di registrazione di una singola traccia, accumulato in memoria
 * dal modulo WebRTC mentre l'evento è live. Tutti i tempi sono in
 * millisecondi epoch (Date.now()) per essere assoluti e comparabili fra
 * tracce che iniziano/finiscono in momenti diversi.
 */
export interface TrackRecording {
  /** Endpoint id Jitsi (stabile per la sessione del partecipante). */
  participantId: string;
  /** Nome reale dal JWT del portale (PII, in chiaro qui). Può mancare. */
  displayName: string | null;
  /** Epoch ms in cui è arrivata la prima frame audio della traccia. */
  firstFrameAtMs: number;
  /** Epoch ms dell'ultima frame audio ricevuta. */
  lastFrameAtMs: number;
  /**
   * Byte scritti su disco per questa traccia. Usato solo per scartare
   * tracce vuote (partecipante entrato ma mai parlato / mai pubblicato
   * audio): non vogliamo manifest con tracce a durata 0.
   */
  bytesWritten: number;
}

/** Una entry del manifest `tracks.json` (shape concordato nell'ADR). */
export interface ManifestTrack {
  participantId: string;
  /** PII in chiaro — il portale la cifra all'ingest. */
  displayName: string | null;
  /** Object key relativa allo storage (vedi `paths.trackKey`). */
  trackKey: string;
  /** Offset di inizio traccia rispetto a t0 della registrazione, in ms. */
  startOffsetMs: number;
  /** Durata della traccia in ms. */
  durationMs: number;
}

/** Documento `tracks.json` completo. */
export interface Manifest {
  /** Versione dello schema: bump quando cambia la shape (ingest la legge). */
  version: 1;
  eventId: string;
  recordingId: string;
  roomName: string;
  /**
   * t0 della registrazione (epoch ms): il minimo dei `firstFrameAtMs`
   * fra tutte le tracce. Gli `startOffsetMs` sono relativi a questo.
   */
  recordingStartedAtMs: number;
  tracks: ManifestTrack[];
}

export interface BuildManifestInput {
  eventId: string;
  recordingId: string;
  roomName: string;
  recordings: TrackRecording[];
  /**
   * Soglia minima di byte sotto la quale una traccia è considerata vuota
   * e scartata. Default 0 = scarta solo le tracce a 0 byte. Iniettabile
   * per i test.
   */
  minBytes?: number;
}

/**
 * Costruisce il manifest a partire dalle tracce registrate.
 *
 * Regole:
 *  - le tracce sotto `minBytes` (default: <= 0 byte) sono scartate
 *    (partecipanti che non hanno mai pubblicato audio);
 *  - `recordingStartedAtMs` = min dei `firstFrameAtMs` delle tracce
 *    valide. Se non ci sono tracce valide è `0` e il manifest ha
 *    `tracks: []` (l'ingest lo tratterà come registrazione vuota);
 *  - `startOffsetMs` = `firstFrameAtMs - recordingStartedAtMs` (>= 0);
 *  - `durationMs` = `lastFrameAtMs - firstFrameAtMs` (>= 0);
 *  - se lo stesso `participantId` compare più volte (es. rejoin),
 *    le entry restano separate: sono file audio distinti e il worker
 *    le fonde comunque per timestamp.
 *
 * Output ordinato per `startOffsetMs` crescente (deterministico per i
 * test e comodo per l'ingest).
 */
export function buildManifest(input: BuildManifestInput): Manifest {
  const { eventId, recordingId, roomName } = input;
  const minBytes = input.minBytes ?? 0;

  const valid = input.recordings.filter((r) => r.bytesWritten > minBytes);

  const recordingStartedAtMs =
    valid.length > 0
      ? Math.min(...valid.map((r) => r.firstFrameAtMs))
      : 0;

  const tracks: ManifestTrack[] = valid
    .map((r) => ({
      participantId: r.participantId,
      displayName: r.displayName,
      trackKey: trackKey(eventId, recordingId, r.participantId),
      startOffsetMs: Math.max(0, r.firstFrameAtMs - recordingStartedAtMs),
      durationMs: Math.max(0, r.lastFrameAtMs - r.firstFrameAtMs),
    }))
    .sort((a, b) => a.startOffsetMs - b.startOffsetMs);

  return {
    version: 1,
    eventId,
    recordingId,
    roomName,
    recordingStartedAtMs,
    tracks,
  };
}

/** Serializza il manifest in JSON pretty-printed (UTF-8) pronto per upload. */
export function serializeManifest(manifest: Manifest): string {
  return JSON.stringify(manifest, null, 2);
}
