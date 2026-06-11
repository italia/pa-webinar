import { describe, it, expect } from 'vitest';

import {
  buildManifest,
  serializeManifest,
  type TrackRecording,
} from './manifest.js';
import { trackKey } from './paths.js';

function rec(over: Partial<TrackRecording> & { participantId: string }): TrackRecording {
  return {
    // Default: trackFileId = participantId (sessione singola). I test di
    // rejoin passano trackFileId distinti per lo stesso pid.
    trackFileId: over.trackFileId ?? over.participantId,
    displayName: null,
    firstFrameAtMs: 0,
    lastFrameAtMs: 0,
    bytesWritten: 1024,
    ...over,
  };
}

describe('buildManifest', () => {
  it('calcola startOffsetMs e durationMs relativi a t0 (min firstFrame)', () => {
    const m = buildManifest({
      eventId: 'evt1',
      recordingId: 'rec1',
      roomName: 'room-1',
      recordings: [
        rec({ participantId: 'alice', firstFrameAtMs: 1_000, lastFrameAtMs: 6_000 }),
        rec({ participantId: 'bob', firstFrameAtMs: 3_500, lastFrameAtMs: 4_000 }),
      ],
    });

    expect(m.recordingStartedAtMs).toBe(1_000);
    // ordinato per startOffsetMs crescente → alice (0) prima di bob (2500)
    expect(m.tracks.map((t) => t.participantId)).toEqual(['alice', 'bob']);
    expect(m.tracks[0]).toMatchObject({
      participantId: 'alice',
      startOffsetMs: 0,
      durationMs: 5_000,
      trackKey: trackKey('evt1', 'rec1', 'alice'),
    });
    expect(m.tracks[1]).toMatchObject({
      participantId: 'bob',
      startOffsetMs: 2_500,
      durationMs: 500,
    });
  });

  it('scarta le tracce vuote (bytesWritten <= minBytes)', () => {
    const m = buildManifest({
      eventId: 'e',
      recordingId: 'r',
      roomName: 'room',
      recordings: [
        rec({ participantId: 'silent', bytesWritten: 0, firstFrameAtMs: 100, lastFrameAtMs: 100 }),
        rec({ participantId: 'talker', bytesWritten: 500, firstFrameAtMs: 200, lastFrameAtMs: 900 }),
      ],
    });
    expect(m.tracks.map((t) => t.participantId)).toEqual(['talker']);
    expect(m.recordingStartedAtMs).toBe(200); // silent non conta per t0
  });

  it('rispetta una soglia minBytes custom', () => {
    const m = buildManifest({
      eventId: 'e',
      recordingId: 'r',
      roomName: 'room',
      minBytes: 1000,
      recordings: [
        rec({ participantId: 'low', bytesWritten: 999 }),
        rec({ participantId: 'ok', bytesWritten: 1001 }),
      ],
    });
    expect(m.tracks.map((t) => t.participantId)).toEqual(['ok']);
  });

  it('preserva displayName in chiaro (lo cifra il portale all ingest)', () => {
    const m = buildManifest({
      eventId: 'e',
      recordingId: 'r',
      roomName: 'room',
      recordings: [rec({ participantId: 'p1', displayName: 'Mario Rossi' })],
    });
    expect(m.tracks[0]?.displayName).toBe('Mario Rossi');
  });

  it('non va sotto zero su durate/offset incoerenti', () => {
    const m = buildManifest({
      eventId: 'e',
      recordingId: 'r',
      roomName: 'room',
      recordings: [
        // lastFrame < firstFrame (non dovrebbe accadere): durata clampata a 0
        rec({ participantId: 'weird', firstFrameAtMs: 5_000, lastFrameAtMs: 4_000 }),
      ],
    });
    expect(m.tracks[0]?.durationMs).toBe(0);
    expect(m.tracks[0]?.startOffsetMs).toBe(0);
  });

  it('tiene entry separate per lo stesso pid (rejoin) con blob/file DISTINTI', () => {
    const m = buildManifest({
      eventId: 'e',
      recordingId: 'r',
      roomName: 'room',
      recordings: [
        rec({ participantId: 'p1', trackFileId: 'p1-0', firstFrameAtMs: 0, lastFrameAtMs: 1_000 }),
        rec({ participantId: 'p1', trackFileId: 'p1-1', firstFrameAtMs: 2_000, lastFrameAtMs: 3_000 }),
      ],
    });
    expect(m.tracks).toHaveLength(2);
    // Entrambe sono il parlante p1, ma con trackKey/blob DISTINTI: senza
    // questo la seconda sessione sovrascriveva la prima (audio perso).
    expect(m.tracks.map((t) => t.participantId)).toEqual(['p1', 'p1']);
    const keys = m.tracks.map((t) => t.trackKey);
    expect(new Set(keys).size).toBe(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('manifest vuoto quando non ci sono tracce valide', () => {
    const m = buildManifest({
      eventId: 'e',
      recordingId: 'r',
      roomName: 'room',
      recordings: [rec({ participantId: 'x', bytesWritten: 0 })],
    });
    expect(m.tracks).toEqual([]);
    expect(m.recordingStartedAtMs).toBe(0);
  });

  it('imposta version, eventId, recordingId, roomName', () => {
    const m = buildManifest({
      eventId: 'evt9',
      recordingId: 'rec9',
      roomName: 'room-9',
      recordings: [],
    });
    expect(m).toMatchObject({
      version: 1,
      eventId: 'evt9',
      recordingId: 'rec9',
      roomName: 'room-9',
    });
  });
});

describe('serializeManifest', () => {
  it('produce JSON pretty-printed valido e round-trippabile', () => {
    const m = buildManifest({
      eventId: 'e',
      recordingId: 'r',
      roomName: 'room',
      recordings: [rec({ participantId: 'p1', displayName: 'Ada', lastFrameAtMs: 100 })],
    });
    const json = serializeManifest(m);
    expect(json).toContain('\n  '); // indentato
    expect(JSON.parse(json)).toEqual(m);
  });
});
