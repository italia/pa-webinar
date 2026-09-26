import { describe, it, expect } from 'vitest';

import { AzureStorageProvider } from './azure-provider';

// Chiave fittizia: la SAS si firma in locale, nessuna chiamata ad Azure.
const provider = new AzureStorageProvider({
  connectionString:
    'DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=ZmFrZS1rZXktZGktdGVzdA==;EndpointSuffix=core.windows.net',
  container: 'recordings',
});

describe('AzureStorageProvider.createBrowserUpload', () => {
  it('è lo stesso URL con SAS di scrittura di getUploadUrl, qualunque sia la dimensione', async () => {
    for (const sizeBytes of [1024, 4 * 1024 * 1024 * 1024]) {
      const plan = await provider.createBrowserUpload('recordings/publications/2026/x.mp4', {
        contentType: 'video/mp4',
        sizeBytes,
        expiresInMinutes: 60,
      });
      expect(plan.protocol).toBe('azure-block');
      if (plan.protocol !== 'azure-block') return;
      const url = new URL(plan.url);
      expect(`${url.origin}${url.pathname}`).toBe(
        'https://acct.blob.core.windows.net/recordings/recordings/publications/2026/x.mp4',
      );
      expect(url.searchParams.get('sp')).toBe('cw');
      expect(url.searchParams.get('spr')).toBe('https');
      const minutes =
        (Date.parse(url.searchParams.get('se') ?? '') - Date.parse(url.searchParams.get('st') ?? '')) /
        60_000;
      expect(minutes).toBe(60);
    }
  });

  it('chiudere e annullare non hanno niente da fare', async () => {
    await expect(provider.completeBrowserUpload()).resolves.toBeUndefined();
    await expect(provider.abortBrowserUpload()).resolves.toBeUndefined();
  });
});
