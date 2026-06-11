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

import { readFile } from 'node:fs/promises';

import { manifestKey, trackKey } from './paths.js';
import {
  serializeManifest,
  type Manifest,
  type ManifestTrack,
} from './manifest.js';

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

/**
 * Provider basato su URL firmato (SAS Azure / presigned S3 / signed GCS).
 *
 * Le credenziali NON vivono nel recorder: il portale, quando avvia il
 * recorder per un evento, gli passa una *base URL firmata* con scadenza
 * breve (`RECORDING_UPLOAD_BASE_URL`) che punta al prefisso/container della
 * registrazione. Per ogni oggetto facciamo un `PUT` raw verso
 * `<base>/<key>?<firma>`. È lo stesso pattern collaudato del worker
 * (`infra/ai/worker/client.py`): per Azure Blob aggiungiamo l'header
 * obbligatorio `x-ms-blob-type: BlockBlob`, senza il quale il PUT torna 400.
 *
 * Vantaggi: zero SDK pesanti, funziona per Azure/S3/GCS (tutti accettano
 * un PUT su URL firmato), e tiene le chiavi di storage fuori dal bot —
 * coerente coi requisiti GDPR dell'ADR (tracce per-partecipante sensibili).
 */
export class SignedUrlStorageProvider implements StorageProvider {
  readonly name = 'signed-url';

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async putObject(input: PutObjectInput): Promise<void> {
    const url = composeObjectUrl(this.baseUrl, input.key);
    await putToSignedUrl(this.fetchImpl, url, input);
  }
}

/**
 * Provider con presign per-traccia just-in-time (modalità claim, cluster).
 *
 * I partecipanti non sono noti al claim, quindi per OGNI oggetto chiediamo
 * al portale un PUT firmato (`/api/internal/recorder-upload-url`, x-api-key)
 * e ci carichiamo sopra. Scope minimo (un blob per firma) → preferito alla
 * SAS di prefisso lato sicurezza; il portale path-confina ogni blobKey.
 */
export class PresignStorageProvider implements StorageProvider {
  readonly name = 'presign';

  constructor(
    private readonly opts: {
      uploadUrlEndpoint: string;
      recordingId: string;
      cronApiKey: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  private get fetchImpl(): typeof fetch {
    return this.opts.fetchImpl ?? fetch;
  }

  async putObject(input: PutObjectInput): Promise<void> {
    const presignRes = await this.fetchImpl(this.opts.uploadUrlEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.opts.cronApiKey,
      },
      body: JSON.stringify({
        recordingId: this.opts.recordingId,
        blobKey: input.key,
        contentType: input.contentType,
      }),
    });
    if (!presignRes.ok) {
      throw new Error(
        `presign "${input.key}" fallito: ${presignRes.status} ${presignRes.statusText}`,
      );
    }
    const { uploadUrl } = (await presignRes.json()) as { uploadUrl: string };
    await putToSignedUrl(this.fetchImpl, uploadUrl, input);
  }
}

/** PUT raw su un URL firmato (+ x-ms-blob-type per Azure). Condiviso. */
async function putToSignedUrl(
  fetchImpl: typeof fetch,
  url: string,
  input: PutObjectInput,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': input.contentType,
  };
  // Azure Blob: PUT Blob richiede x-ms-blob-type (vedi client.py:233).
  if (url.includes('blob.core.windows.net')) {
    headers['x-ms-blob-type'] = 'BlockBlob';
  }
  const res = await fetchImpl(url, {
    method: 'PUT',
    headers,
    body: new Uint8Array(input.body),
  });
  if (!res.ok) {
    throw new Error(
      `upload "${input.key}" fallito: ${res.status} ${res.statusText}`,
    );
  }
}

/**
 * Compone l'URL del singolo oggetto a partire dalla base firmata e dalla
 * key. La firma (query string) va preservata DOPO il path: splittiamo su
 * `?`, accodiamo `/<key>` al path e ri-appendiamo la query. Logica pura →
 * unit-testata.
 */
export function composeObjectUrl(baseUrl: string, key: string): string {
  const qIdx = baseUrl.indexOf('?');
  const path = qIdx === -1 ? baseUrl : baseUrl.slice(0, qIdx);
  const query = qIdx === -1 ? '' : baseUrl.slice(qIdx + 1);
  const trimmedPath = path.replace(/\/+$/, '');
  const trimmedKey = key.replace(/^\/+/, '');
  const full = `${trimmedPath}/${trimmedKey}`;
  return query ? `${full}?${query}` : full;
}

