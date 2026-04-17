/**
 * S3-compatible storage adapter for the StorageProvider interface.
 *
 * Covers AWS S3, MinIO, Cloudflare R2, Wasabi, Backblaze B2 (S3 API),
 * Google Cloud Storage via HMAC S3 interop, and PSN / custom on-prem
 * S3-compatible stores.
 *
 *   - For AWS S3: set region + credentials, omit endpoint
 *   - For MinIO / self-hosted: set endpoint (http/https), forcePathStyle=true
 *   - For GCS: endpoint=https://storage.googleapis.com, region=auto, HMAC keys
 *   - For R2: endpoint=<account>.r2.cloudflarestorage.com, region=auto
 *
 * Uses @aws-sdk/client-s3 v3 and @aws-sdk/s3-request-presigner.
 */

import {
  S3Client,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type {
  StorageProvider,
  UploadUrlOptions,
  DownloadUrlOptions,
  BlobEntry,
} from './provider';

export interface S3ProviderConfig {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Custom endpoint for MinIO / GCS / R2 / PSN. Omit for AWS S3. */
  endpoint?: string;
  /** Required for MinIO and most on-prem S3 (virtual-host DNS not set up). */
  forcePathStyle?: boolean;
}

export class S3StorageProvider implements StorageProvider {
  readonly type = 's3' as const;
  readonly bucket: string;
  private client: S3Client;
  private config: S3ProviderConfig;

  constructor(config: S3ProviderConfig) {
    this.config = config;
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpoint && { endpoint: config.endpoint }),
      forcePathStyle: config.forcePathStyle ?? !!config.endpoint,
    });
  }

  publicUrl(key: string): string {
    // If there's a custom endpoint, build a path-style URL; otherwise
    // use the virtual-hosted-style that AWS expects for public access.
    if (this.config.endpoint) {
      const base = this.config.endpoint.replace(/\/$/, '');
      return this.config.forcePathStyle ?? true
        ? `${base}/${this.bucket}/${key}`
        : // Some endpoints (GCS, R2) accept virtual-host style too
          `${base.replace(/^https?:\/\//, `https://${this.bucket}.`)}/${key}`;
    }
    return `https://${this.bucket}.s3.${this.config.region}.amazonaws.com/${key}`;
  }

  keyFromUrl(url: string): string | null {
    try {
      const u = new URL(url);
      // Strip query string (presigned params).
      const path = u.pathname;

      if (this.config.endpoint) {
        // path-style: /<bucket>/<key>
        const parts = path.split('/').filter(Boolean);
        if (parts.length < 2) return null;
        if (parts[0] === this.bucket) {
          return parts.slice(1).join('/');
        }
        // virtual-host style over custom endpoint
        if (u.hostname.startsWith(`${this.bucket}.`)) {
          return path.replace(/^\//, '');
        }
        return null;
      }

      // AWS S3: virtual-host style expected
      const expectedHost = `${this.bucket}.s3.${this.config.region}.amazonaws.com`;
      if (u.hostname === expectedHost) {
        return path.replace(/^\//, '');
      }
      // path-style on AWS (legacy, still accepted by some regions)
      if (u.hostname === `s3.${this.config.region}.amazonaws.com`) {
        const parts = path.split('/').filter(Boolean);
        if (parts[0] === this.bucket) return parts.slice(1).join('/');
      }
      return null;
    } catch {
      return null;
    }
  }

  async ensure(): Promise<void> {
    // HEAD is cheap; only CreateBucket when it's actually missing.
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch { /* fall through to create */ }
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (e) {
      // Some on-prem S3 implementations don't allow CreateBucket from app
      // credentials; it's fine — infra provisions the bucket externally.
      console.warn(`[storage/s3] ensure bucket ${this.bucket}:`, e instanceof Error ? e.message : e);
    }
  }

  async getUploadUrl(
    key: string,
    opts: UploadUrlOptions = {},
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    const expiresIn = (opts.expiresInMinutes ?? 30) * 60;
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(opts.contentType && { ContentType: opts.contentType }),
    });
    const uploadUrl = await getSignedUrl(this.client, cmd, { expiresIn });
    return { uploadUrl, publicUrl: this.publicUrl(key) };
  }

  async getDownloadUrl(
    key: string,
    opts: DownloadUrlOptions = {},
  ): Promise<string> {
    const expiresIn = (opts.expiresInMinutes ?? 60) * 60;
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(opts.downloadFilename && {
        ResponseContentDisposition: `attachment; filename="${opts.downloadFilename}"`,
      }),
    });
    return getSignedUrl(this.client, cmd, { expiresIn });
  }

  async delete(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (e) {
      console.error(`[storage/s3] delete ${key}:`, e instanceof Error ? e.message : e);
      return false;
    }
  }

  async list(prefix?: string): Promise<BlobEntry[]> {
    const entries: BlobEntry[] = [];
    let continuationToken: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of res.Contents ?? []) {
        if (!obj.Key) continue;
        entries.push({
          key: obj.Key,
          url: this.publicUrl(obj.Key),
          sizeBytes: obj.Size ?? null,
          lastModified: obj.LastModified ?? null,
        });
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
    return entries;
  }
}
