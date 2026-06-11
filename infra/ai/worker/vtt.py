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


def segments_to_vtt(
    segments: Iterable[Segment],
    *,
    include_speaker: bool = True,
    speaker_names: Optional[dict] = None,
) -> str:
    """Serialise segments to a WebVTT string.

    Each cue contains BOTH a Voice tag ``<v Label>`` (semantic — picked
    up by some screen readers and the JS ``TextTrackCue.voice`` API)
    AND a textual prefix ``Label: `` so the speaker is **visible** in
    the on-video subtitle overlay. Browser HTML5 hides the ``<v>`` tag
    by default and ``::cue(v)`` styling is inconsistent across
    Chromium/Firefox/Safari, so the redundant text prefix is the only
    reliable way to make sure the viewer can tell who's speaking.

    `speaker_names`: optional mapping ``diarLabel -> displayName``
    (e.g. ``{'SPEAKER_00': 'Alex'}``). When present, the human name
    is used; otherwise the diar label is kept.
    """
    speaker_names = speaker_names or {}
    lines: List[str] = ["WEBVTT", ""]
    for i, seg in enumerate(segments, start=1):
        start = _format_ts(float(seg.get("start", 0.0)))
        end = _format_ts(float(seg.get("end", 0.0)))
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        speaker = seg.get("speaker") if include_speaker else None
        label = speaker_names.get(speaker, speaker) if speaker else None
        lines.append(str(i))
        lines.append(f"{start} --> {end}")
        if label:
            lines.append(f"<v {label}>{label}: {text}")
        else:
            lines.append(text)
        lines.append("")
    return "\n".join(lines)


def segments_to_plain_text(
    segments: Iterable[Segment],
    speaker_names: Optional[dict] = None,
) -> str:
    """Render segments as plain text with speaker prefixes.

    Used both for the .txt artifact and for the prompt to the LLM
    (summarisation / translation). `speaker_names` mappa diarLabel→nome reale
    (es. {"SPEAKER_00": "Raffaele"}): se presente, il prefisso usa il NOME
    invece dell'etichetta acustica, così la SINTESI dell'LLM cita "Raffaele"
    e non "SPEAKER_00". Senza mappa (blind pre-mapping) resta il label. Format::

        [00:01:23] Raffaele: Lorem ipsum
        [00:01:27] Paolo: Dolor sit amet
    """
    names = speaker_names or {}
    out: List[str] = []
    for seg in segments:
        ts = _format_ts(float(seg.get("start", 0.0))).split(".")[0]
        spk = seg.get("speaker") or "SPEAKER_??"
        label = names.get(spk, spk)
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        out.append(f"[{ts}] {label}: {text}")
    return "\n".join(out)


def _parse_ts(ts: str) -> float:
    """Parse 'HH:MM:SS.mmm' o 'MM:SS.mmm' → secondi (float)."""
    parts = ts.strip().split(":")
    if len(parts) == 3:
        h, m, s = parts
        return int(h) * 3600 + int(m) * 60 + float(s)
    if len(parts) == 2:
        m, s = parts
        return int(m) * 60 + float(s)
    return float(parts[0])


def parse_translated_vtt(vtt_text: str) -> "tuple[List[Segment], float]":
    """Parse un WebVTT (prodotto da `segments_to_vtt`) in segmenti TTS.

    `segments_to_vtt` emette per ogni cue ``<v LABEL>LABEL: testo``:
    contiene SIA il tag vocale ``<v LABEL>`` SIA un prefisso visibile
    ``LABEL: `` duplicato. Qui rimuoviamo ENTRAMBI — altrimenti un TTS a
    valle (Piper, job DUB) pronuncerebbe l'etichetta dello speaker
    ("SPEAKER zero zero") — e catturiamo LABEL come ``speaker`` del
    segmento, così il dubbing può assegnare una voce per-speaker (coi
    nomi reali quando presenti). Viene rimosso SOLO il prefisso che
    combacia esattamente con l'etichetta del tag, per non intaccare
    testi tradotti che contengono ':'.

    Ritorna ``(segments, total_duration_sec)``.
    """
    segments: List[Segment] = []
    total_duration = 0.0
    block_lines: List[str] = []
    current_speaker: Optional[str] = None
    parsed_start = 0.0
    parsed_end = 0.0

    def _push() -> None:
        if block_lines:
            segments.append({
                "start": parsed_start,
                "end": parsed_end,
                "text": " ".join(block_lines).strip(),
                "speaker": current_speaker,
            })

    for line in vtt_text.split("\n"):
        if " --> " in line:
            _push()
            block_lines = []
            current_speaker = None
            ts = line.split(" --> ")
            parsed_start = _parse_ts(ts[0].strip())
            parsed_end = _parse_ts(ts[1].strip().split()[0])
            total_duration = max(total_duration, parsed_end)
        elif line.strip() and not line.strip().isdigit() and line.strip() != "WEBVTT":
            txt = line.strip()
            if txt.startswith("<v "):
                close = txt.find(">")
                if close != -1:
                    current_speaker = txt[3:close].strip() or current_speaker
                    txt = txt[close + 1:]
                    prefix = f"{current_speaker}: " if current_speaker else ""
                    if prefix and txt.startswith(prefix):
                        txt = txt[len(prefix):]
            block_lines.append(txt)
    _push()
    return segments, total_duration
