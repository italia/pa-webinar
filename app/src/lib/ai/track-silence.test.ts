import { describe, it, expect } from 'vitest';

import { allTracksSilent, SILENCE_FLOOR_BYTES_PER_SEC } from './track-silence';

// Helper: build a track with a target byte-rate (B/s) over a given duration.
function track(bytesPerSec: number, durationMs = 600_000) {
  return { sizeBytes: Math.round(bytesPerSec * (durationMs / 1000)), durationMs };
}

describe('allTracksSilent', () => {
  it('flags the July-8 failure: every track at the ~234 B/s silence floor', () => {
    // Real observed rates from the incident (all 25 tracks 231–245 B/s).
    const tracks = [233.3, 234, 232.5, 245.3, 231, 234.1].map((r) => track(r));
    expect(allTracksSilent(tracks)).toBe(true);
  });

  it('does NOT flag when at least one track carries real speech', () => {
    const tracks = [track(234), track(234), track(3200), track(234)]; // one speaker
    expect(allTracksSilent(tracks)).toBe(false);
  });

  it('does NOT flag a healthy recording where everyone spoke', () => {
    const tracks = [track(2800), track(3100), track(4200)];
    expect(allTracksSilent(tracks)).toBe(false);
  });

  it('returns false for an empty track list', () => {
    expect(allTracksSilent([])).toBe(false);
  });

  it('fails OPEN when a track is missing sizeBytes (cannot compute a rate)', () => {
    const tracks = [track(234), { durationMs: 600_000 }, track(234)];
    expect(allTracksSilent(tracks)).toBe(false);
  });

  it('fails OPEN when a track is missing/zero durationMs', () => {
    expect(allTracksSilent([track(234), { sizeBytes: 100_000, durationMs: 0 }])).toBe(false);
    expect(allTracksSilent([track(234), { sizeBytes: 100_000, durationMs: null }])).toBe(false);
  });

  it('treats a rate exactly at the floor as NOT silent (strict <)', () => {
    expect(allTracksSilent([track(SILENCE_FLOOR_BYTES_PER_SEC)])).toBe(false);
    expect(allTracksSilent([track(SILENCE_FLOOR_BYTES_PER_SEC - 1)])).toBe(true);
  });

  it('honours a custom floor', () => {
    expect(allTracksSilent([track(500), track(450)], 600)).toBe(true);
    expect(allTracksSilent([track(500), track(450)], 400)).toBe(false);
  });
});
