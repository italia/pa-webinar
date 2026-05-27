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
        'docs/POSTPROD.md.',
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