export interface StorageEnv {
  RECORDING_STORAGE_TYPE?: string;
  /**
   * Base URL firmata emessa dal portale (SAS Azure / presigned S3 / signed
   * GCS) verso il prefisso della registrazione. Se presente, si usa il
   * provider signed-URL indipendentemente da RECORDING_STORAGE_TYPE.
   */
  RECORDING_UPLOAD_BASE_URL?: string;
  [key: string]: string | undefined;
}

/**
 * Factory del provider di storage.
 *
 * Se il portale ha passato `RECORDING_UPLOAD_BASE_URL` (caso cluster),
 * usiamo `SignedUrlStorageProvider`. Altrimenti, in locale
 * (`RECORDING_STORAGE_TYPE=local` o non impostato), restiamo sul noop:
 * i file restano su disco in OUTPUT_DIR e non c'è nulla da caricare.
 *
 * Se è impostato un tipo cloud SENZA base URL firmata è un errore di
 * configurazione: lo segnaliamo e degradiamo al noop per non perdere
 * silenziosamente le tracce credendo di averle caricate.
 */
export function createStorageProvider(
  env: StorageEnv,
  fetchImpl: typeof fetch = fetch,
): StorageProvider {
  if (env.RECORDING_UPLOAD_BASE_URL) {
    return new SignedUrlStorageProvider(env.RECORDING_UPLOAD_BASE_URL, fetchImpl);
  }
  const type = env.RECORDING_STORAGE_TYPE ?? 'local';
  if (type !== 'local') {
    console.warn(
      `[recorder] RECORDING_STORAGE_TYPE="${type}" ma manca ` +
        'RECORDING_UPLOAD_BASE_URL (URL firmato dal portale): uso ' +
        'NoopStorageProvider, le tracce NON verranno caricate. ' +
        'Il portale deve passare una base URL firmata allo spawn del recorder.',
    );
  }
  return new NoopStorageProvider();
}

// ── Upload tracce + manifest ─────────────────────────────────────────────

/** Mapping fra una entry del manifest e il file locale da caricare. */
export interface LocalTrackFile {
  track: ManifestTrack;
  /** Path assoluto del file audio su disco (in OUTPUT_DIR). */
  localPath: string;
}

// Il MediaRecorder produce un container WebM (mimeType 'audio/webm;codecs=opus'),
// NON Ogg: dichiariamo il content-type reale. Il worker comunque decodifica
// via ffmpeg che sonda il contenuto (l'estensione .opus resta solo
// un'etichetta di storage).
const OPUS_CONTENT_TYPE = 'audio/webm; codecs=opus';
const MANIFEST_CONTENT_TYPE = 'application/json';

/** putObject con qualche retry (errori di rete transienti). Non ri-presigna:
 * l'URL firmato è valido per la finestra di lease. */
async function putWithRetry(
  provider: StorageProvider,
  key: string,
  body: Buffer,
  contentType: string,
  attempts = 3,
): Promise<void> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await provider.putObject({ key, body, contentType });
      return;
    } catch (e) {
      lastErr = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, 300 * i));
    }
  }
  throw lastErr;
}

/**
 * Carica le tracce + il manifest, con TOLLERANZA PARZIALE: se l'upload di una
 * traccia fallisce (dopo i retry) si salta SOLO quella e le altre proseguono.
 * Il manifest caricato/ingestato contiene SOLO le tracce realmente salite, così
 * il portale non crea righe RecordingTrack che puntano a blob mancanti (il
 * worker andrebbe in 404). Ritorna il manifest EFFETTIVO da usare per l'ingest.
 *
 * La key di ogni traccia è ricalcolata da `paths.trackKey` (single source of
 * truth) e DEVE combaciare con `track.trackKey` (drift = bug → throw).
 */
