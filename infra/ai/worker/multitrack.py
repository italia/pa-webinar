"""Multi-track transcript merge (ADR-013, Fase 1).

When each participant is recorded on a separate audio track (one speaker
per file), we don't need pyannote diarization: each track IS a single,
known speaker. We transcribe every track independently and MERGE the
segments into one timeline.

Two wins over blind diarization on the mixed Jibri audio:
  * exact attribution — the speaker is the real participant identity
    (from the portal JWT displayName), not an acoustic cluster;
  * natural overlaps — two people talking at once become two concurrent
    segments from two tracks, instead of one segment with one guessed
    speaker.

This module is the pure, GPU-free merge logic. The per-track ASR call
(`transcribe_track`) is a thin wrapper over the existing WhisperX path
with diarization DISABLED; it lives here only as an interface so the
merge can be unit-tested in isolation.

Output shape matches the existing `TRANSCRIPT_JSON` (segments with
start/end/text/speaker/words + speakers[diarLabel,displayName,
totalSpeechSec]) so the app/editor consume it unchanged — the only
difference is that segments MAY overlap in time.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, TypedDict


class TrackInput(TypedDict, total=False):
    participant_id: str           # stable id (endpoint id / JWT sub)
    display_name: Optional[str]   # human name from the portal JWT
    start_offset_ms: int          # when the track started, relative to t0
    segments: List[Dict[str, Any]]  # track-LOCAL times (sec from track start)


def _shift_segment(seg: Dict[str, Any], offset_sec: float, speaker: str) -> Dict[str, Any]:
    """Shift a track-local segment to the global timeline + tag speaker."""
    start = float(seg.get("start", 0.0)) + offset_sec
    end = float(seg.get("end", 0.0)) + offset_sec
    out: Dict[str, Any] = {
        "start": round(start, 3),
        "end": round(end, 3),
        "text": (seg.get("text") or "").strip(),
        "speaker": speaker,
    }
    words = seg.get("words")
    if isinstance(words, list):
        shifted = []
        for w in words:
            if not isinstance(w, dict) or "start" not in w or "end" not in w:
                continue
            shifted.append(
                {
                    "start": round(float(w["start"]) + offset_sec, 3),
                    "end": round(float(w["end"]) + offset_sec, 3),
                    "word": w.get("word", ""),
                }
            )
        if shifted:
            out["words"] = shifted
    # preserve confidence fields if present (frontend low-confidence badge)
    for k in ("avg_logprob", "no_speech_prob"):
        if k in seg:
            out[k] = seg[k]
    return out


def merge_tracks(
    tracks: List[TrackInput],
    *,
    language: Optional[str] = None,
) -> Dict[str, Any]:
    """Merge per-track transcripts into one overlap-aware transcript.

    - Each track's segments are shifted by its `start_offset_ms` onto a
      common timeline and tagged with the participant as `speaker`.
    - All segments are concatenated and sorted by (start, end). Overlaps
      are intentionally preserved (concurrent speakers).
    - `speakers[]` is built from the track identities, with
      `totalSpeechSec` = summed segment duration per participant.
    """
    all_segments: List[Dict[str, Any]] = []
    speech_by_pid: Dict[str, float] = {}
    name_by_pid: Dict[str, Optional[str]] = {}

    for tr in tracks:
        pid = tr.get("participant_id")
        if not pid:
            continue
        name_by_pid.setdefault(pid, tr.get("display_name"))
        # a later track for the same pid keeps the first non-null name
        if tr.get("display_name") and not name_by_pid.get(pid):
            name_by_pid[pid] = tr.get("display_name")
        offset = float(tr.get("start_offset_ms", 0)) / 1000.0
        for seg in tr.get("segments") or []:
            text = (seg.get("text") or "").strip()
            if not text:
                continue
            shifted = _shift_segment(seg, offset, pid)
            all_segments.append(shifted)
            speech_by_pid[pid] = speech_by_pid.get(pid, 0.0) + max(
                0.0, shifted["end"] - shifted["start"]
            )

    # Stable sort by start then end — overlaps preserved.
    all_segments.sort(key=lambda s: (s["start"], s["end"]))

    speakers = [
        {
            "diarLabel": pid,  # reuse the diarLabel slot for the real id
            "displayName": name_by_pid.get(pid),
            "totalSpeechSec": int(round(speech_by_pid.get(pid, 0.0))),
        }
        for pid in sorted(speech_by_pid, key=lambda p: -speech_by_pid[p])
    ]

    return {
        "segments": all_segments,
        "speakers": speakers,
        "language": language,
        "multitrack": True,
    }
