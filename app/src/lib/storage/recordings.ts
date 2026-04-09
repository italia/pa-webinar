import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} from '@azure/storage-blob';

const STORAGE_TYPE = process.env.RECORDING_STORAGE_TYPE || 'not-configured';
const AZURE_CONNECTION_STRING = process.env.RECORDING_AZURE_CONNECTION_STRING || '';
const AZURE_CONTAINER = process.env.RECORDING_AZURE_CONTAINER || 'recordings';

let _blobServiceClient: BlobServiceClient | null = null;

function getBlobServiceClient(): BlobServiceClient {
  if (!_blobServiceClient) {
    if (!AZURE_CONNECTION_STRING) {
      throw new Error('RECORDING_AZURE_CONNECTION_STRING is not configured');
    }
    _blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CONNECTION_STRING);
  }
  return _blobServiceClient;
}

/**
 * Extract the blob name from a full Azure Blob Storage URL.
 * Handles URLs like: https://<account>.blob.core.windows.net/<container>/<blob>
 */
function extractBlobName(recordingUrl: string): string | null {
  try {
    const url = new URL(recordingUrl);
    // Path: /<container>/<blob-name>
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    // Everything after the container name is the blob path
    return parts.slice(1).join('/');
  } catch {
    return null;
  }
}

/**
 * Generate a SAS URL for a recording with read-only access and expiry.
 * Returns null if storage is not azure-blob or URL cannot be parsed.
 */
export async function generateRecordingSasUrl(
  recordingUrl: string,
  expiresInMinutes: number,
): Promise<string | null> {
  if (STORAGE_TYPE !== 'azure-blob') return recordingUrl;

  const blobName = extractBlobName(recordingUrl);
  if (!blobName) return null;

  const client = getBlobServiceClient();
  const containerClient = client.getContainerClient(AZURE_CONTAINER);
  const blobClient = containerClient.getBlobClient(blobName);

  // Extract account name and key from connection string for SAS generation
  const accountName = extractFromConnectionString('AccountName');
  const accountKey = extractFromConnectionString('AccountKey');
  if (!accountName || !accountKey) return null;

  const credential = new StorageSharedKeyCredential(accountName, accountKey);
  const startsOn = new Date();
  const expiresOn = new Date(startsOn.getTime() + expiresInMinutes * 60_000);

  const sas = generateBlobSASQueryParameters(
    {
      containerName: AZURE_CONTAINER,
      blobName,
      permissions: BlobSASPermissions.parse('r'),
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
    },
    credential,
  ).toString();

  return `${blobClient.url}?${sas}`;
}

/**
 * Delete a recording blob from Azure Blob Storage.
 * Returns true if deleted, false if not found or not azure-blob storage.
 */
export async function deleteRecordingBlob(recordingUrl: string): Promise<boolean> {
  if (STORAGE_TYPE !== 'azure-blob') {
    console.warn(`[storage] Cannot delete blob: storage type is ${STORAGE_TYPE}`);
    return false;
  }

  const blobName = extractBlobName(recordingUrl);
  if (!blobName) {
    console.warn(`[storage] Cannot parse blob name from URL: ${recordingUrl}`);
    return false;
  }

  const client = getBlobServiceClient();
  const containerClient = client.getContainerClient(AZURE_CONTAINER);
  const blobClient = containerClient.getBlobClient(blobName);

  const response = await blobClient.deleteIfExists({ deleteSnapshots: 'include' });
  if (response.succeeded) {
    console.log(`[storage] Deleted blob: ${blobName}`);
  } else {
    console.warn(`[storage] Blob not found (already deleted?): ${blobName}`);
  }
  return response.succeeded;
}

function extractFromConnectionString(key: string): string | null {
  const match = AZURE_CONNECTION_STRING.match(new RegExp(`${key}=([^;]+)`));
  return match?.[1] ?? null;
}
