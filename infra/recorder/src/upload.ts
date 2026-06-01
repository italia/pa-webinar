/**
 * Upload tracce + manifest allo storage e notifica webhook al portale
 * (ADR-013, Fase 3).
 *
 * Il provider di storage è astratto dietro `StorageProvider`. Qui sotto
 * forniamo:
 *  - `NoopStorageProvider`: non scrive nulla, traccia le chiamate (utile
 *    per test e per il dry-run locale, dove NON c'è uno storage reale);
 *  - `createStorageProvider(env)`: factory che oggi ritorna il noop e
 *    contiene i TODO per i provider reali (Azure Blob / S3 / GCS / MinIO),
 *    da implementare riusando lo stesso pattern di `jibri-finalize.sh`.
 *
 * La firma HMAC del webhook e la shape del payload replicano
 * `infra/jitsi/jibri-finalize.sh` + `app/src/app/api/webhooks/recording/route.ts`
 * così il portale può autenticare allo stesso modo.
 */

import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { manifestKey, trackKey } from './paths';
import {
  serializeManifest,
  type Manifest,
  type ManifestTrack,
} from './manifest';

// ── Storage provider abstraction ────────────────────────────────────────

export interface PutObjectInput {
  /** Object key relativa (es. `recordings/multitrack/.../audio/x.opus`). */
  key: string;
  /** Contenuto da caricare. */
  body: Buffer;
  contentType: string;
}

export interface StorageProvider {
  /** Carica un oggetto. Idempotente per key (overwrite). */
  putObject(input: PutObjectInput): Promise<void>;
  /** Nome del provider per logging. */
  readonly name: string;
}

/**
 * Provider no-op: utile in locale (nessuno storage reale) e nei test.
 * Registra le chiamate ricevute così i test possono fare asserzioni.
 */
export class NoopStorageProvider implements StorageProvider {
  readonly name = 'noop';
  readonly puts: Array<{ key: string; contentType: string; size: number }> = [];

  async putObject(input: PutObjectInput): Promise<void> {
    this.puts.push({
      key: input.key,
      contentType: input.contentType,
      size: input.body.length,
    });
  }
}

export interface StorageEnv {
  RECORDING_STORAGE_TYPE?: string;
  // I provider reali leggono le proprie credenziali dall'env, allineate a
  // jibri-finalize.sh (RECORDING_AZURE_CONNECTION_STRING, RECORDING_S3_BUCKET, …).
  [key: string]: string | undefined;
}

/**
 * Factory del provider di storage.
 *
 * TODO(ADR-013 Fase 3 — upload reale): implementare i provider veri
 * riusando le stesse env var e bucket di `jibri-finalize.sh`:
 *   - `azure-blob` → @azure/storage-blob (RECORDING_AZURE_CONNECTION_STRING,
 *     RECORDING_AZURE_CONTAINER)
 *   - `s3`         → @aws-sdk/client-s3 (RECORDING_S3_BUCKET, RECORDING_S3_REGION)
 *   - `gcs`        → @google-cloud/storage (RECORDING_GCS_BUCKET)
 *   - `minio`      → minio o @aws-sdk/client-s3 con endpoint custom
 * Le tracce per-partecipante vanno cifrate at-rest (chiavi separate dagli
 * artifact pubblici, vedi GDPR nell'ADR) — preferire SSE lato bucket.
 * Finché non implementato, ritorniamo il noop per non bloccare la Fase 3.
 */
export function createStorageProvider(env: StorageEnv): StorageProvider {
  const type = env.RECORDING_STORAGE_TYPE ?? 'local';
  switch (type) {
    case 'azure-blob':
    case 's3':
    case 'gcs':
    case 'minio':
      // TODO: implementare. Per ora fallback esplicito al noop con warning.
      console.warn(
        `[recorder] storage provider "${type}" non ancora implementato — ` +
          'uso NoopStorageProvider (le tracce NON vengono caricate). ' +
          'Vedi TODO in upload.ts.',
      );
      return new NoopStorageProvider();
    case 'local':
    default:
      // In locale teniamo i file su disco in OUTPUT_DIR; non serve upload.
      return new NoopStorageProvider();
  }
}

// ── Upload tracce + manifest ─────────────────────────────────────────────

/** Mapping fra una entry del manifest e il file locale da caricare. */
export interface LocalTrackFile {
  track: ManifestTrack;
  /** Path assoluto del file audio su disco (in OUTPUT_DIR). */
  localPath: string;
}

