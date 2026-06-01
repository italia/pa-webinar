/**
 * Transcript serialisation helpers (TS side).
 *
 * Mirror of `infra/ai/worker/vtt.py` so that a transcript edited from
 * the admin editor regenerates a WebVTT artifact byte-compatible with
 * what the Python worker would have produced. Keeping the two in sync
 * matters: the player loads `TRANSCRIPT_VTT` directly, and the public
 * download endpoint derives `.srt`/`.txt` from `TRANSCRIPT_JSON`. After
 * an edit we rewrite the JSON (source of truth) and regenerate the VTT
 * from the same segments, so every downstream consumer stays coherent.
 */

import { createHash } from 'crypto';

export interface TranscriptSegmentLike {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
}

/** HH:MM:SS.mmm — matches the worker's `_format_ts`. */
function formatTs(seconds: number): string {
  const s = seconds < 0 ? 0 : seconds;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  // 06.3f → two integer digits, three decimals, zero-padded.
  const ss = secs.toFixed(3).padStart(6, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Serialise segments to a WebVTT string identical in shape to the
 * worker's `segments_to_vtt`: each cue carries a `<v Label>` voice tag
 * AND a visible `Label: ` text prefix (browsers hide `<v>` and `::cue(v)`
 * styling is inconsistent, so the redundant prefix is the only reliable
 * way to show who is speaking in the overlay).
 *
 * `speakerNames` maps diarLabel → human displayName. When a label has
 * no mapping we keep the raw diar label, exactly like the worker.
 */
export function buildVtt(
  segments: TranscriptSegmentLike[],
  speakerNames: Map<string, string> = new Map(),
): string {
  const lines: string[] = ['WEBVTT', ''];
  let i = 1;
  for (const seg of segments) {
    const text = (seg.text ?? '').trim();
    if (!text) continue;
    const start = formatTs(Number(seg.start) || 0);
    const end = formatTs(Number(seg.end) || 0);
    const speaker = seg.speaker ?? null;
    const label = speaker ? speakerNames.get(speaker) ?? speaker : null;
    lines.push(String(i));
    lines.push(`${start} --> ${end}`);
    lines.push(label ? `<v ${label}>${label}: ${text}` : text);
    lines.push('');
    i += 1;
  }
  return lines.join('\n');
}

/** sha256 hex of a UTF-8 string — matches the worker's content_hash. */
export function sha256Hex(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}
