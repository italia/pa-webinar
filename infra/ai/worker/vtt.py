"""WebVTT and text-format helpers.

Pure stdlib — no webvtt-py dependency for the *writer* because the
output format is constrained enough (cue blocks with HH:MM:SS.mmm
timestamps) that hand-writing is more reliable than building objects.

A "segment" matches WhisperX's output shape after diarization:

    {
        "start": 12.34,                  # seconds
        "end":   15.12,
        "text":  "Lorem ipsum dolor",
        "speaker": "SPEAKER_00",         # optional
    }
"""

from __future__ import annotations

from typing import Iterable, List, Optional, TypedDict


class Segment(TypedDict, total=False):
    start: float
    end: float
    text: str
    speaker: Optional[str]


def _format_ts(seconds: float) -> str:
    if seconds < 0:
        seconds = 0.0
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:06.3f}"


def segments_to_vtt(segments: Iterable[Segment], *, include_speaker: bool = True) -> str:
    """Serialise segments to a WebVTT string.

    Cue identifiers are 1-based positional integers. Speaker labels are
    emitted as a Voice tag ``<v Speaker_00>`` so HTML5 ``<track>`` can
    style them via ::cue(v[voice="SPEAKER_00"]).
    """
    lines: List[str] = ["WEBVTT", ""]
    for i, seg in enumerate(segments, start=1):
        start = _format_ts(float(seg.get("start", 0.0)))
        end = _format_ts(float(seg.get("end", 0.0)))
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        speaker = seg.get("speaker") if include_speaker else None
        lines.append(str(i))
        lines.append(f"{start} --> {end}")
        if speaker:
            lines.append(f"<v {speaker}>{text}")
        else:
            lines.append(text)
        lines.append("")
    return "\n".join(lines)


def segments_to_plain_text(segments: Iterable[Segment]) -> str:
    """Render segments as plain text with speaker prefixes.

    Used both for the .txt artifact and for the prompt to the LLM
    (summarisation / translation). Format::

        [00:01:23] SPEAKER_00: Lorem ipsum
        [00:01:27] SPEAKER_01: Dolor sit amet
    """
    out: List[str] = []
    for seg in segments:
        ts = _format_ts(float(seg.get("start", 0.0))).split(".")[0]
        spk = seg.get("speaker") or "SPEAKER_??"
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        out.append(f"[{ts}] {spk}: {text}")
    return "\n".join(out)
