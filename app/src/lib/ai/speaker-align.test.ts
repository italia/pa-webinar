import { describe, expect, it } from 'vitest';

import {
  alignDiarizationToSpeakers,
  type DiarizationSegment,
  type SpeakerLogEntry,
} from './speaker-align';

describe('alignDiarizationToSpeakers', () => {
  it('match base: ogni cluster prende il dominant speaker prevalente nei suoi segmenti', () => {
    // Timeline: Alice domina 0-10s, Bob domina 10-20s (poi resta dominante).
    const log: SpeakerLogEntry[] = [
      { atMs: 0, participantId: 'p-alice', displayName: 'Alice' },
      { atMs: 10_000, participantId: 'p-bob', displayName: 'Bob' },
    ];
    // pyannote: SPEAKER_00 nella finestra di Alice, SPEAKER_01 in quella di Bob.
    const segments: DiarizationSegment[] = [
      { start: 0, end: 5, speaker: 'SPEAKER_00' },
      { start: 5, end: 9, speaker: 'SPEAKER_00' },
      { start: 11, end: 18, speaker: 'SPEAKER_01' },
    ];

    const map = alignDiarizationToSpeakers(segments, log);

    expect(map.get('SPEAKER_00')).toBe('Alice');
    expect(map.get('SPEAKER_01')).toBe('Bob');
    expect(map.size).toBe(2);
  });

  it('log vuoto: ritorna mappa vuota', () => {
    const segments: DiarizationSegment[] = [
      { start: 0, end: 5, speaker: 'SPEAKER_00' },
    ];
    const map = alignDiarizationToSpeakers(segments, []);
    expect(map.size).toBe(0);
  });

  it('cluster senza dominante chiaro (nessun overlap): viene omesso', () => {
    // Il dominant speaker entra solo dopo i 100s; il segmento del cluster
    // sta tutto prima → nessun overlap → cluster non attribuito.
    const log: SpeakerLogEntry[] = [
      { atMs: 100_000, participantId: 'p-alice', displayName: 'Alice' },
    ];
    const segments: DiarizationSegment[] = [
      { start: 0, end: 5, speaker: 'SPEAKER_00' },
    ];

    const map = alignDiarizationToSpeakers(segments, log);
    expect(map.has('SPEAKER_00')).toBe(false);
    expect(map.size).toBe(0);
  });

  it('vince il partecipante con piu overlap quando piu dominanti toccano lo stesso cluster', () => {
    // Bob domina 0-2s, Alice 2-12s. SPEAKER_00 copre 0-10s:
    // overlap Bob = 2s, overlap Alice = 8s → Alice vince.
    const log: SpeakerLogEntry[] = [
      { atMs: 0, participantId: 'p-bob', displayName: 'Bob' },
      { atMs: 2_000, participantId: 'p-alice', displayName: 'Alice' },
    ];
    const segments: DiarizationSegment[] = [
      { start: 0, end: 10, speaker: 'SPEAKER_00' },
    ];

    const map = alignDiarizationToSpeakers(segments, log);
    expect(map.get('SPEAKER_00')).toBe('Alice');
  });

  it('partecipante dominante senza displayName non produce etichetta', () => {
    const log: SpeakerLogEntry[] = [
      { atMs: 0, participantId: 'p-ghost' }, // nessun displayName noto
    ];
    const segments: DiarizationSegment[] = [
      { start: 0, end: 5, speaker: 'SPEAKER_00' },
    ];

    const map = alignDiarizationToSpeakers(segments, log);
    expect(map.size).toBe(0);
  });
});