export async function uploadRecording(
  provider: StorageProvider,
  params: {
    manifest: Manifest;
    files: LocalTrackFile[];
  },
): Promise<{
  uploaded: number;
  trackSizes: Record<string, number>;
  manifest: Manifest;
  failed: string[];
}> {
  const { manifest, files } = params;
  const trackSizes: Record<string, number> = {};
  const failed: string[] = [];
  const okTracks: ManifestTrack[] = [];

  for (const f of files) {
    const expectedKey = trackKey(
      manifest.eventId,
      manifest.recordingId,
      f.track.trackFileId,
    );
    if (expectedKey !== f.track.trackKey) {
      throw new Error(
        `track key mismatch: manifest=${f.track.trackKey} expected=${expectedKey}`,
      );
    }
    try {
      const body = await readFile(f.localPath);
      await putWithRetry(provider, f.track.trackKey, body, OPUS_CONTENT_TYPE);
      // Chiave per SESSIONE (no collisioni su rejoin dello stesso pid).
      trackSizes[f.track.trackFileId] = body.length;
      okTracks.push(f.track);
    } catch (e) {
      console.error(
        `[recorder] upload traccia ${f.track.trackKey} fallito dopo i retry, la salto:`,
        e,
      );
      failed.push(f.track.trackKey);
    }
  }

  // Manifest effettivo = solo le tracce caricate. Se TUTTE falliscono,
  // tracks=[] e il chiamante non ingesta (evita righe orfane / 404 worker).
  const effectiveManifest: Manifest = { ...manifest, tracks: okTracks };
  await putWithRetry(
    provider,
    manifestKey(manifest.eventId, manifest.recordingId),
    Buffer.from(serializeManifest(effectiveManifest), 'utf-8'),
    MANIFEST_CONTENT_TYPE,
  );

  return { uploaded: okTracks.length, trackSizes, manifest: effectiveManifest, failed };
}

// ── Ingest al portale ────────────────────────────────────────────────────
//
// A fine evento il recorder chiama `POST /api/internal/multitrack-manifest`
// (ADR-013 Fase 2, già implementato nel portale). Il contratto è: array di
// tracce con `blobKey` sotto il prefisso `recordings/multitrack/{eventId}/
// {recordingId}/`, autenticato con CRON_API_KEY (header `x-api-key`, come
// gli altri endpoint /internal). Il portale cifra i displayName (il recorder
// non ha le chiavi PII), crea le RecordingTrack e accoda TRANSCRIBE_MULTITRACK.

/** Una traccia nel body d'ingest, allineata a `multitrack-manifest` (zod). */
export interface IngestTrack {
  participantId: string;
  displayName: string | null;
  /** = `track.trackKey`; il portale verifica il prefisso. */
  blobKey: string;
  mimeType: string;
  sizeBytes?: number;
  startOffsetMs: number;
  durationMs?: number;
}

export interface IngestBody {
  eventId: string;
  recordingId: string;
  tracks: IngestTrack[];
}

/**
 * Costruisce il body d'ingest dal manifest. Logica pura → testabile.
 * `trackSizes` (da `uploadRecording`) popola `sizeBytes` per participantId.
 */
export function buildIngestBody(
  manifest: Manifest,
  trackSizes: Record<string, number> = {},
): IngestBody {
  return {
    eventId: manifest.eventId,
    recordingId: manifest.recordingId,
    tracks: manifest.tracks.map((t) => ({
      participantId: t.participantId,
      displayName: t.displayName,
      blobKey: t.trackKey,
      mimeType: OPUS_CONTENT_TYPE,
      ...(trackSizes[t.trackFileId] != null
        ? { sizeBytes: trackSizes[t.trackFileId] }
        : {}),
      startOffsetMs: t.startOffsetMs,
      durationMs: t.durationMs,
    })),
  };
}

export interface NotifyIngestOptions {
  /** URL completo di `/api/internal/multitrack-manifest`. */
  ingestUrl: string;
  /** CRON_API_KEY: inviato come header `x-api-key` (come gli /internal). */
  cronApiKey: string;
  /** Iniettabile per i test (default: global fetch). */
  fetchImpl?: typeof fetch;
}

/**
 * POST del manifest d'ingest al portale. Side-effect (rete);
 * `buildIngestBody` è puro e testato, `fetchImpl` è iniettabile.
 */
export async function notifyPortal(
  body: IngestBody,
  opts: NotifyIngestOptions,
): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(opts.ingestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': opts.cronApiKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `ingest multitrack al portale fallito: ${res.status} ${res.statusText}`,
    );
  }
}
