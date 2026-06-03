import { describe, it, expect } from 'vitest';

import {
  buildIngestBody,
  notifyPortal,
  NoopStorageProvider,
  SignedUrlStorageProvider,
  PresignStorageProvider,
  createStorageProvider,
  composeObjectUrl,
} from './upload';
import { buildManifest } from './manifest';
import { trackKey } from './paths';

describe('buildIngestBody', () => {
  it('mappa il manifest sul contratto multitrack-manifest (blobKey=trackKey)', () => {
    const m = buildManifest({
      eventId: 'evt1',
      recordingId: 'rec1',
      roomName: 'room-1',
      recordings: [
        {
          participantId: 'p1',
          displayName: 'Ada',
          firstFrameAtMs: 0,
          lastFrameAtMs: 1000,
          bytesWritten: 100,
        },
      ],
    });
    const body = buildIngestBody(m, { p1: 4242 });
    expect(body).toEqual({
      eventId: 'evt1',
      recordingId: 'rec1',
      tracks: [
        {
          participantId: 'p1',
          displayName: 'Ada',
          blobKey: trackKey('evt1', 'rec1', 'p1'),
          mimeType: 'audio/ogg; codecs=opus',
          sizeBytes: 4242,
          startOffsetMs: 0,
          durationMs: 1000,
        },
      ],
    });
    // blobKey deve stare sotto il prefisso che il portale impone.
    expect(body.tracks[0]!.blobKey.startsWith('recordings/multitrack/evt1/rec1/')).toBe(
      true,
    );
  });

  it('omette sizeBytes se non noto', () => {
    const m = buildManifest({
      eventId: 'e',
      recordingId: 'r',
      roomName: 'room',
      recordings: [
        { participantId: 'p', displayName: null, firstFrameAtMs: 0, lastFrameAtMs: 5, bytesWritten: 1 },
      ],
    });
    expect(buildIngestBody(m).tracks[0]).not.toHaveProperty('sizeBytes');
  });
});

describe('notifyPortal', () => {
  it('POST a ingestUrl con header x-api-key e body JSON', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    await notifyPortal(
      { eventId: 'e', recordingId: 'r', tracks: [] },
      { ingestUrl: 'https://app/api/internal/multitrack-manifest', cronApiKey: 'k', fetchImpl: fakeFetch },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://app/api/internal/multitrack-manifest');
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('k');
    expect(calls[0]!.init?.method).toBe('POST');
  });

  it('lancia se la risposta non è ok', async () => {
    const fakeFetch = (async () =>
      new Response(null, { status: 401, statusText: 'Unauthorized' })) as unknown as typeof fetch;
    await expect(
      notifyPortal(
        { eventId: 'e', recordingId: 'r', tracks: [] },
        { ingestUrl: 'https://app/x', cronApiKey: 'k', fetchImpl: fakeFetch },
      ),
    ).rejects.toThrow(/401/);
  });
});

describe('createStorageProvider', () => {
  it('ritorna il noop per local (default)', () => {
    expect(createStorageProvider({}).name).toBe('noop');
    expect(createStorageProvider({ RECORDING_STORAGE_TYPE: 'local' }).name).toBe(
      'noop',
    );
  });

  it('ritorna il noop (con warning) per tipo cloud senza base URL firmata', () => {
    expect(
      createStorageProvider({ RECORDING_STORAGE_TYPE: 's3' }).name,
    ).toBe('noop');
  });

  it('ritorna signed-url quando il portale passa RECORDING_UPLOAD_BASE_URL', () => {
    expect(
      createStorageProvider({
        RECORDING_UPLOAD_BASE_URL:
          'https://acct.blob.core.windows.net/rec?sv=x&sig=y',
      }).name,
    ).toBe('signed-url');
  });
});

describe('composeObjectUrl', () => {
  it('inserisce la key fra path e query firmata (Azure SAS)', () => {
    expect(
      composeObjectUrl(
        'https://acct.blob.core.windows.net/container?sv=2023&sig=abc',
        'recordings/multitrack/e/r/audio/p1.opus',
      ),
    ).toBe(
      'https://acct.blob.core.windows.net/container/recordings/multitrack/e/r/audio/p1.opus?sv=2023&sig=abc',
    );
  });

  it('gestisce slash di troppo su base e key', () => {
    expect(composeObjectUrl('https://s3.example/bucket/', '/a/b.opus')).toBe(
      'https://s3.example/bucket/a/b.opus',
    );
  });

  it('funziona senza query string (URL non firmato)', () => {
    expect(composeObjectUrl('https://h/p', 'k.json')).toBe('https://h/p/k.json');
  });
});

