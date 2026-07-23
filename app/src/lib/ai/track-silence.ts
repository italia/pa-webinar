/**
 * Silence detection for multi-track (ADR-013) recordings.
 *
 * Background: the per-participant recorder (infra/recorder) once shipped a bug
 * where Chrome-headless subscribed to remote SFU audio tracks but MediaRecorder
 * wrote VALID BUT SILENT Opus — bytes strictly proportional to duration at the
 * ~234 B/s digital-silence floor, with no decoded samples (fixed in recorder
 * commit 9739d70, "render tracks through a playing element + virtual sink").
 * When that happened on the 2026-07-08 prod call, all 25 tracks were silent yet
 * the pipeline ran to "done" and produced empty transcripts — a failure that was
 * invisible until someone opened the (blank) subtitles.
 *
 * This helper lets the manifest endpoint detect that class of failure up front
 * and skip a doomed TRANSCRIBE_MULTITRACK instead of burning GPU on unusable
 * audio and surfacing a misleading "done".
 */

/**
 * Byte-rate (bytes/second) below which an Opus track is considered digital
 * silence. The observed floor is ~234 B/s; real speech at the recorder's
 * lowest preset (24 kbps ≈ 3000 B/s of active audio) sits far above this even
 * when a speaker talks only intermittently. 300 keeps a safe margin over the
 * floor while staying well under any track that carries real speech.
 */
export const SILENCE_FLOOR_BYTES_PER_SEC = 300;

export type TrackRateInput = {
  sizeBytes?: number | null;
  durationMs?: number | null;
};

/**
 * True when EVERY track's audio byte-rate sits at/under the silence floor —
 * i.e. the recorder captured only silence across the whole session (the
 * ADR-013 "silent capture" failure).
 *
 * Deliberately conservative so it NEVER blocks a real recording:
 *  - Gates on ALL tracks: a single quiet or non-speaking participant (whose
 *    own track is near-silent) can't trip it — at least one real speaker's
 *    track lifts the set above the floor.
 *  - Fails OPEN: if any track lacks the size/duration needed to compute a
 *    rate, we can't be certain, so we return false and let the pipeline run.
 */
export function allTracksSilent(
  tracks: readonly TrackRateInput[],
  floorBytesPerSec: number = SILENCE_FLOOR_BYTES_PER_SEC,
): boolean {
  if (tracks.length === 0) return false;
  const rates: number[] = [];
  for (const t of tracks) {
    if (t.sizeBytes == null || t.durationMs == null || t.durationMs <= 0) {
      return false; // insufficient data → fail open (never block)
    }
    rates.push(t.sizeBytes / (t.durationMs / 1000));
  }
  return rates.every((r) => r < floorBytesPerSec);
}
