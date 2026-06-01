/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  MODULO WEBRTC — RICHIEDE UN JITSI REALE. NON È UNIT-TESTABILE.        ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Questo è l'unico modulo "sporco": parla WebRTC, dipende da un browser
 * headless con accesso a `lib-jitsi-meet`, e produce file audio su disco.
 * Tutta la logica determinabile (manifest, paths, offset, upload, firma)
 * vive FUORI da qui (`manifest.ts`, `paths.ts`, `upload.ts`) ed è testata.
 *
 * SCELTA TECNICA (vedi README per il razionale completo):
 *   Chrome headless (Puppeteer) + lib-jitsi-meet servito dal dominio Jitsi,
 *   con cattura per-traccia via `MediaRecorder` (uno per RTCRtpReceiver
 *   audio remoto). Motivi: lib-jitsi-meet è progettato per girare in un
 *   browser (usa API DOM/WebRTC del browser); `node-webrtc`/`werift` non
 *   implementano l'intero stack che lib-jitsi-meet si aspetta (simulcast,
 *   data channels, statistiche) e diventano fragili fra gli upgrade Jitsi.
 *   Chrome headless ci dà lo stesso stack WebRTC che gira in produzione,
 *   esattamente come fa Jibri.
 *
 * Il grosso del lavoro avviene DENTRO la pagina del browser (`page.evaluate`),
 * dove esistono `JitsiMeetJS`, `RTCPeerConnection` e `MediaRecorder`. Da
 * Node orchestriamo solo: avvio browser, iniezione config, raccolta degli
 * eventi (`onTrackChunk`, `onTrackEnded`) e scrittura su disco.
 *
 * Questo file è SCAFFOLDING ben commentato + i punti d'innesto. La
 * connessione end-to-end va validata su un cluster con Jitsi vero (vedi
 * README "cosa NON è testabile in locale").
 */

import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';

import { localTrackFilename } from './paths';
import type { TrackRecording } from './manifest';

export interface CaptureConfig {
  jitsiDomain: string;
  roomName: string;
  /** JWT del portale che ci fa entrare come bot receive-only. */
  jwt: string;
  /** Directory locale dove scrivere i file `.opus`. */
  outputDir: string;
  /** displayName del bot in stanza (es. "📼 Recorder"). */
  botDisplayName?: string;
}

/**
 * Risultato della cattura: lo stato per-traccia che alimenta
 * `buildManifest`. Tutto il timing è epoch ms.
 */
export interface CaptureResult {
  recordings: TrackRecording[];
}

/**
 * Avvia la cattura e si blocca finché l'evento non termina (stanza vuota
 * o segnale di stop). Ritorna lo stato delle tracce per il manifest.
 *
 * ─── Pseudo-flusso (da implementare con Puppeteer su Jitsi reale) ───
 *
 * 1. Lancia Chrome headless con i flag WebRTC tipici di Jibri:
 *      --use-fake-ui-for-media-stream  (nessun device locale: siamo
 *      receive-only, NON pubblichiamo né mic né camera)
 *      --autoplay-policy=no-user-gesture-required
 *      --disable-gpu --no-sandbox (in container)
 *
 * 2. Naviga su una pagina minimale servita dal dominio Jitsi (stessa
 *    origin di lib-jitsi-meet, per CSP/CORS) e inietta uno script che:
 *      a. `JitsiMeetJS.init({ disableAudioLevels: false })`
 *      b. crea la connection con il JWT (`new JitsiMeetJS.JitsiConnection(
 *         appId, jwt, { hosts, serviceUrl })`)
 *      c. su CONNECTION_ESTABLISHED, `initJitsiConference(roomName, {
 *         startSilent: true })` — NON crea track locali (receive-only).
 *      d. `conference.setDisplayName(botDisplayName)` e `conference.join(jwt)`.
 *
 * 3. Per ogni `TRACK_ADDED` remoto di tipo 'audio':
 *      - `const pid = track.getParticipantId()` → endpoint id Jitsi
 *      - `const name = conference.getParticipantById(pid)?.getDisplayName()`
 *        → displayName dal JWT del portale (PII, in chiaro nel manifest)
 *      - prendi `track.getOriginalStream()` (MediaStream con la sola
 *        traccia audio di QUEL partecipante) e crea
 *        `new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus',
 *        audioBitsPerSecond: 32000 })`
 *      - `recorder.ondataavailable = e => onTrackChunk(pid, name, chunk)`
 *        (con timestamp epoch alla prima frame → firstFrameAtMs)
 *      - `recorder.start(1000)` (chunk al secondo per offset accurato)
 *
 * 4. Su `TRACK_REMOVED` / `USER_LEFT`: `recorder.stop()` → `onTrackEnded`.
 *
 * 5. Su `CONFERENCE_LEFT` o stanza vuota per > N secondi: chiudi tutto,
 *    flush dei file, risolvi la promise con `recordings`.
 *
 * I `MediaRecorder` vivono nel contesto pagina; i chunk vengono passati a
 * Node via `page.exposeFunction('onTrackChunk', ...)` come base64/Uint8Array
 * e qui sotto li accodiamo sul file della traccia (`TrackWriter`).
 */
