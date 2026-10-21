/**
 * Postprod storage helpers.
 *
 * The postprod pipeline shares the **same provider** as the recordings
 * domain (no separate bucket / container) so reconciliation, retention,
 * and access policies remain consistent. We just use a different
 * prefix (`postprod/`) inside the bucket.
 *
 * This module wraps the recordings provider for postprod-specific
 * concerns:
 *   - presigned upload URLs for the worker (PUT),
 *   - presigned download URLs for source MP4 + dep artifacts (GET),
 *   - listing artifacts under a recording/event prefix,
 *   - bulk deletion when retention expires.
 */

import { POSTPROD_PREFIX } from '@/lib/ai/paths';
import {
  getRecordingsStorage,
  type StorageProvider,
} from '@/lib/storage';

/** Resolve the shared recordings provider. Throws when not configured. */
export function getPostprodStorage(): StorageProvider {
  const provider = getRecordingsStorage();
  if (!provider) {
    throw new Error(
      'Postprod storage requires the recordings domain to be configured ' +
        '(RECORDING_STORAGE_TYPE + RECORDING_{AZURE,S3}_* env). See ' +
        'docs/configuration/storage.md.',
    );
  }
  return provider;
}

export function isPostprodStorageConfigured(): boolean {
  return getRecordingsStorage() !== null;
}

/**
 * Sign a PUT URL for the worker to upload an artifact directly to
 * storage (no egress through the app).
 */
export async function presignArtifactUpload(opts: {
  blobKey: string;
  contentType: string;
  /** Default 30 min, capped by the provider implementation. */
  expiresInMinutes?: number;
}): Promise<{ uploadUrl: string; publicUrl: string }> {
  const provider = getPostprodStorage();
  return provider.getUploadUrl(opts.blobKey, {
    contentType: opts.contentType,
    expiresInMinutes: opts.expiresInMinutes ?? 30,
  });
}

/**
 * Sign a GET URL for the worker to download the source MP4 or a
 * dependency artifact. Lower-trust than upload (read-only) so we use
 * a slightly longer default expiry.
 */
export async function presignArtifactDownload(opts: {
  blobKey: string;
  expiresInMinutes?: number;
  /** Forces Content-Disposition: attachment with this filename. */
  downloadFilename?: string;
}): Promise<string> {
  const provider = getPostprodStorage();
  return provider.getDownloadUrl(opts.blobKey, {
    expiresInMinutes: opts.expiresInMinutes ?? 60,
    ...(opts.downloadFilename && { downloadFilename: opts.downloadFilename }),
  });
}

/**
 * Riscrive il contenuto di un artefatto già presente nell'archivio.
 *
 * Il testo di una trascrizione vive in due posti — la copia cifrata nella banca
 * dati e il file nell'archivio — e due casi devono allinearli: la
 * cancellazione di un contenuto (riscrivere solo la banca dati lascerebbe la
 * frase rimossa dentro il file) e la trascrizione corretta a mano, che il
 * worker scarica dall'archivio per sintesi, traduzioni e doppiaggi
 * (lib/ai/transcript-input). L'app non carica i file di norma (lo fa il worker
 * con un indirizzo firmato), ma qui la scrittura è piccola e deve avvenire
 * adesso. Passa dal fornitore lato server: un PUT su un indirizzo firmato
 * avrebbe bisogno delle intestazioni proprie di ciascun archivio.
 *
 * Non solleva: la modifica nella banca dati è già avvenuta e non va annullata
 * perché l'archivio non risponde. Restituisce false, e chi chiama decide come
 * dirlo.
 */
export async function rewritePostprodBlob(
  blobKey: string,
  body: string,
  contentType: string,
  /** Oltre questo tempo la scrittura si interrompe e risulta non riuscita. */
  timeoutMs = 10_000,
): Promise<boolean> {
  if (!blobKey.startsWith(`${POSTPROD_PREFIX}/`)) return false;
  try {
    await getPostprodStorage().put(blobKey, Buffer.from(body, 'utf8'), contentType, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return true;
  } catch {
    return false;
  }
}

/** Delete a postprod artifact blob. Returns false if not found. */
export async function deletePostprodBlob(blobKey: string): Promise<boolean> {
  // Defensive: only allow deletes under the postprod/ prefix so a
  // miswired caller can never wipe a recording.
  if (!blobKey.startsWith(`${POSTPROD_PREFIX}/`)) {
    throw new Error(
      `refusing to delete blob outside postprod/ prefix: ${blobKey}`,
    );
  }
  const provider = getPostprodStorage();
  return provider.delete(blobKey);
}

/**
 * List blobs under a postprod prefix. Empty array when none.
 *
 * The default S3 list is up to 1000 entries per call — that's fine for
 * a single recording / run (~10 artifacts) but explicit pagination
 * would be needed for cluster-wide audits. The reconciliation cron
 * uses the provider's `list` directly with a longer prefix.
 */
export async function listPostprodBlobs(prefix: string): Promise<
  Array<{ key: string; sizeBytes: number | null }>
> {
  if (!prefix.startsWith(`${POSTPROD_PREFIX}/`) && prefix !== POSTPROD_PREFIX) {
    throw new Error(`postprod listing must be scoped to postprod/: ${prefix}`);
  }
  const provider = getPostprodStorage();
  const entries = await provider.list(prefix);
  return entries.map((e) => ({ key: e.key, sizeBytes: e.sizeBytes }));
}
