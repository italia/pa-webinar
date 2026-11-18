// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Recordings storage — thin adapter on top of the StorageProvider
 * abstraction (`./index.ts`). Historically this module was Azure-only
 * with `RECORDING_AZURE_*` env vars; it now works with any provider
 * (Azure Blob, AWS S3, MinIO, GCS S3-compat, PSN, Cloudflare R2) and
 * keeps the same public API so callers don't change.
 *
 * Domain convention: recordings live at `recordings/<filename>` inside
 * whatever bucket/container the provider is pointed to.
 */

import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { erroreDestinazioneNonCoperta, type Destinazione } from '@/lib/recording/destination';

import type { BrowserUpload, StorageProvider } from './provider';

import { getRecordingsStorage, recordingsProviderLabel } from './index';

const KEY_PREFIX = 'recordings/';

// Object-storage keys are opaque strings — S3/Azure do not resolve `..`
// like a filesystem would, so "path traversal" can't escape the bucket.
// We still reject dotdot segments, leading slashes, NUL bytes and
// control chars so that the stored key is always predictable and cannot
// be used to spoof an adjacent key in UI listings (e.g. smuggling
// `recordings/../publications/foo.mp4` into a dashboard).
function keyFromFilename(filename: string): string {
  if (!filename || /[\0\r\n]/.test(filename)) {
    throw new Error('Invalid filename: empty or contains control chars');
  }
  if (filename.startsWith('/')) {
    throw new Error('Invalid filename: leading slash not allowed');
  }
  // Reject `..` as a standalone path segment (anywhere in the key).
  const segments = filename.split('/');
  if (segments.some((s) => s === '..' || s === '.')) {
    throw new Error('Invalid filename: dotdot segments not allowed');
  }
  return filename.startsWith(KEY_PREFIX) ? filename : `${KEY_PREFIX}${filename}`;
}

/**
 * Generate a presigned upload URL for a new recording blob, used by the
 * Jibri finalize hook (via /api/internal/recording-upload-url). Manual
 * uploads from the admin UI go through `createRecordingBrowserUpload`.
 *
 * Returns null when no recordings provider is configured (dev mode)
 * or when required credentials are missing.
 */
export async function generateRecordingUploadUrl(
  filename: string,
  expiresInMinutes: number,
): Promise<{ uploadUrl: string; recordingUrl: string } | null> {
  const provider = getRecordingsStorage();
  if (!provider) return null;

  const key = keyFromFilename(filename);
  const { uploadUrl, publicUrl } = await provider.getUploadUrl(key, {
    expiresInMinutes,
    contentType: 'video/mp4',
  });
  return { uploadUrl, recordingUrl: publicUrl };
}

/**
 * Prepara il caricamento diretto dal browser di un video nel dominio
 * registrazioni. Il protocollo (blocchi Azure, PUT singolo o a parti S3) lo
 * sceglie il provider; `recordingUrl` è l'URL canonico da salvare dopo il
 * caricamento. Null quando lo storage delle registrazioni non è configurato.
 */
export async function createRecordingBrowserUpload(
  filename: string,
  opts: { contentType: string; sizeBytes: number; expiresInMinutes: number },
): Promise<{ recordingUrl: string; upload: BrowserUpload } | null> {
  const provider = getRecordingsStorage();
  if (!provider) return null;

  const key = keyFromFilename(filename);
  const upload = await provider.createBrowserUpload(key, opts);
  return { recordingUrl: provider.publicUrl(key), upload };
}

/**
 * Chiude un caricamento a parti aperto da `createRecordingBrowserUpload`.
 * False quando lo storage non è configurato; lancia `IncompleteUploadError`
 * se le parti arrivate non compongono il file dichiarato.
 */
export async function completeRecordingBrowserUpload(
  filename: string,
  opts: { uploadId: string; sizeBytes: number },
): Promise<boolean> {
  const provider = getRecordingsStorage();
  if (!provider) return false;
  await provider.completeBrowserUpload(keyFromFilename(filename), opts);
  return true;
}

/** Annulla un caricamento a parti e ne libera le parti già caricate. */
export async function abortRecordingBrowserUpload(
  filename: string,
  uploadId: string,
): Promise<boolean> {
  const provider = getRecordingsStorage();
  if (!provider) return false;
  await provider.abortBrowserUpload(keyFromFilename(filename), uploadId);
  return true;
}

