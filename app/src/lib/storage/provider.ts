/**
 * Storage provider abstraction.
 *
 * The platform uses two logical storage domains:
 *   - "files"      → event materials (PDFs, slides, images) uploaded by
 *                    the moderator before/during an event
 *   - "recordings" → Jibri MP4 outputs + manual MP4 uploads
 *
 * Each domain can be backed by a different provider (Azure Blob, AWS S3,
 * MinIO, GCS S3-compat, PSN S3-compat, Cloudflare R2, self-hosted S3).
 * The app talks to whichever provider through this interface — no other
 * code imports vendor SDKs directly.
 *
 * See `index.ts` for the factory that builds a provider from env vars,
 * and `azure-provider.ts` / `s3-provider.ts` for concrete implementations.
 */

export type StorageProviderType = 'azure' | 's3';

export interface UploadUrlOptions {
  /** Presigned URL validity in minutes. Default: 30. */
  expiresInMinutes?: number;
  /**
   * Content-Type the uploader will send. S3 presigned PUTs validate this
   * against the signature — it must match the `Content-Type` header on
   * the upload request exactly, otherwise the PUT is rejected.
   */
  contentType?: string;
}

export interface DownloadUrlOptions {
  /** Presigned URL validity in minutes. Default: 60. */
  expiresInMinutes?: number;
  /**
   * If set, the download is forced as `attachment; filename=...` via
   * `Content-Disposition`. Useful for recording downloads.
   */
  downloadFilename?: string;
}

export interface BlobEntry {
  /** Object key inside the bucket/container (no leading slash). */
  key: string;
  /** Canonical URL (without signature) used to store a reference in DB. */
  url: string;
  sizeBytes: number | null;
  lastModified: Date | null;
}

export interface StorageProvider {
  readonly type: StorageProviderType;
  /** Container name (Azure) or bucket name (S3-compat). */
  readonly bucket: string;

  /**
   * Return a presigned URL that lets the holder upload a single blob
   * with PUT. Also returns the canonical publicUrl (no signature) that
   * callers store in the DB after a successful upload.
   */
  getUploadUrl(
    key: string,
    opts?: UploadUrlOptions,
  ): Promise<{ uploadUrl: string; publicUrl: string }>;

  /**
   * Server-side upload — the app receives the bytes (e.g. from a
   * multipart form) and writes them to the bucket/container directly.
   * Preferred for small assets where routing through the app is fine
   * (images, audio clips, documents). For large media use getUploadUrl
   * so the client uploads directly without egress through the app.
   */
  put(
    key: string,
    body: Buffer | Uint8Array,
    contentType: string,
  ): Promise<{ publicUrl: string }>;

  /**
   * Return a presigned URL that lets the holder download the blob via
   * GET for a limited time. For public/anonymous access switch the
   * container/bucket ACL instead — this API always signs.
   */
  getDownloadUrl(
    key: string,
    opts?: DownloadUrlOptions,
  ): Promise<string>;

  /** Delete a blob by key. Returns true on success, false if not found. */
  delete(key: string): Promise<boolean>;

  /**
   * List blobs under a prefix. Default behaviour is "everything in the
   * bucket"; callers passing `recordings/` get only recordings.
   */
  list(prefix?: string): Promise<BlobEntry[]>;

  /**
   * Canonical (unsigned) URL for a given key. Azure: the blob REST URL
   * rooted at `https://<acct>.blob.core.windows.net/<container>/<key>`.
   * S3: the virtual-hosted-style URL, or path-style when the endpoint
   * is set (MinIO).
   */
  publicUrl(key: string): string;

  /**
   * Create the container/bucket if it doesn't already exist. No-op on
   * providers that auto-create or don't support this (the AWS SDK
   * requires explicit CreateBucket but we usually rely on infra).
   */
  ensure(): Promise<void>;

  /**
   * Given a URL previously stored in the DB (which may or may not
   * include a signature), extract the object key. Returns null if the
   * URL isn't from this provider/bucket.
   */
  keyFromUrl(url: string): string | null;
}
