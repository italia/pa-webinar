import { describe, expect, it, vi } from 'vitest';

import { nelleMisure, segmentsUrl, TranscriptSink, type CaptionSegment } from './transcript.js';

const frase = (i: number): CaptionSegment => ({
  messageId: `m-${i}`,
  endpointId: 'ab',
  text: `Frase ${i}.`,
  language: 'it',
  startedAt: new Date(1000 * i).toISOString(),
  endedAt: new Date(1000 * i + 500).toISOString(),
});

describe('TranscriptSink', () => {
  it('manda le frasi a blocchi, per stanza, con la chiave', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const sink = new TranscriptSink({ url: 'http://portale/api/internal/captions/segments', token: 'k', batchSize: 2, fetchImpl });
    sink.add({ room: 'stanza', meetingId: 'm1' }, frase(1));
    sink.add({ room: 'stanza', meetingId: 'm1' }, frase(2));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://portale/api/internal/captions/segments');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
    expect(JSON.parse(init.body as string)).toEqual({ room: 'stanza', meetingId: 'm1', segments: [frase(1), frase(2)] });
    sink.stop();
  });

  it('se il portale non risponde le frasi restano e si riprovano', async () => {
    let giu = true;
    const fetchImpl = vi.fn(async () => (giu ? new Response(null, { status: 503 }) : new Response(null, { status: 204 })));
    const sink = new TranscriptSink({ url: 'http://portale/s', token: null, flushMs: 10, fetchImpl });
    sink.add({ room: 'stanza', meetingId: 'm1' }, frase(1));
    await sink.flush();
    giu = false;
    await sink.flush();
    const ultimo = fetchImpl.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(JSON.parse(ultimo[1].body as string).segments).toEqual([frase(1)]);
    sink.stop();
  });

  it('un rifiuto per dati non validi non si ripete', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 400 }));
    const sink = new TranscriptSink({ url: 'http://portale/s', token: null, fetchImpl });
    sink.add({ room: 'stanza', meetingId: 'm1' }, frase(1));
    await sink.flush();
    await sink.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    sink.stop();
  });

  it('una chiave sbagliata o una rotta che il portale non ha ancora si riprovano', async () => {
    for (const status of [401, 403, 404]) {
      let rifiuta = true;
      const fetchImpl = vi.fn(async () => (rifiuta ? new Response(null, { status }) : new Response(null, { status: 204 })));
      const sink = new TranscriptSink({ url: 'http://portale/s', token: 'k', fetchImpl });
      sink.add({ room: 'stanza', meetingId: 'm1' }, frase(1));
      await sink.flush();
      rifiuta = false;
      await sink.flush();
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const ultimo = fetchImpl.mock.calls.at(-1) as unknown as [string, RequestInit];
      expect(JSON.parse(ultimo[1].body as string).segments).toEqual([frase(1)]);
      sink.stop();
    }
  });

  it('senza indirizzo non tiene niente', async () => {
    const fetchImpl = vi.fn();
    const sink = new TranscriptSink({ url: null, token: null, fetchImpl });
    sink.add({ room: 'stanza', meetingId: 'm1' }, frase(1));
    await sink.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('nelleMisure', () => {
  it('taglia il testo lungo e toglie una lingua fuori misura', () => {
    const f = nelleMisure({ ...frase(1), text: `  ${'a'.repeat(2500)}  `, language: 'troppo-lunga' });
    expect(f?.text.length).toBe(2000);
    expect(f?.language).toBeUndefined();
  });

  it('scarta la frase vuota o con un id che il portale non accetta', () => {
    expect(nelleMisure({ ...frase(1), text: '   ' })).toBeNull();
    expect(nelleMisure({ ...frase(1), messageId: 'x'.repeat(81) })).toBeNull();
    expect(nelleMisure({ ...frase(1), endpointId: '' })).toBeNull();
    expect(nelleMisure(frase(1))).toEqual(frase(1));
  });
});

describe('segmentsUrl', () => {
  it('accanto al contesto, o quello esplicito', () => {
    expect(segmentsUrl(null, 'http://app:3000/api/internal/captions/context')).toBe(
      'http://app:3000/api/internal/captions/segments',
    );
    expect(segmentsUrl('http://altro/s', 'http://app:3000/api/internal/captions/context')).toBe('http://altro/s');
    expect(segmentsUrl(null, null)).toBeNull();
  });
});
