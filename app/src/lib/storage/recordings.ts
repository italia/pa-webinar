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
 * Generate a presigned upload URL for a new recording blob. Used by:
 *   - Jibri finalize hook (via /api/internal/recording-upload-url)
 *   - manual publication upload from the admin UI
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
 * Return a short-lived signed GET URL for an existing recording, given
 * the canonical URL we stored in the DB. Returns `recordingUrl` unchanged
 * if no provider is configured (local/dev mode — URL is assumed usable
 * as-is). Returns null if the URL can't be parsed against the configured
 * provider (corrupt DB row, moved bucket, etc.).
 */
export async function generateRecordingSasUrl(
  recordingUrl: string,
  expiresInMinutes: number,
): Promise<string | null> {
  const provider = getRecordingsStorage();
  if (!provider) return recordingUrl;

  const key = provider.keyFromUrl(recordingUrl);
  if (!key) return null;

  return provider.getDownloadUrl(key, { expiresInMinutes });
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
    name: e.key.startsWith(KEY_PREFIX) ? e.key.slice(KEY_PREFIX.length) : e.key,
    url: e.url,
    sizeBytes: e.sizeBytes,
    lastModified: e.lastModified,
  }));
}

/** Delete by bare blob name (without the `recordings/` prefix). */
export async function deleteRecordingBlobByName(blobName: string): Promise<boolean> {
  const provider = getRecordingsStorage();
  if (!provider) return false;
  return provider.delete(keyFromFilename(blobName));
}