const OPUS_CONTENT_TYPE = 'audio/ogg; codecs=opus';
const MANIFEST_CONTENT_TYPE = 'application/json';

/**
 * Carica tutte le tracce + il manifest. La key di ogni traccia è
 * ricalcolata da `paths.trackKey` (single source of truth) e DEVE
 * combaciare con `track.trackKey` del manifest — lo verifichiamo per
 * intercettare drift fra manifest e layout.
 */
export async function uploadRecording(
  provider: StorageProvider,
  params: {
    manifest: Manifest;
    files: LocalTrackFile[];
  },
): Promise<{ uploaded: number }> {
  const { manifest, files } = params;
  let uploaded = 0;

  for (const f of files) {
    const expectedKey = trackKey(
      manifest.eventId,
      manifest.recordingId,
      f.track.participantId,
    );
    if (expectedKey !== f.track.trackKey) {
      throw new Error(
        `track key mismatch: manifest=${f.track.trackKey} expected=${expectedKey}`,
      );
    }
    const body = await readFile(f.localPath);
    await provider.putObject({
      key: f.track.trackKey,
      body,
      contentType: OPUS_CONTENT_TYPE,
    });
    uploaded += 1;
  }

  await provider.putObject({
    key: manifestKey(manifest.eventId, manifest.recordingId),
    body: Buffer.from(serializeManifest(manifest), 'utf-8'),
    contentType: MANIFEST_CONTENT_TYPE,
  });

  return { uploaded };
}

// ── Webhook al portale ───────────────────────────────────────────────────

/**
 * Payload del webhook multitraccia. È un superset del payload Jibri
 * (`roomName`) così il portale può riconoscere l'evento, più i campi
 * specifici della registrazione multitraccia. Il portale dovrà aggiungere
 * un endpoint/branch dedicato (vedi TODO ingest nell'ADR): qui ci limitiamo
 * a produrre un payload coerente e firmato.
 */
export interface MultitrackWebhookPayload {
  type: 'multitrack';
  roomName: string;
  eventId: string;
  recordingId: string;
  /** Key del manifest nello storage (l'ingest lo scarica da lì). */
  manifestKey: string;
  trackCount: number;
  recordingStartedAtMs: number;
}

export function buildWebhookPayload(manifest: Manifest): MultitrackWebhookPayload {
  return {
    type: 'multitrack',
    roomName: manifest.roomName,
    eventId: manifest.eventId,
    recordingId: manifest.recordingId,
    manifestKey: manifestKey(manifest.eventId, manifest.recordingId),
    trackCount: manifest.tracks.length,
    recordingStartedAtMs: manifest.recordingStartedAtMs,
  };
}

/**
 * Calcola la firma HMAC-SHA256 del body, nello stesso formato atteso dal
 * portale (`sha256=<hex>`, header `X-Webhook-Signature`). Logica pura,
 * testabile. Replica `jibri-finalize.sh` e `verifyWebhookSignature`.
 */
export function signWebhookBody(body: string, secret: string): string {
  const hex = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hex}`;
}

export interface NotifyWebhookOptions {
  webhookUrl: string;
  /** CRON_API_KEY: bearer-token, come in jibri-finalize.sh. */
  cronApiKey?: string;
  /** RECORDING_WEBHOOK_SECRET: se presente, firma il body HMAC. */
  webhookSecret?: string;
  /** Iniettabile per i test (default: global fetch). */
  fetchImpl?: typeof fetch;
}

/**
 * POST del webhook al portale. Side-effect (rete): non unit-testato
 * contro un server reale, ma `signWebhookBody` / `buildWebhookPayload`
 * sono puri e testabili e `fetchImpl` è iniettabile.
 */
export async function notifyPortal(
  payload: MultitrackWebhookPayload,
  opts: NotifyWebhookOptions,
): Promise<void> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.cronApiKey) {
    headers['Authorization'] = `Bearer ${opts.cronApiKey}`;
  }
  if (opts.webhookSecret) {
    headers['X-Webhook-Signature'] = signWebhookBody(body, opts.webhookSecret);
  }

  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(opts.webhookUrl, {
    method: 'POST',
    headers,
    body,
  });
  if (!res.ok) {
    throw new Error(
      `webhook al portale fallito: ${res.status} ${res.statusText}`,
    );
  }
}
