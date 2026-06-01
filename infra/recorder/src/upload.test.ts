import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';

import {
  signWebhookBody,
  buildWebhookPayload,
  NoopStorageProvider,
  createStorageProvider,
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

  it('ritorna il noop (con warning) per provider non ancora implementati', () => {
    expect(
      createStorageProvider({ RECORDING_STORAGE_TYPE: 's3' }).name,
    ).toBe('noop');
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
