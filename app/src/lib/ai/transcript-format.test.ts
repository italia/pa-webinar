import { describe, expect, it } from 'vitest';

import { buildVtt, sha256Hex } from './transcript-format';

describe('buildVtt', () => {
  it('matches the worker segments_to_vtt format (voice tag + visible prefix)', () => {
    const vtt = buildVtt(
      [
        { start: 12.34, end: 15.12, text: 'Buongiorno a tutti', speaker: 'SPEAKER_00' },
        { start: 15.5, end: 18.0, text: 'Grazie', speaker: 'SPEAKER_01' },
      ],
      new Map([['SPEAKER_00', 'Alex']]),
    );
    expect(vtt).toBe(
      [
        'WEBVTT',
        '',
        '1',
        '00:00:12.340 --> 00:00:15.120',
        '<v Alex>Alex: Buongiorno a tutti',
        '',
        '2',
        '00:00:15.500 --> 00:00:18.000',
        // unmapped label falls back to the raw diar label
        '<v SPEAKER_01>SPEAKER_01: Grazie',
        '',
      ].join('\n'),
    );
  });

  it('emits no voice tag when a segment has no speaker', () => {
    const vtt = buildVtt([{ start: 0, end: 1, text: 'ciao', speaker: null }]);
    expect(vtt).toContain('00:00:00.000 --> 00:00:01.000\nciao');
    expect(vtt).not.toContain('<v');
  });

  it('zero-pads hours and skips empty/whitespace segments', () => {
    const vtt = buildVtt([
      { start: 3661.5, end: 3662, text: 'una ora dopo' },
      { start: 5, end: 6, text: '   ' },
    ]);
    expect(vtt).toContain('01:01:01.500 --> 01:01:02.000');
    // the blank segment is dropped, so only one cue (index 1) exists
    expect(vtt).not.toContain('\n2\n');
  });
});

describe('sha256Hex', () => {
  it('is deterministic and hex-encoded', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
