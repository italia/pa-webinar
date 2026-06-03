import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';

import {
  signWebhookBody,
  buildWebhookPayload,
  NoopStorageProvider,
  SignedUrlStorageProvider,
  createStorageProvider,
  composeObjectUrl,
} from './upload';
import { buildManifest } from './manifest';
import { manifestKey } from './paths';

describe('signWebhookBody', () => {
  it('produce sha256=<hex> coerente con HMAC-SHA256 (come jibri-finalize.sh)', () => {
    const body = '{"a":1}';
    const secret = 'topsecret';
    const expected =
      'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    expect(signWebhookBody(body, secret)).toBe(expected);
  });
});

describe('buildWebhookPayload', () => {
  it('riassume il manifest con type=multitrack e manifestKey', () => {
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
    const payload = buildWebhookPayload(m);
    expect(payload).toEqual({
      type: 'multitrack',
      roomName: 'room-1',
      eventId: 'evt1',
      recordingId: 'rec1',
      manifestKey: manifestKey('evt1', 'rec1'),
      trackCount: 1,
      recordingStartedAtMs: 0,
    });
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
