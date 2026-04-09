import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  type ContainerClient,
} from '@azure/storage-blob';

function getConnectionString(): string {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) {
    throw new Error(
      'AZURE_STORAGE_CONNECTION_STRING is not configured. File upload is unavailable.',
    );
  }
  return conn;
}

function getContainerName(): string {
  return process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'eventi-files';
}

function getContainerClient(): ContainerClient {
  const blobServiceClient = BlobServiceClient.fromConnectionString(
    getConnectionString(),
  );
  return blobServiceClient.getContainerClient(getContainerName());
}

function parseConnectionString(conn: string): {
  accountName: string;
  accountKey: string;
} {
  const parts = conn.split(';').reduce(
    (acc, part) => {
      const idx = part.indexOf('=');
      if (idx > 0) {
        acc[part.substring(0, idx)] = part.substring(idx + 1);
      }
      return acc;
    },
    {} as Record<string, string>,
  );

  return {
    accountName: parts['AccountName'] ?? '',
    accountKey: parts['AccountKey'] ?? '',
  };
}

export function isAzureConfigured(): boolean {
  return !!process.env.AZURE_STORAGE_CONNECTION_STRING;
}

export async function ensureContainer(): Promise<void> {
  const containerClient = getContainerClient();
  await containerClient.createIfNotExists({ access: undefined });
}

export function getBlobPath(eventId: string, fileName: string): string {
  return `events/${eventId}/files/${fileName}`;
}

export function getRecordingBlobPath(eventId: string): string {
  return `events/${eventId}/recording`;
}

export async function generateUploadSasUrl(
  blobPath: string,
  expiresInMinutes = 30,
): Promise<string> {
  const conn = getConnectionString();
  const { accountName, accountKey } = parseConnectionString(conn);
  const sharedKeyCredential = new StorageSharedKeyCredential(
    accountName,
    accountKey,
  );

  const containerName = getContainerName();
  const expiresOn = new Date();
  expiresOn.setMinutes(expiresOn.getMinutes() + expiresInMinutes);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse('cw'),
      expiresOn,
    },
    sharedKeyCredential,
  ).toString();

  const containerClient = getContainerClient();
  const blobClient = containerClient.getBlockBlobClient(blobPath);
  return `${blobClient.url}?${sasToken}`;
}

export async function generateDownloadSasUrl(
  blobPath: string,
  expiresInMinutes = 60,
): Promise<string> {
  const conn = getConnectionString();
  const { accountName, accountKey } = parseConnectionString(conn);
  const sharedKeyCredential = new StorageSharedKeyCredential(
    accountName,
    accountKey,
  );

  const containerName = getContainerName();
  const expiresOn = new Date();
  expiresOn.setMinutes(expiresOn.getMinutes() + expiresInMinutes);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse('r'),
      expiresOn,
    },
    sharedKeyCredential,
  ).toString();

  const containerClient = getContainerClient();
  const blobClient = containerClient.getBlockBlobClient(blobPath);
  return `${blobClient.url}?${sasToken}`;
}

export async function deleteBlob(blobPath: string): Promise<boolean> {
  try {
    const containerClient = getContainerClient();
    const blobClient = containerClient.getBlockBlobClient(blobPath);
    await blobClient.deleteIfExists();
    return true;
  } catch (error) {
    console.error('Failed to delete blob:', blobPath, error);
    return false;
  }
}

export async function getBlobProperties(
  blobPath: string,
): Promise<{ contentLength: number; contentType: string } | null> {
  try {
    const containerClient = getContainerClient();
    const blobClient = containerClient.getBlockBlobClient(blobPath);
    const props = await blobClient.getProperties();
    return {
      contentLength: props.contentLength ?? 0,
      contentType: props.contentType ?? 'application/octet-stream',
    };
  } catch {
    return null;
  }
}
