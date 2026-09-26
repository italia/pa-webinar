import { describe, it, expect } from 'vitest';

import { resolveProviderType, storageCspHosts } from './provider-type';

// Connection string di forma Azure con chiave fittizia.
const azureConn = (account: string) =>
  `DefaultEndpointsProtocol=https;AccountName=${account};AccountKey=ZmFrZQ==;EndpointSuffix=core.windows.net`;

describe('resolveProviderType', () => {
  it.each([
    ['azure-blob', 'azure'],
    ['azure', 'azure'],
    ['s3', 's3'],
    ['minio', 's3'],
    ['gcs', 's3'],
  ] as const)('RECORDING_STORAGE_TYPE=%s → %s', (value, expected) => {
    expect(resolveProviderType('recordings', { RECORDING_STORAGE_TYPE: value })).toBe(expected);
  });

  it('senza tipo esplicito deduce il fornitore dalle credenziali', () => {
    expect(
      resolveProviderType('recordings', { RECORDING_AZURE_CONNECTION_STRING: azureConn('acct') }),
    ).toBe('azure');
    expect(resolveProviderType('recordings', { RECORDING_S3_BUCKET: 'rec' })).toBe('s3');
    expect(resolveProviderType('recordings', {})).toBeNull();
  });

  it('un tipo sconosciuto non vale come alias: si ricade sulla deduzione', () => {
    expect(
      resolveProviderType('recordings', { RECORDING_STORAGE_TYPE: 'local', RECORDING_S3_BUCKET: 'rec' }),
    ).toBe('s3');
    expect(resolveProviderType('recordings', { RECORDING_STORAGE_TYPE: 'constructor' })).toBeNull();
  });

  it('dominio materiali: STORAGE_FILES_PROVIDER, poi credenziali', () => {
    expect(resolveProviderType('files', { STORAGE_FILES_PROVIDER: 's3' })).toBe('s3');
    expect(resolveProviderType('files', { AZURE_STORAGE_CONNECTION_STRING: azureConn('a') })).toBe('azure');
    expect(resolveProviderType('files', { STORAGE_FILES_S3_BUCKET: 'files' })).toBe('s3');
    expect(resolveProviderType('files', {})).toBeNull();
  });
});

describe('storageCspHosts', () => {
  it('Azure con lo stesso account per registrazioni e materiali: un solo host', () => {
    const hosts = storageCspHosts({
      RECORDING_STORAGE_TYPE: 'azure-blob',
      RECORDING_AZURE_CONNECTION_STRING: azureConn('acct'),
      AZURE_STORAGE_CONNECTION_STRING: azureConn('acct'),
    });
    expect(hosts).toEqual({
      media: ['https://acct.blob.core.windows.net'],
      connect: ['https://acct.blob.core.windows.net'],
    });
  });

  it("l'alias `azure` vale come `azure-blob`", () => {
    const hosts = storageCspHosts({
      RECORDING_STORAGE_TYPE: 'azure',
      RECORDING_AZURE_CONNECTION_STRING: azureConn('acct'),
    });
    expect(hosts.media).toEqual(['https://acct.blob.core.windows.net']);
  });

  it.each(['s3', 'minio', 'gcs'])('%s con endpoint: la sua origine', (type) => {
    const hosts = storageCspHosts({
      RECORDING_STORAGE_TYPE: type,
      RECORDING_S3_ENDPOINT: 'https://objects.example.org:9000/some/path',
    });
    expect(hosts.media).toContain('https://objects.example.org:9000');
    expect(hosts.media).not.toContain('https://*.amazonaws.com');
  });

  it('S3 senza endpoint è AWS', () => {
    expect(storageCspHosts({ RECORDING_STORAGE_TYPE: 's3' }).media).toEqual([
      'https://*.amazonaws.com',
    ]);
  });

  it('gcs resta ammesso anche su storage.googleapis.com', () => {
    const hosts = storageCspHosts({
      RECORDING_STORAGE_TYPE: 'gcs',
      RECORDING_S3_ENDPOINT: 'https://storage.googleapis.com',
    });
    expect(hosts.media).toEqual(['https://storage.googleapis.com']);
  });

  it('senza tipo esplicito segue la stessa deduzione della factory', () => {
    const hosts = storageCspHosts({
      RECORDING_AZURE_CONNECTION_STRING: azureConn('acct'),
    });
    expect(hosts.media).toEqual(['https://acct.blob.core.windows.net']);
  });

  it('lo storage dei materiali entra solo in connect-src', () => {
    const hosts = storageCspHosts({
      RECORDING_STORAGE_TYPE: 'minio',
      RECORDING_S3_ENDPOINT: 'http://minio.local:9000',
      STORAGE_FILES_PROVIDER: 's3',
      STORAGE_FILES_S3_BUCKET: 'files',
      STORAGE_FILES_S3_ENDPOINT: 'https://files.example.org',
    });
    expect(hosts.media).toEqual(['http://minio.local:9000']);
    expect(hosts.connect).toEqual(['http://minio.local:9000', 'https://files.example.org']);
  });

  it('RECORDING_MEDIA_CSP_HOSTS aggiunge host a entrambe le direttive', () => {
    const hosts = storageCspHosts({
      RECORDING_STORAGE_TYPE: 's3',
      RECORDING_S3_ENDPOINT: 'https://s3.example.org',
      RECORDING_MEDIA_CSP_HOSTS: ' https://cdn.example.org  https://cdn2.example.org ',
    });
    expect(hosts.media).toEqual([
      'https://s3.example.org',
      'https://cdn.example.org',
      'https://cdn2.example.org',
    ]);
    expect(hosts.connect).toEqual(hosts.media);
  });

  it('un endpoint non valido non rompe la CSP', () => {
    expect(
      storageCspHosts({ RECORDING_STORAGE_TYPE: 's3', RECORDING_S3_ENDPOINT: 'not a url' }).media,
    ).toEqual([]);
  });

  it('nessuno storage configurato: nessun host', () => {
    expect(storageCspHosts({})).toEqual({ media: [], connect: [] });
  });
});
