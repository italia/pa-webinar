"""Transcription stage — WhisperX + pyannote.audio diarization.

Two paths exist intentionally:

  * Real path (``transcribe_with_whisperx``): loads WhisperX +
    pyannote, runs the pipeline. Requires CUDA and the gated pyannote
    model weights to be already in /models.

  * Stub path (``transcribe_stub``): returns a hand-built segment list
    so unit tests can exercise the worker's downstream stages without
    a GPU or model download.

The real path is imported lazily so the module is importable on a
CPU-only dev box. The stub is the default when ``WORKER_STUB=1``.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)


@dataclass
class TranscriptResult:
    language: str
    segments: List[Dict[str, Any]]
    speakers: List[Dict[str, Any]]
    """List of {diarLabel, totalSpeechSec}."""
    model_id: str
    model_version: str
    raw_json: Dict[str, Any]
    """The full WhisperX output, suitable for the TRANSCRIPT_JSON artifact."""


# ---------------------------------------------------------------------------
# Stub — used by tests and by `--dry-run` invocations.
# ---------------------------------------------------------------------------


def transcribe_stub(*, language_hint: Optional[str]) -> TranscriptResult:
    lang = (language_hint or "it").lower()
    segments = [
        {
            "start": 0.0,
            "end": 3.5,
            "text": "Buongiorno e benvenuti alla riunione di oggi.",
            "speaker": "SPEAKER_00",
        },
        {
            "start": 3.8,
            "end": 7.2,
            "text": "Grazie a tutti per la presenza, iniziamo subito.",
            "speaker": "SPEAKER_01",
        },
    ]
    speakers = [
        {"diarLabel": "SPEAKER_00", "totalSpeechSec": 4},
        {"diarLabel": "SPEAKER_01", "totalSpeechSec": 4},
    ]
    return TranscriptResult(
        language=lang,
        segments=segments,
        speakers=speakers,
        model_id="stub",
        model_version="0",
        raw_json={"segments": segments, "language": lang, "speakers": speakers},
    )


# ---------------------------------------------------------------------------
# Real implementation
# ---------------------------------------------------------------------------


def transcribe_with_whisperx(
    audio_path: str,
    *,
    language_hint: Optional[str] = None,
    asr_model_id: str = "large-v3",
    device: str = "cuda",
    compute_type: str = "float16",
    hf_token: Optional[str] = None,
) -> TranscriptResult:
    """Run WhisperX + pyannote diarization on the given audio file."""
    # Imports kept local so the module is loadable without CUDA.
    import whisperx  # type: ignore[import-not-found]

    log.info("loading WhisperX model %s on %s", asr_model_id, device)
    asr = whisperx.load_model(asr_model_id, device, compute_type=compute_type)
    audio = whisperx.load_audio(audio_path)

    log.info("running ASR")
    result = asr.transcribe(audio, language=language_hint, batch_size=16)
    language = result.get("language") or language_hint or "it"

    # Word-level alignment (improves cue boundaries — Whisper alone is
    # phrase-level which produces lumpy subtitles).
    align_model, metadata = whisperx.load_align_model(
        language_code=language, device=device
    )
    aligned = whisperx.align(
        result["segments"],
        align_model,
        metadata,
        audio,
        device,
        return_char_alignments=False,
    )

    # Diarization. Uses pyannote 3.1 — model is gated, the HF token
    # must be set (and TOS accepted) before the image is built.
    log.info("running diarization")
    diarize_pipeline = whisperx.DiarizationPipeline(
        use_auth_token=hf_token, device=device
    )
    diarize_segments = diarize_pipeline(audio)
    diarized = whisperx.assign_word_speakers(diarize_segments, aligned)

    segments = []
    speech_by_label: Dict[str, float] = {}
    for seg in diarized["segments"]:
        speaker = seg.get("speaker") or "SPEAKER_??"
        seg_out = {
            "start": float(seg["start"]),
            "end": float(seg["end"]),
            "text": (seg.get("text") or "").strip(),
            "speaker": speaker,
        }
        segments.append(seg_out)
        speech_by_label[speaker] = speech_by_label.get(speaker, 0.0) + (
            seg_out["end"] - seg_out["start"]
        )

    speakers = [
        {"diarLabel": label, "totalSpeechSec": int(round(secs))}
        for label, secs in sorted(speech_by_label.items())
    ]

    return TranscriptResult(
        language=language,
        segments=segments,
        speakers=speakers,
        model_id=asr_model_id,
        model_version=os.environ.get("WHISPERX_VERSION", "whisperx-3.1"),
        raw_json={"segments": segments, "language": language, "speakers": speakers},
    )
