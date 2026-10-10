import { describe, expect, it } from 'vitest';

import { endpointFromTag, parseEvent, pong, primaryLanguage, transcriptionResult } from './mediajson.js';

describe('parseEvent', () => {
  it('legge start con endpoint e formato, anche con i numeri come stringhe', () => {
    const ev = parseEvent(
      JSON.stringify({
        event: 'start',
        sequenceNumber: '0',
        start: {
          tag: 'abcd1234-5678',
          mediaFormat: { encoding: 'opus', sampleRate: '48000', channels: '2' },
          customParameters: { endpointId: 'abcd1234' },
        },
      }),
    );
    expect(ev).toEqual({
      kind: 'start',
      tag: 'abcd1234-5678',
      endpointId: 'abcd1234',
      encoding: 'opus',
      sampleRate: 48000,
      channels: 2,
    });
  });

  it("ricava l'endpoint dal tag quando mancano i parametri", () => {
    const ev = parseEvent(JSON.stringify({ event: 'start', start: { tag: 'ff00aa11-a0', mediaFormat: {} } }));
    expect(ev).toMatchObject({ kind: 'start', endpointId: 'ff00aa11', channels: 2 });
    expect(endpointFromTag('nohex')).toBe('nohex');
  });

  it('decodifica il payload di media e il timestamp in stringa', () => {
    const ev = parseEvent(
      JSON.stringify({ event: 'media', media: { tag: 't', chunk: '3', timestamp: '960', payload: '+P/+' } }),
    );
    expect(ev?.kind).toBe('media');
    if (ev?.kind !== 'media') return;
    expect(ev.timestamp).toBe(960);
    expect([...ev.payload]).toEqual([0xf8, 0xff, 0xfe]);
  });

  it('riconosce ping e session-end, scarta il resto', () => {
    expect(parseEvent('{"event":"ping","id":7}')).toEqual({ kind: 'ping', id: 7 });
    expect(parseEvent('{"event":"session-end"}')).toEqual({ kind: 'session-end' });
    expect(parseEvent('{"event":"sources","sources":[]}')).toEqual({ kind: 'other', event: 'sources' });
    expect(parseEvent('non json')).toBeNull();
    expect(parseEvent('{"event":"media","media":{"tag":"t"}}')).toBeNull();
  });
});

describe('messaggi verso il bridge', () => {
  it('pong ripete id', () => {
    expect(JSON.parse(pong(4))).toEqual({ event: 'pong', id: 4 });
  });

  it('transcription-result porta sia event sia type, e la stabilità solo sui provvisori', () => {
    const interim = JSON.parse(
      transcriptionResult({ messageId: 'm1', endpointId: 'e1', text: 'Buongiorno', final: false, language: 'it', timestamp: 5 }),
    );
    expect(interim).toEqual({
      event: 'transcription-result',
      type: 'transcription-result',
      message_id: 'm1',
      participant: { id: 'e1' },
      is_interim: true,
      stability: 0.9,
      transcript: [{ text: 'Buongiorno' }],
      language: 'it',
      timestamp: 5,
    });
    const final = JSON.parse(
      transcriptionResult({ messageId: 'm1', endpointId: 'e1', text: 'Buongiorno.', final: true, language: 'it', timestamp: 6 }),
    );
    expect(final.is_interim).toBe(false);
    expect(final).not.toHaveProperty('stability');
  });

  it('primaryLanguage tiene il codice primario', () => {
    expect(primaryLanguage('it-IT')).toBe('it');
    expect(primaryLanguage('auto')).toBe('auto');
  });
});