export async function captureRoom(config: CaptureConfig): Promise<CaptureResult> {
  await mkdir(config.outputDir, { recursive: true });

  // I writer per-traccia. La chiave è una traccia-instance id (non solo il
  // participantId) così un rejoin dello stesso pid → file separato.
  const writers = new Map<string, TrackWriter>();

  // ───────────────────────────────────────────────────────────────────
  // TODO(ADR-013 Fase 3): qui va il bootstrap Puppeteer descritto sopra.
  // L'implementazione reale chiama `getOrCreateWriter` / `appendChunk` /
  // `closeWriter` dagli handler di lib-jitsi-meet eseguiti nella pagina.
  // Finché non c'è un Jitsi reale a cui collegarsi, lanciamo per non
  // illudere il chiamante che la cattura sia avvenuta.
  // ───────────────────────────────────────────────────────────────────
  void writers; // i writer verranno popolati dagli handler lib-jitsi-meet
  throw new Error(
    'captureRoom: implementazione WebRTC non ancora collegata. ' +
      'Richiede Puppeteer + un Jitsi reale (vedi README e i TODO in capture.ts).',
  );
}

/**
 * Scrittore di una singola traccia su disco + accumulo dei metadati di
 * timing per il manifest. Questa parte è "quasi pura" (solo I/O file) ma la
 * teniamo nel modulo WebRTC perché la usa solo la cattura; gli unit test
 * coprono `manifest.ts` che consuma il `TrackRecording` prodotto qui.
 */
class TrackWriter {
  readonly participantId: string;
  displayName: string | null;
  firstFrameAtMs = 0;
  lastFrameAtMs = 0;
  bytesWritten = 0;

  private fileHandle: Awaited<ReturnType<typeof open>> | null = null;
  private readonly path: string;

  constructor(participantId: string, displayName: string | null, outputDir: string) {
    this.participantId = participantId;
    this.displayName = displayName;
    this.path = join(outputDir, localTrackFilename(participantId));
  }

  async appendChunk(chunk: Buffer, nowMs: number): Promise<void> {
    if (this.fileHandle === null) {
      this.fileHandle = await open(this.path, 'w');
      this.firstFrameAtMs = nowMs;
    }
    await this.fileHandle.write(chunk);
    this.bytesWritten += chunk.length;
    this.lastFrameAtMs = nowMs;
  }

  async close(): Promise<void> {
    if (this.fileHandle) {
      await this.fileHandle.close();
      this.fileHandle = null;
    }
  }

  toRecording(): TrackRecording {
    return {
      participantId: this.participantId,
      displayName: this.displayName,
      firstFrameAtMs: this.firstFrameAtMs,
      lastFrameAtMs: this.lastFrameAtMs,
      bytesWritten: this.bytesWritten,
    };
  }
}
