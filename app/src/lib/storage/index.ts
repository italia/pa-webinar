/**
 * Storage factory — builds a concrete provider from env vars.
 *
 * The platform has two storage domains that can be configured independently:
 *
 *   "files"      — event materials (PDFs, slides, images, etc.)
 *                  Env: STORAGE_FILES_* or (legacy) AZURE_STORAGE_*
 *
 *   "recordings" — Jibri MP4 outputs + manual publishings
 *                  Env: RECORDING_STORAGE_TYPE + RECORDING_{AZURE,S3}_*
 *
 * Precedence rules per domain:
 *   1. explicit STORAGE_*_PROVIDER / RECORDING_STORAGE_TYPE
 *   2. auto-detect from presence of AZURE_* or S3_* env
 *   3. null (domain disabled; callers must handle gracefully)
 *
 * Keeping two namespaces (files vs recordings) lets an operator park
 * slides on one bucket and recordings on another — useful for lifecycle
 * policies (recordings → Glacier after 90d, materials on hot tier).
 */

import { AzureStorageProvider, type AzureProviderConfig } from './azure-provider';
import { S3StorageProvider, type S3ProviderConfig } from './s3-provider';
import type { StorageProvider, StorageProviderType } from './provider';

export type { StorageProvider, StorageProviderType, BlobEntry } from './provider';
export { AzureStorageProvider } from './azure-provider';
export { S3StorageProvider } from './s3-provider';

type Domain = 'files' | 'recordings';

let _filesProvider: StorageProvider | null | undefined;
let _recordingsProvider: StorageProvider | null | undefined;

// ── Env helpers ─────────────────────────────────────────────────

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function boolEnv(name: string): boolean {
  const v = env(name)?.toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

// ── Domain → config extraction ─────────────────────────────────

function resolveProviderType(domain: Domain): StorageProviderType | null {
  if (domain === 'files') {
    const explicit = env('STORAGE_FILES_PROVIDER');
    if (explicit === 'azure' || explicit === 's3') return explicit;
    if (env('AZURE_STORAGE_CONNECTION_STRING')) return 'azure';
    if (env('STORAGE_FILES_S3_BUCKET')) return 's3';
    return null;
  }
  // recordings
  const explicit = env('RECORDING_STORAGE_TYPE');
  if (explicit === 'azure-blob' || explicit === 'azure') return 'azure';
  if (explicit === 's3' || explicit === 'minio' || explicit === 'gcs') return 's3';
  if (env('RECORDING_AZURE_CONNECTION_STRING')) return 'azure';
  if (env('RECORDING_S3_BUCKET')) return 's3';
  return null;
}

function azureConfigFor(domain: Domain): AzureProviderConfig | null {
  if (domain === 'files') {
    const connectionString = env('AZURE_STORAGE_CONNECTION_STRING');
    const container = env('AZURE_STORAGE_CONTAINER_NAME') ?? 'eventi-files';
    if (!connectionString) return null;
    return { connectionString, container };
  }
  const connectionString = env('RECORDING_AZURE_CONNECTION_STRING');
  const container = env('RECORDING_AZURE_CONTAINER') ?? 'recordings';
  if (!connectionString) return null;
  return { connectionString, container };
}

function s3ConfigFor(domain: Domain): S3ProviderConfig | null {
  const prefix = domain === 'files' ? 'STORAGE_FILES_S3' : 'RECORDING_S3';
  const bucket = env(`${prefix}_BUCKET`);
  const region = env(`${prefix}_REGION`) ?? env('AWS_REGION') ?? 'us-east-1';
  const accessKeyId = env(`${prefix}_ACCESS_KEY_ID`) ?? env('AWS_ACCESS_KEY_ID');
  const secretAccessKey = env(`${prefix}_SECRET_ACCESS_KEY`) ?? env('AWS_SECRET_ACCESS_KEY');
  const endpoint = env(`${prefix}_ENDPOINT`);
  const forcePathStyle = boolEnv(`${prefix}_FORCE_PATH_STYLE`);

  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    ...(endpoint && { endpoint }),
    forcePathStyle: forcePathStyle || !!endpoint,
  };
}

function buildProvider(domain: Domain): StorageProvider | null {
  const type = resolveProviderType(domain);
  if (!type) return null;

  if (type === 'azure') {
    const config = azureConfigFor(domain);
    if (!config) return null;
    try {
      return new AzureStorageProvider(config);
    } catch (e) {
      console.error(`[storage/${domain}] azure init:`, e instanceof Error ? e.message : e);
      return null;
    }
  }

  const config = s3ConfigFor(domain);
  if (!config) return null;
  try {
    return new S3StorageProvider(config);
  } catch (e) {
    console.error(`[storage/${domain}] s3 init:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Lazy singleton. Returns null when the "files" domain is not
 * configured — callers should surface a clear message to the operator.
 */
export function getFilesStorage(): StorageProvider | null {
  if (_filesProvider === undefined) _filesProvider = buildProvider('files');
  return _filesProvider;
}

/**
 * Lazy singleton. Returns null when the "recordings" domain is not
 * configured. The reconciliation cron uses this to skip no-op runs.
 */
export function getRecordingsStorage(): StorageProvider | null {
  if (_recordingsProvider === undefined) _recordingsProvider = buildProvider('recordings');
  return _recordingsProvider;
}

/** Human label of the recordings provider, useful for admin/status UI. */
export function recordingsProviderLabel(): string {
  const p = getRecordingsStorage();
  if (!p) return 'not-configured';
  return p.type === 'azure' ? 'azure-blob' : 's3';
}
