/**
 * @deprecated Thin shim over `@/lib/storage` preserved to avoid
 * touching a pile of call-sites in one go. New code should import
 * from `@/lib/storage` directly. The symbol names here are kept
 * for backwards compatibility with existing routes:
 *
 *   isAzureConfigured()      → replace with isFilesStorageConfigured()
 *   generateUploadSasUrl     → provider.getUploadUrl()
 *   generateDownloadSasUrl   → provider.getDownloadUrl()
 *   deleteBlob               → provider.delete()
 *   getBlobProperties        → provider.stat() (not yet in interface)
 *   ensureContainer          → provider.ensure()
 *
 * Removing this file is tracked separately — see task #25.
 */

import { getFilesStorage } from '@/lib/storage';

export function isAzureConfigured(): boolean {
  return getFilesStorage() !== null;
}

export async function ensureContainer(): Promise<void> {
  const provider = getFilesStorage();
  if (!provider) throw new Error('Files storage is not configured');
  await provider.ensure();
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
  const provider = getFilesStorage();
  if (!provider) throw new Error('Files storage is not configured');
  const { uploadUrl } = await provider.getUploadUrl(blobPath, { expiresInMinutes });
  return uploadUrl;
}

export async function generateDownloadSasUrl(
  blobPath: string,
  expiresInMinutes = 60,
): Promise<string> {
  const provider = getFilesStorage();
  if (!provider) throw new Error('Files storage is not configured');
  return provider.getDownloadUrl(blobPath, { expiresInMinutes });
}

export async function deleteBlob(blobPath: string): Promise<boolean> {
  const provider = getFilesStorage();
  if (!provider) return false;
  try {
    return await provider.delete(blobPath);
  } catch (error) {
    console.error('Failed to delete blob:', blobPath, error);
    return false;
  }
}

/**
 * No equivalent in the provider interface yet — this function is called
 * after upload to store the returned metadata. For now we keep the
 * Azure-specific implementation by accessing the provider directly.
 * TODO: add `stat(key)` to StorageProvider and remove this indirection.
 */
export async function getBlobProperties(
  blobPath: string,
): Promise<{ contentLength: number; contentType: string } | null> {
  const provider = getFilesStorage();
  if (!provider) return null;
  // List with exact prefix is portable across Azure/S3 and avoids
  // depending on a provider-specific stat() method for now.
  const list = await provider.list(blobPath);
  const hit = list.find((e) => e.key === blobPath);
  if (!hit) return null;
  return {
    contentLength: hit.sizeBytes ?? 0,
    contentType: 'application/octet-stream',
  };
}