/**
 * Return a short-lived signed GET URL for an existing recording of the
 * event `eventId`, given the canonical URL we stored in the DB. Returns
 * `recordingUrl` unchanged if no provider is configured (local/dev mode —
 * URL is assumed usable as-is). Returns null if the URL can't be parsed
 * against the configured provider (corrupt DB row, moved bucket, etc.) or
 * if the object belongs to another event (`appartenenzaChiave`): a signed
 * URL is a read grant, and it is only ever given for the event's own files.
 */
export async function generateRecordingSasUrl(
  recordingUrl: string,
  expiresInMinutes: number,
  eventId: string,
): Promise<string | null> {
  const provider = getRecordingsStorage();
  if (!provider) return recordingUrl;

  const key = provider.keyFromUrl(recordingUrl);
  if (!key) return null;
  if ((await appartenenzaChiave(provider, key, eventId)) === 'altrui') {
    console.warn(`[storage] refusing to sign a file of another event (event ${eventId})`);
    return null;
  }

  return provider.getDownloadUrl(key, { expiresInMinutes });
}

/** Le chiavi che portano nel nome l'evento a cui appartengono. */
const PREFISSI_CON_EVENTO = /^(?:postprod|recordings\/multitrack)\/([0-9a-f-]{36})\//i;

/**
 * Una chiave che lo storage, o qualcuno lungo la strada, potrebbe leggere come
 * un'altra: segmenti vuoti, `.` o `..`, barre rovesciate, barre e punti
 * codificati. Un confronto fra stringhe sul prefisso non dice dove finisce
 * davvero (lib/recorder/blob-key): una chiave cosi' non si attribuisce a
 * nessun evento e non si firma.
 */
function chiaveAmbigua(key: string): boolean {
  if (/%(2e|2f|5c)/i.test(key) || key.includes('\\')) return true;
  return key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
}

/**
 * Di chi e' un oggetto dello storage delle registrazioni, rispetto a un evento.
 *
 *  - `dell-evento`: porta l'evento nel nome (postprod, tracce per persona), e'
 *    il file di una sua registrazione o sessione, oppure nessun altro evento lo
 *    usa (un video caricato a mano, il cui nome non dice l'evento);
 *  - `altrui`: porta nel nome un altro evento, o e' il video, il recupero in
 *    diretta, una registrazione o una sessione di un altro evento; oppure e'
 *    una chiave ambigua (`chiaveAmbigua`), che non si attribuisce a nessuno.
 *
 * L'indirizzo si confronta per chiave, non per testo: due forme dello stesso
 * oggetto (path-style e virtual-host) sono lo stesso file.
 */
export async function appartenenzaChiave(
  provider: StorageProvider,
  key: string,
  eventId: string,
): Promise<'dell-evento' | 'altrui'> {
  if (chiaveAmbigua(key)) return 'altrui';
  const conEvento = PREFISSI_CON_EVENTO.exec(key);
  if (conEvento) return conEvento[1]!.toLowerCase() === eventId.toLowerCase() ? 'dell-evento' : 'altrui';

  const [registrazioni, eventi, sessioni] = await Promise.all([
    prisma.recording.findMany({ where: { blobKey: key }, select: { eventId: true } }),
    // Anche il recupero in diretta di un altro evento: e' un suo file.
    prisma.event.findMany({
      where: {
        id: { not: eventId },
        OR: [{ recordingUrl: { contains: key } }, { tempRecordingUrl: { contains: key } }],
      },
      select: { recordingUrl: true, tempRecordingUrl: true },
    }),
    prisma.callSession.findMany({
      where: { eventId: { not: eventId }, recordingUrl: { contains: key } },
      select: { recordingUrl: true },
    }),
  ]);
  const stessaChiave = (url: string | null) => !!url && provider.keyFromUrl(url) === key;
  if (registrazioni.some((r) => r.eventId !== eventId)) return 'altrui';
  if (eventi.some((e) => stessaChiave(e.recordingUrl) || stessaChiave(e.tempRecordingUrl))) return 'altrui';
  if (sessioni.some((c) => stessaChiave(c.recordingUrl))) return 'altrui';
  return 'dell-evento';
}

/**
 * Un indirizzo nuovo per il video di un evento: se e' un file del nostro
 * storage, deve essere suo (`appartenenzaChiave`). Un indirizzo esterno, o
 * senza storage configurato, non e' un file che l'app firma: passa com'e'
 * (le regole su dove puo' stare le applica `assertVideoNelloStorage`).
 */
