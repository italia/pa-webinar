/**
 * Entrypoint del multitrack recorder (ADR-013, Fase 3).
 *
 * Orchestrazione (tutta logica determinabile è delegata ai moduli puri):
 *   1. legge la config dall'env;
 *   2. entra nella stanza Jitsi come bot receive-only invisibile e registra
 *      UNA traccia audio per partecipante (`capture.ts` — WebRTC, richiede
 *      Jitsi reale);
 *   3. costruisce il manifest `tracks.json` (`manifest.ts` — puro);
 *   4. carica tracce + manifest allo storage (`upload.ts`);
 *   5. notifica il portale via webhook (`upload.ts`).
 *
 * Deploy: scale-with-events come Jibri — un pod per evento attivo, avviato
 * dal portale/scaler con le env qui sotto. Vedi README.
 */

import { join } from 'node:path';

import { captureRoom, type CaptureConfig } from './capture';
import { buildManifest, type ManifestTrack } from './manifest';
import { localTrackFilename } from './paths';
import {
  createStorageProvider,
  uploadRecording,
  buildWebhookPayload,
  notifyPortal,
  type LocalTrackFile,
} from './upload';

interface RecorderEnv {
  jitsiDomain: string;
  roomName: string;
  jwt: string;
  recordingId: string;
  eventId: string;
  outputDir: string;
  webhookUrl?: string;
  cronApiKey?: string;
  webhookSecret?: string;
  botDisplayName?: string;
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
    roomName: requireEnv('ROOM_NAME'),
    jwt: requireEnv('JWT'),
    recordingId: requireEnv('RECORDING_ID'),
    eventId: requireEnv('EVENT_ID'),
    outputDir: process.env.OUTPUT_DIR ?? '/recordings',
    webhookUrl: process.env.WEBHOOK_URL,
    cronApiKey: process.env.CRON_API_KEY,
    webhookSecret: process.env.RECORDING_WEBHOOK_SECRET,
    botDisplayName: process.env.BOT_DISPLAY_NAME ?? '📼 Recorder',
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

  const captureConfig: CaptureConfig = {
    jitsiDomain: env.jitsiDomain,
    roomName: env.roomName,
    jwt: env.jwt,
    outputDir: env.outputDir,
    botDisplayName: env.botDisplayName,
  };

  console.log(
    `[recorder] avvio cattura: room=${env.roomName} event=${env.eventId} ` +
      `recording=${env.recordingId}`,
  );

  // ── 1-2. Cattura WebRTC (blocca fino a fine evento) ──
  const { recordings } = await captureRoom(captureConfig);

  // ── 3. Manifest (puro) ──
  const manifest = buildManifest({
    eventId: env.eventId,
    recordingId: env.recordingId,
    roomName: env.roomName,
    recordings,
  });
  console.log(`[recorder] manifest: ${manifest.tracks.length} tracce`);

  // ── 4. Upload tracce + manifest ──
  const provider = createStorageProvider(process.env);
  const files = manifest.tracks.map((t) => toLocalFile(t, env.outputDir));
  const { uploaded } = await uploadRecording(provider, { manifest, files });
  console.log(`[recorder] upload completato (${uploaded} tracce, provider=${provider.name})`);

  // ── 5. Webhook al portale ──
  if (env.webhookUrl) {
    await notifyPortal(buildWebhookPayload(manifest), {
      webhookUrl: env.webhookUrl,
      cronApiKey: env.cronApiKey,
      webhookSecret: env.webhookSecret,
    });
    console.log('[recorder] portale notificato');
  } else {
    console.warn('[recorder] WEBHOOK_URL non impostato — salto la notifica');
  }
}

// Esegui solo se invocato direttamente (non quando importato dai test).
// In ESM controlliamo che questo modulo sia il main entry confrontando l'URL.
const isMain =
  typeof process.argv[1] === 'string' &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main().catch((err) => {
    console.error('[recorder] errore fatale:', err);
    process.exit(1);
  });
}
