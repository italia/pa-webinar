/**
 * Entrypoint del multitrack recorder (ADR-013, Fase 3).
 *
 * Orchestrazione (tutta logica determinabile è delegata ai moduli puri):
 *   1. legge la config dall'env (solo id + come raggiungere il portale);
 *   2. RECLAMA il work-order dal portale → JWT bot + nome stanza (`claim.ts`);
 *   3. entra nella stanza Jitsi come bot receive-only invisibile e registra
 *      UNA traccia audio per partecipante (`capture.ts` — WebRTC, Jitsi reale);
 *   4. costruisce il manifest `tracks.json` (`manifest.ts` — puro);
 *   5. carica tracce + manifest allo storage (presign per-traccia, `upload.ts`);
 *   6. ingesta al portale (`multitrack-manifest`).
 *
 * Avvio: dall'operator `recorder-controller` (K8s Job o container Docker), che
 * passa solo RECORDING_ID/EVENT_ID + l'accesso al portale. Vedi README.
 */

import { join } from 'node:path';

import { captureRoom, type CaptureConfig } from './capture.js';
import { buildManifest, type ManifestTrack } from './manifest.js';
import { localTrackFilename } from './paths.js';
import { claimWorkOrder } from './claim.js';
import {
  PresignStorageProvider,
  uploadRecording,
  buildIngestBody,
  notifyPortal,
  type LocalTrackFile,
} from './upload.js';

interface RecorderEnv {
  jitsiDomain: string;
  recordingId: string;
  eventId: string;
  portalUrl: string;
  cronApiKey: string;
  outputDir: string;
  idleTimeoutSec?: number;
  initialGraceSec?: number;
  maxDurationSec?: number;
}

function readIntEnv(name: string): number | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`variabile d'ambiente mancante: ${name}`);
  }
  return v;
}

function readEnv(): RecorderEnv {
  return {
    jitsiDomain: requireEnv('JITSI_DOMAIN'),
    recordingId: requireEnv('RECORDING_ID'),
    eventId: requireEnv('EVENT_ID'),
    portalUrl: requireEnv('PORTAL_URL').replace(/\/+$/, ''),
    cronApiKey: requireEnv('CRON_API_KEY'),
    outputDir: process.env.OUTPUT_DIR ?? '/recordings',
    // Quanto il bot resta in stanza vuota prima di chiudere (default 90s in
    // capture.ts). Configurabile per dare tempo ai partecipanti di entrare.
    idleTimeoutSec: readIntEnv('IDLE_TIMEOUT_SEC'),
    // Grace iniziale (stanza ancora vuota, mai visto nessuno) prima di
    // arrendersi: default 15min in capture.ts → spesso spreco perché il
    // controller spawna il recorder solo su evento già LIVE.
    initialGraceSec: readIntEnv('INITIAL_GRACE_SEC'),
    maxDurationSec: readIntEnv('MAX_DURATION_SEC'),
  };
}

/** Mappa una entry del manifest al file locale da caricare. */
function toLocalFile(track: ManifestTrack, outputDir: string): LocalTrackFile {
  return {
    track,
    // File locale per SESSIONE (trackFileId), coerente con capture/manifest.
    localPath: join(outputDir, localTrackFilename(track.trackFileId)),
  };
}

export async function main(): Promise<void> {
  const env = readEnv();

  // ── 1-2. Claim del work-order (JWT bot + stanza) ──
  const wo = await claimWorkOrder({
    portalUrl: env.portalUrl,
    cronApiKey: env.cronApiKey,
    recordingId: env.recordingId,
  });
  console.log(
    `[recorder] work-order: room=${wo.roomName} event=${wo.eventId} ` +
      `recording=${wo.recordingId}`,
  );

  const captureConfig: CaptureConfig = {
    jitsiDomain: env.jitsiDomain,
    roomName: wo.roomName,
    jwt: wo.jwt,
    outputDir: env.outputDir,
    // Wiring delle env di timing (erano parse-ate ma scartate qui → i default
    // hardcoded in capture.ts vincevano sempre, rendendo la config operatore
    // silenziosamente morta).
    idleTimeoutSec: env.idleTimeoutSec,
    initialGraceSec: env.initialGraceSec,
    maxDurationSec: env.maxDurationSec,
  };

  // ── 3. Cattura WebRTC (blocca fino a fine evento) ──
  const { recordings } = await captureRoom(captureConfig);

  // ── 4. Manifest (puro) ──
  const manifest = buildManifest({
    eventId: env.eventId,
    recordingId: env.recordingId,
    roomName: wo.roomName,
    recordings,
  });
  console.log(`[recorder] manifest: ${manifest.tracks.length} tracce`);

  // Nessuna traccia (stanza vuota o cattura non riuscita): niente da
  // caricare né da ingestare. Usciamo puliti — l'ingest rifiuterebbe un
  // array vuoto (422) e non avrebbe senso accodare la pipeline.
  if (manifest.tracks.length === 0) {
    console.warn('[recorder] nessuna traccia catturata — niente upload/ingest');
    return;
  }

  // ── 5. Upload tracce + manifest (presign per-traccia) ──
  const provider = new PresignStorageProvider({
    uploadUrlEndpoint: `${env.portalUrl}/api/internal/recorder-upload-url`,
    recordingId: env.recordingId,
    cronApiKey: env.cronApiKey,
  });
  const files = manifest.tracks.map((t) => toLocalFile(t, env.outputDir));
  // `uploadedManifest` contiene SOLO le tracce realmente salite (tolleranza
  // parziale): è quello da ingestare, così il portale non referenzia blob
  // mancanti.
  const {
    uploaded,
    trackSizes,
    manifest: uploadedManifest,
    failed,
  } = await uploadRecording(provider, { manifest, files });
  console.log(
    `[recorder] upload completato (${uploaded} tracce, ${failed.length} fallite, provider=${provider.name})`,
  );
  if (failed.length > 0) {
    console.warn(`[recorder] tracce NON caricate (saltate): ${failed.join(', ')}`);
  }

  // Tutte le tracce fallite: niente da ingestare (l'ingest rifiuterebbe un
  // array vuoto e non avrebbe senso accodare la pipeline).
  if (uploadedManifest.tracks.length === 0) {
    console.warn('[recorder] nessuna traccia caricata con successo — niente ingest');
    return;
  }

  // ── 6. Ingest al portale (POST /api/internal/multitrack-manifest) ──
  await notifyPortal(buildIngestBody(uploadedManifest, trackSizes), {
    ingestUrl: `${env.portalUrl}/api/internal/multitrack-manifest`,
    cronApiKey: env.cronApiKey,
  });
  console.log('[recorder] portale notificato (multitrack-manifest)');
}

// Esegui solo se invocato direttamente (non quando importato dai test).
// In ESM controlliamo che questo modulo sia il main entry confrontando l'URL.
const isMain =
  typeof process.argv[1] === 'string' &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main()
    .then(() => {
      // Uscita esplicita: Puppeteer/Chrome può lasciare handle aperti che
      // tengono vivo l'event loop anche dopo browser.close(), impedendo al
      // processo di terminare → il Job resterebbe Running fino ad
      // activeDeadlineSeconds. Forziamo l'exit a lavoro completato.
      process.exit(0);
    })
    .catch((err) => {
      console.error('[recorder] errore fatale:', err);
      process.exit(1);
    });
}
