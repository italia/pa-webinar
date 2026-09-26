/**
 * Quale fornitore serve ciascun dominio di storage, letto dalle variabili
 * d'ambiente. Modulo senza dipendenze: lo usano sia la factory
 * (`index.ts`) sia il middleware, che gira nel runtime edge e non deve
 * caricare gli SDK dei fornitori. Tenere la regola in un posto solo evita
 * che la CSP ammetta un host diverso da quello a cui l'app firma gli URL.
 *
 * Precedenza per dominio:
 *   1. esplicito: STORAGE_FILES_PROVIDER / RECORDING_STORAGE_TYPE
 *   2. dedotto dalla presenza delle credenziali AZURE_* o del bucket S3
 *   3. null: dominio non configurato
 */

import type { StorageProviderType } from './provider';

export type StorageDomain = 'files' | 'recordings';

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | undefined {
  const v = env[name];
  return v && v.length > 0 ? v : undefined;
}

/** Valori accettati da RECORDING_STORAGE_TYPE, per fornitore. */
const RECORDING_TYPE_ALIASES = new Map<string, StorageProviderType>([
  ['azure-blob', 'azure'],
  ['azure', 'azure'],
  ['s3', 's3'],
  ['minio', 's3'],
  ['gcs', 's3'],
]);

export function resolveProviderType(
  domain: StorageDomain,
  env: Env = process.env,
): StorageProviderType | null {
  if (domain === 'files') {
    const explicit = read(env, 'STORAGE_FILES_PROVIDER');
    if (explicit === 'azure' || explicit === 's3') return explicit;
    if (read(env, 'AZURE_STORAGE_CONNECTION_STRING')) return 'azure';
    if (read(env, 'STORAGE_FILES_S3_BUCKET')) return 's3';
    return null;
  }
  const explicit = RECORDING_TYPE_ALIASES.get(read(env, 'RECORDING_STORAGE_TYPE') ?? '');
  if (explicit) return explicit;
  if (read(env, 'RECORDING_AZURE_CONNECTION_STRING')) return 'azure';
  if (read(env, 'RECORDING_S3_BUCKET')) return 's3';
  return null;
}

const DOMAIN_ENV: Record<
  StorageDomain,
  { azureConnectionString: string; s3Endpoint: string }
> = {
  files: {
    azureConnectionString: 'AZURE_STORAGE_CONNECTION_STRING',
    s3Endpoint: 'STORAGE_FILES_S3_ENDPOINT',
  },
  recordings: {
    azureConnectionString: 'RECORDING_AZURE_CONNECTION_STRING',
    s3Endpoint: 'RECORDING_S3_ENDPOINT',
  },
};

/**
 * Origini a cui il browser si collega per un dominio: quelle degli URL che
 * il provider firma. Azure: l'account del connection string. S3: l'origine
 * dell'endpoint (sempre path-style quando c'è), altrimenti AWS.
 */
function domainHosts(domain: StorageDomain, env: Env): string[] {
  const type = resolveProviderType(domain, env);
  if (!type) return [];
  const names = DOMAIN_ENV[domain];

  if (type === 'azure') {
    const account = read(env, names.azureConnectionString)?.match(
      /(?:^|;)\s*AccountName=([^;]+)/,
    )?.[1];
    return account ? [`https://${account}.blob.core.windows.net`] : [];
  }

  const hosts: string[] = [];
  const endpoint = read(env, names.s3Endpoint);
  if (endpoint) {
    try {
      hosts.push(new URL(endpoint).origin);
    } catch {
      /* endpoint non valido: il provider non partirebbe comunque */
    }
  } else {
    hosts.push('https://*.amazonaws.com');
  }
  if (domain === 'recordings' && read(env, 'RECORDING_STORAGE_TYPE') === 'gcs') {
    hosts.push('https://storage.googleapis.com');
  }
  return hosts;
}

/**
 * Host dello storage da ammettere nella CSP.
 *   - `media`: le registrazioni, che il player riproduce da URL firmati;
 *     più RECORDING_MEDIA_CSP_HOSTS (separati da spazi) per chi serve lo
 *     storage da un dominio proprio o da una CDN.
 *   - `connect`: `media` più lo storage dei materiali, perché i caricamenti
 *     dal browser (registrazioni e materiali) vanno diretti allo storage.
 */
export function storageCspHosts(env: Env = process.env): {
  media: string[];
  connect: string[];
} {
  const media = new Set(domainHosts('recordings', env));
  const extra = read(env, 'RECORDING_MEDIA_CSP_HOSTS');
  if (extra) for (const h of extra.split(/\s+/).filter(Boolean)) media.add(h);

  const connect = new Set(media);
  for (const h of domainHosts('files', env)) connect.add(h);

  return { media: [...media], connect: [...connect] };
}