export async function assertVideoDellEvento(
  eventId: string,
  url: string | null | undefined,
): Promise<void> {
  if (!url) return;
  const provider = getRecordingsStorage();
  const key = provider?.keyFromUrl(url);
  if (!provider || !key) return;
  if ((await appartenenzaChiave(provider, key, eventId)) === 'altrui') {
    throw new AppError(
      'The recording URL points to a file of another event',
      422,
      'RECORDING_URL_NOT_OWNED',
    );
  }
}

/**
 * Delete a recording object given its canonical URL. No-op (returns
 * false with a warning) when the provider isn't configured or the URL
 * doesn't parse.
 */
export async function deleteRecordingBlob(recordingUrl: string): Promise<boolean> {
  const provider = getRecordingsStorage();
  if (!provider) {
    console.warn(`[storage] Cannot delete: provider not configured (${recordingsProviderLabel()})`);
    return false;
  }

  const key = provider.keyFromUrl(recordingUrl);
  if (!key) {
    console.warn(`[storage] Cannot parse key from URL: ${recordingUrl}`);
    return false;
  }

  const ok = await provider.delete(key);
  if (ok) {
    console.log(`[storage] Deleted recording: ${key}`);
  } else {
    console.warn(`[storage] Recording not found or delete failed: ${key}`);
  }
  return ok;
}

/**
 * Un indirizzo nuovo per il video di un evento riservato deve essere un file
 * dello storage: li' lo protegge la rotta che ne firma l'indirizzo, mentre un
 * video esterno resta fuori da ogni regola di accesso. Senza storage configurato
 * (ambiente locale) non lo si puo' dire, e l'indirizzo vale com'e', come in
 * `generateRecordingSasUrl`.
 */
export function assertVideoNelloStorage(
  destinazione: Destinazione,
  prima: string | null | undefined,
  dopo: string | null | undefined,
): void {
  if (destinazione !== 'REGISTRANTS' || !dopo || dopo === prima) return;
  const provider = getRecordingsStorage();
  if (provider && !provider.keyFromUrl(dopo)) throw erroreDestinazioneNonCoperta();
}

/** Se l'indirizzo e' un file del nostro storage delle registrazioni. */
export function fileDelloStorage(url: string): boolean {
  const provider = getRecordingsStorage();
  return !!provider && provider.keyFromUrl(url) !== null;
}

/** True when a recordings provider is configured and wired. */
export function isRecordingStorageConfigured(): boolean {
  return getRecordingsStorage() !== null;
}

/**
 * Stable label for the UI/status ('azure-blob' | 's3' | 'not-configured').
 * Kept backwards-compatible with the old string values.
 */
export function getRecordingStorageType(): string {
  return recordingsProviderLabel();
}

export interface RecordingBlobEntry {
  name: string;
  url: string;
  sizeBytes: number | null;
  lastModified: Date | null;
}

/**
 * Enumerate all recordings currently present on the provider. Used by
 * the reconciliation cron to cross-reference against DB rows. Returns
 * an empty list when no provider is configured.
 *
 * `name` is the key *without* the `recordings/` prefix — this matches
 * the historical Azure-only behaviour so callers stored in the DB as
 * bare filenames keep working.
 */
export async function listRecordingBlobs(): Promise<RecordingBlobEntry[]> {
  const provider = getRecordingsStorage();
  if (!provider) return [];

  const entries = await provider.list(KEY_PREFIX);
  return entries.map((e) => ({
    // strip the `recordings/` prefix to keep backwards compat with
    // callers that only know filenames, not full keys
    name: recordingBlobNameFromKey(e.key) ?? e.key,
    url: e.url,
    sizeBytes: e.sizeBytes,
    lastModified: e.lastModified,
  }));
}

/**
 * Nome "nudo" (quello di `listRecordingBlobs`) di una chiave completa
 * `recordings/…`, o null se la chiave sta fuori dal dominio delle
 * registrazioni.
 */
export function recordingBlobNameFromKey(key: string): string | null {
  return key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : null;
}

/** Delete by bare blob name (without the `recordings/` prefix). */
export async function deleteRecordingBlobByName(blobName: string): Promise<boolean> {
  const provider = getRecordingsStorage();
  if (!provider) return false;
  return provider.delete(keyFromFilename(blobName));
}
