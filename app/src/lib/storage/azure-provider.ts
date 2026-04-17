/**
 * Azure Blob Storage adapter for the StorageProvider interface.
 *
 * Uses @azure/storage-blob. SAS tokens are signed with the account key
 * extracted from the connection string — managed identity is not yet
 * supported (deferred until there's a concrete tenant that needs it).
 */

import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} from '@azure/storage-blob';

import type {
  StorageProvider,
  UploadUrlOptions,
  DownloadUrlOptions,
  BlobEntry,
} from './provider';

export interface AzureProviderConfig {
  connectionString: string;
  container: string;
}

function parseKeyPair(connectionString: string): {
  accountName: string;
  accountKey: string;
} {
  const parts = connectionString.split(';').reduce(
    (acc, part) => {
      const idx = part.indexOf('=');
      if (idx > 0) acc[part.substring(0, idx)] = part.substring(idx + 1);
      return acc;
    },
    {} as Record<string, string>,
  );
  return {
    accountName: parts['AccountName'] ?? '',
    accountKey: parts['AccountKey'] ?? '',
  };
}

export class AzureStorageProvider implements StorageProvider {
  readonly type = 'azure' as const;
  readonly bucket: string;
  private client: BlobServiceClient;
  private credential: StorageSharedKeyCredential;
  private accountName: string;

  constructor(config: AzureProviderConfig) {
    const { accountName, accountKey } = parseKeyPair(config.connectionString);
    if (!accountName || !accountKey) {
      throw new Error('Azure connection string missing AccountName or AccountKey');
    }
    this.accountName = accountName;
    this.bucket = config.container;
    this.credential = new StorageSharedKeyCredential(accountName, accountKey);
    this.client = BlobServiceClient.fromConnectionString(config.connectionString);
  }

  publicUrl(key: string): string {
    return `https://${this.accountName}.blob.core.windows.net/${this.bucket}/${key}`;
  }

  keyFromUrl(url: string): string | null {
    try {
      const u = new URL(url);
      // Expected host: <account>.blob.core.windows.net
      if (!u.hostname.endsWith('.blob.core.windows.net')) return null;
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length < 2) return null;
      // parts[0] = container, rest = key
      if (parts[0] !== this.bucket) return null;
      return parts.slice(1).join('/');
    } catch {
      return null;
    }
  }

  async ensure(): Promise<void> {
    const containerClient = this.client.getContainerClient(this.bucket);
    await containerClient.createIfNotExists({ access: undefined });
  }

  async getUploadUrl(
    key: string,
    opts: UploadUrlOptions = {},
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    const expiresInMinutes = opts.expiresInMinutes ?? 30;
    const startsOn = new Date();
    const expiresOn = new Date(startsOn.getTime() + expiresInMinutes * 60_000);

    // 'cw' — create + write. Required for first-time PutBlob under SAS v2+.
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.bucket,
        blobName: key,
        permissions: BlobSASPermissions.parse('cw'),
        startsOn,
        expiresOn,
        protocol: SASProtocol.Https,
      },
      this.credential,
    ).toString();

    const publicUrl = this.publicUrl(key);
    return { uploadUrl: `${publicUrl}?${sas}`, publicUrl };
  }

  async getDownloadUrl(
    key: string,
    opts: DownloadUrlOptions = {},
  ): Promise<string> {
    const expiresInMinutes = opts.expiresInMinutes ?? 60;
    const startsOn = new Date();
    const expiresOn = new Date(startsOn.getTime() + expiresInMinutes * 60_000);

    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.bucket,
        blobName: key,
        permissions: BlobSASPermissions.parse('r'),
        startsOn,
        expiresOn,
        protocol: SASProtocol.Https,
        ...(opts.downloadFilename && {
          contentDisposition: `attachment; filename="${opts.downloadFilename}"`,
        }),
      },
      this.credential,
    ).toString();

    return `${this.publicUrl(key)}?${sas}`;
  }

  async delete(key: string): Promise<boolean> {
    const blobClient = this.client
      .getContainerClient(this.bucket)
      .getBlockBlobClient(key);
    const res = await blobClient.deleteIfExists({ deleteSnapshots: 'include' });
    return res.succeeded;
  }

  async list(prefix?: string): Promise<BlobEntry[]> {
    const containerClient = this.client.getContainerClient(this.bucket);
    const entries: BlobEntry[] = [];
    for await (const item of containerClient.listBlobsFlat({ prefix })) {
      entries.push({
        key: item.name,
        url: this.publicUrl(item.name),
        sizeBytes: item.properties.contentLength ?? null,
        lastModified: item.properties.lastModified ?? null,
      });
    }
    return entries;
  }
}
