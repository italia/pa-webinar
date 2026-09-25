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
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  CreateBucketCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import {
  IncompleteUploadError,
  type StorageProvider,
  type UploadUrlOptions,
  type DownloadUrlOptions,
  type BlobEntry,
  type BrowserUpload,
  type BrowserUploadOptions,
} from './provider';

const MIB = 1024 * 1024;
/** Parte minima del caricamento dal browser (S3 chiede almeno 5 MiB). */
const MIN_PART_SIZE = 16 * MIB;
/**
 * Tetto al numero di parti: tiene la risposta di firma contenuta e la
 * verifica finale in una sola pagina di ListParts (S3 ne ammette 10.000).
 */
const MAX_PARTS = 1000;
/** Oggetto più grande che S3 accetta. */
const MAX_OBJECT_SIZE = 5 * 1024 * 1024 * MIB;

/**
 * Dimensione delle parti per un file di `sizeBytes`. Deterministica: il
 * server la ricalcola alla chiusura invece di fidarsi del client.
 */
export function multipartPartSize(sizeBytes: number): number {
  return Math.max(MIN_PART_SIZE, Math.ceil(sizeBytes / MAX_PARTS / MIB) * MIB);
}

/** Errore dello storage con quel codice (l'SDK lo mette in `name`). */
function isNamed(e: unknown, name: string): boolean {
  return e instanceof Error && e.name === name;
}

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
      // Di default l'SDK aggiunge un checksum CRC32 a ogni richiesta che lo
      // supporta. In un URL firmato il corpo non c'è ancora: finisce nella
      // query il CRC32 del corpo vuoto (`x-amz-checksum-crc32=AAAAAA==`) e
      // qualunque PUT con dei byte viene rifiutato, anche da AWS. Sulle
      // richieste dirette, poi, il checksum viaggia in coda al corpo
      // (aws-chunked), che GCS e diversi S3 on-prem non accettano. Il
      // checksum resta dove l'API lo pretende.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
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

  async put(
    key: string,
    body: Buffer | Uint8Array,
    contentType: string,
  ): Promise<{ publicUrl: string }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { publicUrl: this.publicUrl(key) };
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

  async createBrowserUpload(
    key: string,
    opts: BrowserUploadOptions,
  ): Promise<BrowserUpload> {
    const expiresIn = (opts.expiresInMinutes ?? 30) * 60;
    if (!Number.isSafeInteger(opts.sizeBytes) || opts.sizeBytes <= 0 || opts.sizeBytes > MAX_OBJECT_SIZE) {
      throw new RangeError(`Invalid upload size: ${opts.sizeBytes}`);
    }
    const partSize = multipartPartSize(opts.sizeBytes);

    // Fino a una parte basta un PUT. Il Content-Type entra nella firma, così
    // l'oggetto non può arrivare con un tipo diverso da quello validato.
    if (opts.sizeBytes <= partSize) {
      const url = await getSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ContentType: opts.contentType,
        }),
        { expiresIn, signableHeaders: new Set(['content-type']) },
      );
      return {
        protocol: 's3-put',
        url,
        headers: { 'Content-Type': opts.contentType },
      };
    }

    // Oltre, a parti: un PUT singolo non dà avanzamento né ripresa e si ferma
    // a 5 GiB. Il Content-Type lo fissa il server all'apertura.
    const created = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: opts.contentType,
      }),
    );
    const uploadId = created.UploadId;
    if (!uploadId) throw new Error('CreateMultipartUpload returned no UploadId');

    const partCount = Math.ceil(opts.sizeBytes / partSize);
    const partUrls = await Promise.all(
      Array.from({ length: partCount }, (_, i) =>
        getSignedUrl(
          this.client,
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: i + 1,
          }),
          { expiresIn },
        ),
      ),
    );
    return { protocol: 's3-multipart', uploadId, partSize, partUrls };
  }

  async completeBrowserUpload(
    key: string,
    opts: { uploadId: string; sizeBytes: number },
  ): Promise<void> {
    try {
      await this.completeParts(key, opts);
    } catch (e) {
      // La chiusura è idempotente. Se la risposta di una chiusura riuscita
      // si perde (il proxy scade mentre lo storage ricompone un file grande,
      // la rete cade) il client ritenta, ma il caricamento a quel punto non
      // esiste più: se l'oggetto c'è con la dimensione dichiarata, è chiuso.
      if (isNamed(e, 'NoSuchUpload') && (await this.objectSize(key)) === opts.sizeBytes) {
        return;
      }
      throw e;
    }
  }

  /** Dimensione dell'oggetto, o null se non esiste. */
  private async objectSize(key: string): Promise<number | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return head.ContentLength ?? null;
    } catch (e) {
      if (isNamed(e, 'NotFound') || isNamed(e, 'NoSuchKey')) return null;
      throw e;
    }
  }

  private async completeParts(
    key: string,
    opts: { uploadId: string; sizeBytes: number },
  ): Promise<void> {
    // Gli ETag delle parti li legge il server con ListParts invece di
    // riceverli dal browser: non serve esporre `ETag` nel CORS del bucket e
    // il client non può ricomporre un oggetto con parti che non ha caricato.
    const parts: { PartNumber: number; ETag: string; Size: number }[] = [];
    let marker: string | undefined;
    do {
      const res = await this.client.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: opts.uploadId,
          ...(marker && { PartNumberMarker: marker }),
        }),
      );
      for (const p of res.Parts ?? []) {
        if (p.PartNumber === undefined || !p.ETag) continue;
        parts.push({ PartNumber: p.PartNumber, ETag: p.ETag, Size: p.Size ?? 0 });
      }
      marker = res.IsTruncated ? res.NextPartNumberMarker : undefined;
    } while (marker);

    parts.sort((a, b) => a.PartNumber - b.PartNumber);
    const expected = Math.ceil(opts.sizeBytes / multipartPartSize(opts.sizeBytes));
    const received = parts.reduce((sum, p) => sum + p.Size, 0);
    if (
      parts.length !== expected ||
      parts.some((p, i) => p.PartNumber !== i + 1) ||
      received !== opts.sizeBytes
    ) {
      throw new IncompleteUploadError(
        `Upload incomplete: ${parts.length}/${expected} parts, ${received}/${opts.sizeBytes} bytes`,
      );
    }

    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: opts.uploadId,
        MultipartUpload: {
          Parts: parts.map(({ PartNumber, ETag }) => ({ PartNumber, ETag })),
        },
      }),
    );
  }

  async abortBrowserUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
    } catch (e) {
      // Già chiuso o già annullato: il risultato che si voleva c'è. Su un
      // caricamento già chiuso l'oggetto resta com'è.
      if (isNamed(e, 'NoSuchUpload')) return;
      throw e;
    }
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