describe('SignedUrlStorageProvider', () => {
  it('fa PUT su <base>/<key>?<firma> con x-ms-blob-type per Azure', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;

    const p = new SignedUrlStorageProvider(
      'https://acct.blob.core.windows.net/rec?sig=abc',
      fakeFetch,
    );
    await p.putObject({
      key: 'recordings/multitrack/e/r/audio/p1.opus',
      body: Buffer.from('xyz'),
      contentType: 'audio/ogg; codecs=opus',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      'https://acct.blob.core.windows.net/rec/recordings/multitrack/e/r/audio/p1.opus?sig=abc',
    );
    expect(calls[0]!.init?.method).toBe('PUT');
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers['x-ms-blob-type']).toBe('BlockBlob');
    expect(headers['Content-Type']).toBe('audio/ogg; codecs=opus');
  });

  it('NON aggiunge x-ms-blob-type per storage non-Azure (S3 presigned)', async () => {
    let seenHeaders: Record<string, string> = {};
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      seenHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const p = new SignedUrlStorageProvider(
      'https://bucket.s3.eu-west-1.amazonaws.com/rec?X-Amz-Signature=abc',
      fakeFetch,
    );
    await p.putObject({
      key: 'm.json',
      body: Buffer.from('{}'),
      contentType: 'application/json',
    });
    expect(seenHeaders['x-ms-blob-type']).toBeUndefined();
  });

  it('lancia se il PUT non è ok', async () => {
    const fakeFetch = (async () =>
      new Response(null, { status: 403, statusText: 'Forbidden' })) as unknown as typeof fetch;
    const p = new SignedUrlStorageProvider('https://h/p?sig=x', fakeFetch);
    await expect(
      p.putObject({ key: 'k', body: Buffer.from('a'), contentType: 'text/plain' }),
    ).rejects.toThrow(/403/);
  });
});

describe('PresignStorageProvider', () => {
  it('presigna per-traccia (x-api-key) poi fa PUT sull URL firmato', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.endsWith('/recorder-upload-url')) {
        return new Response(
          JSON.stringify({ uploadUrl: 'https://acct.blob.core.windows.net/c/k?sig=z' }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 201 }); // il PUT
    }) as unknown as typeof fetch;

    const p = new PresignStorageProvider({
      uploadUrlEndpoint: 'https://app/api/internal/recorder-upload-url',
      recordingId: 'rec1',
      cronApiKey: 'k',
      fetchImpl: fakeFetch,
    });
    await p.putObject({
      key: 'recordings/multitrack/e/rec1/audio/p1.opus',
      body: Buffer.from('xyz'),
      contentType: 'audio/ogg; codecs=opus',
    });

    expect(calls).toHaveLength(2);
    // 1ª chiamata: presign con x-api-key e blobKey nel body.
    const presign = calls[0]!;
    expect(presign.url).toBe('https://app/api/internal/recorder-upload-url');
    expect((presign.init?.headers as Record<string, string>)['x-api-key']).toBe('k');
    expect(String(presign.init?.body)).toContain('recordings/multitrack/e/rec1/audio/p1.opus');
    // 2ª chiamata: PUT sull URL firmato, con x-ms-blob-type (Azure).
    const put = calls[1]!;
    expect(put.url).toBe('https://acct.blob.core.windows.net/c/k?sig=z');
    expect(put.init?.method).toBe('PUT');
    expect((put.init?.headers as Record<string, string>)['x-ms-blob-type']).toBe('BlockBlob');
  });

  it('lancia se il presign fallisce', async () => {
    const fakeFetch = (async () =>
      new Response(null, { status: 403, statusText: 'Forbidden' })) as unknown as typeof fetch;
    const p = new PresignStorageProvider({
      uploadUrlEndpoint: 'https://app/x',
      recordingId: 'r',
      cronApiKey: 'k',
      fetchImpl: fakeFetch,
    });
    await expect(
      p.putObject({ key: 'k', body: Buffer.from('a'), contentType: 'text/plain' }),
    ).rejects.toThrow(/presign.*403/);
  });
});

describe('NoopStorageProvider', () => {
  it('registra le putObject senza scrivere nulla', async () => {
    const p = new NoopStorageProvider();
    await p.putObject({
      key: 'recordings/multitrack/e/r/audio/p1.opus',
      body: Buffer.from('abc'),
      contentType: 'audio/ogg; codecs=opus',
    });
    expect(p.puts).toEqual([
      {
        key: 'recordings/multitrack/e/r/audio/p1.opus',
        contentType: 'audio/ogg; codecs=opus',
        size: 3,
      },
    ]);
  });
});
