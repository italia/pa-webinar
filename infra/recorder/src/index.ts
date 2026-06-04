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
  };
}

/** Mappa una entry del manifest al file locale da caricare. */
function toLocalFile(track: ManifestTrack, outputDir: string): LocalTrackFile {
  return {
    track,
    localPath: join(outputDir, localTrackFilename(track.participantId)),
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
  const { uploaded, trackSizes } = await uploadRecording(provider, { manifest, files });
  console.log(`[recorder] upload completato (${uploaded} tracce, provider=${provider.name})`);

  // ── 6. Ingest al portale (POST /api/internal/multitrack-manifest) ──
  await notifyPortal(buildIngestBody(manifest, trackSizes), {
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
