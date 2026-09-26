import {
  S3Client,
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  ListPartsCommand,
} from '@aws-sdk/client-s3';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { IncompleteUploadError } from './provider';
import { S3StorageProvider, multipartPartSize } from './s3-provider';

// Le firme si calcolano davvero (sono HMAC locali, nessuna rete); si
// intercettano solo le chiamate allo storage.
const MIB = 1024 * 1024;

function provider(endpoint?: string) {
  return new S3StorageProvider({
    region: 'eu-south-1',
    bucket: 'recordings-bucket',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'secret-di-test',
    ...(endpoint && { endpoint }),
  });
}

function query(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

/** Nessun checksum pre-calcolato su un corpo che il firmatario non ha visto. */
function expectNoChecksum(url: string) {
  const keys = [...query(url).keys()].map((k) => k.toLowerCase());
  expect(keys.filter((k) => k.startsWith('x-amz-checksum') || k === 'x-amz-sdk-checksum-algorithm')).toEqual([]);
}

let send: Mock;

beforeEach(() => {
  send = vi.spyOn(S3Client.prototype, 'send') as unknown as Mock;
});
afterEach(() => {
  send.mockRestore();
});

describe('multipartPartSize', () => {
  it('parte da 16 MiB e resta sotto le 1000 parti', () => {
    expect(multipartPartSize(1)).toBe(16 * MIB);
    expect(multipartPartSize(5 * 1024 * MIB)).toBe(16 * MIB);
    const big = 100 * 1024 * MIB;
    const part = multipartPartSize(big);
    expect(part % MIB).toBe(0);
    expect(Math.ceil(big / part)).toBeLessThanOrEqual(1000);
  });
});

describe('getUploadUrl', () => {
  it.each([undefined, 'http://minio.local:9000'])(
    'un URL firmato non porta il CRC32 del corpo vuoto (endpoint %s)',
    async (endpoint) => {
      const { uploadUrl } = await provider(endpoint).getUploadUrl('recordings/a.mp4', {
        contentType: 'video/mp4',
      });
      expectNoChecksum(uploadUrl);
    },
  );
});

describe('createBrowserUpload', () => {
  it('fino a una parte: un PUT con il Content-Type dentro la firma', async () => {
    const plan = await provider('http://minio.local:9000').createBrowserUpload(
      'recordings/publications/2026/x.webm',
      { contentType: 'video/webm', sizeBytes: 3 * MIB },
    );
    expect(plan.protocol).toBe('s3-put');
    if (plan.protocol !== 's3-put') return;
    expect(plan.headers).toEqual({ 'Content-Type': 'video/webm' });
    expect(new URL(plan.url).pathname).toBe('/recordings-bucket/recordings/publications/2026/x.webm');
    expect(query(plan.url).get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expectNoChecksum(plan.url);
    expect(send).not.toHaveBeenCalled();
  });

  it('oltre una parte: apre il caricamento a parti e firma ogni parte', async () => {
    send.mockResolvedValueOnce({ UploadId: 'up-123' } as never);
    const size = 40 * MIB;
    const plan = await provider().createBrowserUpload('recordings/publications/2026/x.mp4', {
      contentType: 'video/mp4',
      sizeBytes: size,
      expiresInMinutes: 60,
    });

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0]?.[0];
    expect(cmd).toBeInstanceOf(CreateMultipartUploadCommand);
    expect((cmd as CreateMultipartUploadCommand).input).toEqual({
      Bucket: 'recordings-bucket',
      Key: 'recordings/publications/2026/x.mp4',
      ContentType: 'video/mp4',
    });

    expect(plan.protocol).toBe('s3-multipart');
    if (plan.protocol !== 's3-multipart') return;
    expect(plan.uploadId).toBe('up-123');
    expect(plan.partSize).toBe(16 * MIB);
    expect(plan.partUrls).toHaveLength(3);
    plan.partUrls.forEach((url, i) => {
      const q = query(url);
      expect(q.get('partNumber')).toBe(String(i + 1));
      expect(q.get('uploadId')).toBe('up-123');
      expect(q.get('X-Amz-Expires')).toBe('3600');
      expect(q.get('X-Amz-SignedHeaders')).toBe('host');
      expectNoChecksum(url);
    });
  });

  it('senza UploadId non restituisce un piano a metà', async () => {
    send.mockResolvedValueOnce({} as never);
    await expect(
      provider().createBrowserUpload('k', { contentType: 'video/mp4', sizeBytes: 40 * MIB }),
    ).rejects.toThrow(/UploadId/);
  });

  it.each([0, -1, 1.5, Number.NaN])('rifiuta la dimensione %s', async (sizeBytes) => {
    await expect(
      provider().createBrowserUpload('k', { contentType: 'video/mp4', sizeBytes }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('completeBrowserUpload', () => {
  const key = 'recordings/publications/2026/x.mp4';
  const size = 40 * MIB; // tre parti: 16 + 16 + 8 MiB

  it('ricompone le parti lette dallo storage, in ordine, anche su più pagine', async () => {
    send
      .mockResolvedValueOnce({
        Parts: [
          { PartNumber: 2, ETag: '"e2"', Size: 16 * MIB },
          { PartNumber: 1, ETag: '"e1"', Size: 16 * MIB },
        ],
        IsTruncated: true,
        NextPartNumberMarker: '2',
      } as never)
      .mockResolvedValueOnce({
        Parts: [{ PartNumber: 3, ETag: '"e3"', Size: 8 * MIB }],
        IsTruncated: false,
      } as never)
      .mockResolvedValueOnce({} as never);

    await provider().completeBrowserUpload(key, { uploadId: 'up-1', sizeBytes: size });

    const [first, second, complete] = send.mock.calls.map((c) => c[0]);
    expect(first).toBeInstanceOf(ListPartsCommand);
    expect((second as ListPartsCommand).input.PartNumberMarker).toBe('2');
    expect(complete).toBeInstanceOf(CompleteMultipartUploadCommand);
    expect((complete as CompleteMultipartUploadCommand).input).toEqual({
      Bucket: 'recordings-bucket',
      Key: key,
      UploadId: 'up-1',
      MultipartUpload: {
        Parts: [
          { PartNumber: 1, ETag: '"e1"' },
          { PartNumber: 2, ETag: '"e2"' },
          { PartNumber: 3, ETag: '"e3"' },
        ],
      },
    });
  });

  it.each([
    ['manca una parte', [
      { PartNumber: 1, ETag: '"e1"', Size: 16 * MIB },
      { PartNumber: 3, ETag: '"e3"', Size: 8 * MIB },
    ]],
    ['la dimensione non torna', [
      { PartNumber: 1, ETag: '"e1"', Size: 16 * MIB },
      { PartNumber: 2, ETag: '"e2"', Size: 16 * MIB },
      { PartNumber: 3, ETag: '"e3"', Size: 1 * MIB },
    ]],
  ])('se %s non ricompone niente', async (_label, parts) => {
    send.mockResolvedValueOnce({ Parts: parts, IsTruncated: false } as never);
    await expect(
      provider().completeBrowserUpload(key, { uploadId: 'up-1', sizeBytes: size }),
    ).rejects.toBeInstanceOf(IncompleteUploadError);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('completeBrowserUpload ripetuta', () => {
  const key = 'recordings/publications/2026/x.mp4';
  const size = 40 * MIB;
  const named = (name: string) => Object.assign(new Error(name), { name });
  const allParts = {
    Parts: [
      { PartNumber: 1, ETag: '"e1"', Size: 16 * MIB },
      { PartNumber: 2, ETag: '"e2"', Size: 16 * MIB },
      { PartNumber: 3, ETag: '"e3"', Size: 8 * MIB },
    ],
    IsTruncated: false,
  };

  it('già chiusa: l’oggetto c’è con la dimensione dichiarata, quindi riesce', async () => {
    send
      .mockRejectedValueOnce(named('NoSuchUpload'))
      .mockResolvedValueOnce({ ContentLength: size } as never);
    await expect(
      provider().completeBrowserUpload(key, { uploadId: 'up-1', sizeBytes: size }),
    ).resolves.toBeUndefined();
    const head = send.mock.calls[1]?.[0];
    expect(head).toBeInstanceOf(HeadObjectCommand);
    expect((head as HeadObjectCommand).input).toEqual({ Bucket: 'recordings-bucket', Key: key });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('chiusa da una richiesta concorrente mentre questa ricomponeva: riesce', async () => {
    send
      .mockResolvedValueOnce(allParts as never)
      .mockRejectedValueOnce(named('NoSuchUpload'))
      .mockResolvedValueOnce({ ContentLength: size } as never);
    await expect(
      provider().completeBrowserUpload(key, { uploadId: 'up-1', sizeBytes: size }),
    ).resolves.toBeUndefined();
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(CompleteMultipartUploadCommand);
  });

  it.each([
    ['l’oggetto non c’è (caricamento annullato)', () => send.mockRejectedValueOnce(named('NotFound'))],
    ['l’oggetto ha un’altra dimensione', () => send.mockResolvedValueOnce({ ContentLength: size - 1 } as never)],
  ])('non la dà per chiusa se %s', async (_label, head) => {
    send.mockRejectedValueOnce(named('NoSuchUpload'));
    head();
    await expect(
      provider().completeBrowserUpload(key, { uploadId: 'up-1', sizeBytes: size }),
    ).rejects.toMatchObject({ name: 'NoSuchUpload' });
  });

  it('un errore del controllo risale al posto di NoSuchUpload', async () => {
    send.mockRejectedValueOnce(named('NoSuchUpload')).mockRejectedValueOnce(named('AccessDenied'));
    await expect(
      provider().completeBrowserUpload(key, { uploadId: 'up-1', sizeBytes: size }),
    ).rejects.toMatchObject({ name: 'AccessDenied' });
  });

  it('gli altri errori della chiusura non controllano l’oggetto', async () => {
    send.mockRejectedValueOnce(named('AccessDenied'));
    await expect(
      provider().completeBrowserUpload(key, { uploadId: 'up-1', sizeBytes: size }),
    ).rejects.toMatchObject({ name: 'AccessDenied' });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('abortBrowserUpload', () => {
  it('annulla il caricamento', async () => {
    send.mockResolvedValueOnce({} as never);
    await provider().abortBrowserUpload('k', 'up-1');
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(AbortMultipartUploadCommand);
  });

  it('un caricamento già chiuso o annullato non è un errore', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'NoSuchUpload' }));
    await expect(provider().abortBrowserUpload('k', 'up-1')).resolves.toBeUndefined();
  });

  it('gli altri errori risalgono', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'AccessDenied' }));
    await expect(provider().abortBrowserUpload('k', 'up-1')).rejects.toThrow('denied');
  });
});
