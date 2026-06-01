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


# Soglie per il filtro hallucination: segmenti con probabilità
# media troppo bassa o probabilità di "no speech" troppo alta sono
# tipicamente Whisper che inventa parole su silenzio/musica/respiro.
# Valori scelti da test empirici su recording PA italiane.
HALLUCINATION_AVG_LOGPROB_THRESHOLD = -1.0
HALLUCINATION_NO_SPEECH_THRESHOLD = 0.6


def transcribe_with_whisperx(
    audio_path: str,
    *,
    language_hint: Optional[str] = None,
    asr_model_id: str = "large-v3",
    device: str = "cuda",
    compute_type: str = "float16",
    hf_token: Optional[str] = None,
    initial_prompt: Optional[str] = None,
    expected_speakers: Optional[int] = None,
) -> TranscriptResult:
    """Run WhisperX + pyannote diarization on the given audio file.

    Quality knobs:
      - `initial_prompt`: contesto testuale passato a Whisper (nomi
        propri, sigle, termini tecnici dell'evento). Migliora
        drasticamente trascrizione di "PCM", "OVH", "Raffaele", etc.
      - `expected_speakers`: quando noto, forza k nel clustering di
        diarization invece dell'auto-detect. Risolve i casi
        "abbiamo 3 speaker ma il modello ne trova 6 (con outlier)".
      - Filtro hallucination via `avg_logprob` / `no_speech_prob` per
        scartare i segmenti dove Whisper inventa testo su silenzio o
        musica di fondo.
    """
    # Imports kept local so the module is loadable without CUDA.
    import whisperx  # type: ignore[import-not-found]

    log.info("loading WhisperX model %s on %s", asr_model_id, device)
    asr = whisperx.load_model(asr_model_id, device, compute_type=compute_type)
    audio = whisperx.load_audio(audio_path)

    # ASR call. faster-whisper espone `initial_prompt` via gli
    # `asr_options`; lo settiamo prima della chiamata.
    if initial_prompt:
        try:
            # whisperx >=3.3: setattr su model.options
            asr.options = asr.options._replace(initial_prompt=initial_prompt)  # type: ignore[attr-defined]
        except Exception:
            log.warning("could not set initial_prompt on ASR options")
    log.info("running ASR (initial_prompt=%s)", bool(initial_prompt))
    result = asr.transcribe(audio, language=language_hint, batch_size=16)
    language = result.get("language") or language_hint or "it"

    # Filtra hallucination — segmenti con probabilità media troppo
    # bassa o no_speech troppo alto. Whisper espone queste statistiche
    # per ogni segmento nel campo raw.
    raw_segments = result.get("segments") or []
    kept_segments: List[Dict[str, Any]] = []
    dropped = 0
    for seg in raw_segments:
        avg_logprob = seg.get("avg_logprob")
        no_speech_prob = seg.get("no_speech_prob")
        if (
            avg_logprob is not None
            and avg_logprob < HALLUCINATION_AVG_LOGPROB_THRESHOLD
        ) or (
            no_speech_prob is not None
            and no_speech_prob > HALLUCINATION_NO_SPEECH_THRESHOLD
        ):
            dropped += 1
            continue
        kept_segments.append(seg)
    log.info("hallucination filter: kept %d, dropped %d", len(kept_segments), dropped)
    result["segments"] = kept_segments

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
    log.info("running diarization (expected_speakers=%s)", expected_speakers)
    diarize_pipeline = whisperx.DiarizationPipeline(
        use_auth_token=hf_token, device=device
    )
    # Quando il moderatore conosce il numero di speaker, lo forziamo:
    # entrambi min_speakers e max_speakers a expected_speakers fissa k.
    if expected_speakers and expected_speakers > 0:
        diarize_segments = diarize_pipeline(
            audio,
            min_speakers=expected_speakers,
            max_speakers=expected_speakers,
        )
    else:
        diarize_segments = diarize_pipeline(audio)
    diarized = whisperx.assign_word_speakers(diarize_segments, aligned)

    segments = []
    speech_by_label: Dict[str, float] = {}
    for seg in diarized["segments"]:
        speaker = seg.get("speaker") or "SPEAKER_??"
        # Propaga avg_logprob come confidence per il frontend (badge
        # "trascrizione meno sicura"). Il segment originale lo
        # contiene se l'allineamento non l'ha rimosso.
        seg_out = {
            "start": float(seg["start"]),
            "end": float(seg["end"]),
            "text": (seg.get("text") or "").strip(),
            "speaker": speaker,
            "avg_logprob": seg.get("avg_logprob"),
            "no_speech_prob": seg.get("no_speech_prob"),
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


def transcribe_single_speaker(
    audio_path: str,
    *,
    language_hint: Optional[str] = None,
    asr_model_id: str = "large-v3",
    device: str = "cuda",
    compute_type: str = "float16",
    initial_prompt: Optional[str] = None,
) -> Dict[str, Any]:
    """ASR di UNA traccia mono-parlante (ADR-013, multitrack).

    Identica a `transcribe_with_whisperx` ma SENZA diarization: la traccia
    ha un solo parlante noto, quindi pyannote è superfluo. Ritorna
    ``{"segments": [...], "language": str}`` con tempi LOCALI alla traccia
    (il merge li shifta su timeline globale). Stesso filtro hallucination
    + allineamento word-level del path principale.
    """
    import whisperx  # type: ignore[import-not-found]

    asr = whisperx.load_model(asr_model_id, device, compute_type=compute_type)
    audio = whisperx.load_audio(audio_path)
    if initial_prompt:
        try:
            asr.options = asr.options._replace(initial_prompt=initial_prompt)  # type: ignore[attr-defined]
        except Exception:
            log.warning("could not set initial_prompt on ASR options")
    result = asr.transcribe(audio, language=language_hint, batch_size=16)
    language = result.get("language") or language_hint or "it"

    kept = []
    for seg in result.get("segments") or []:
        avg_logprob = seg.get("avg_logprob")
        no_speech_prob = seg.get("no_speech_prob")
        if (
            avg_logprob is not None and avg_logprob < HALLUCINATION_AVG_LOGPROB_THRESHOLD
        ) or (
            no_speech_prob is not None and no_speech_prob > HALLUCINATION_NO_SPEECH_THRESHOLD
        ):
            continue
        kept.append(seg)
    result["segments"] = kept

    align_model, metadata = whisperx.load_align_model(language_code=language, device=device)
    aligned = whisperx.align(
        result["segments"], align_model, metadata, audio, device, return_char_alignments=False
    )
    segments = [
        {
            "start": float(s["start"]),
            "end": float(s["end"]),
            "text": (s.get("text") or "").strip(),
            "words": s.get("words"),
            "avg_logprob": s.get("avg_logprob"),
            "no_speech_prob": s.get("no_speech_prob"),
        }
        for s in aligned["segments"]
    ]
    return {"segments": segments, "language": language}


def transcribe_single_speaker_stub(*, language_hint: Optional[str] = None) -> Dict[str, Any]:
    """Stub mono-parlante (WORKER_STUB=1): poche battute canned."""
    lang = language_hint or "it"
    return {
        "segments": [
            {"start": 0.0, "end": 2.0, "text": "Battuta di prova traccia."},
            {"start": 3.0, "end": 5.0, "text": "Seconda battuta."},
        ],
        "language": lang,
    }


def build_initial_prompt(
    *,
    event_title: Optional[str],
    organizer: Optional[str],
    speakers_info: Optional[str],
    extra_terms: Optional[List[str]] = None,
) -> str:
    """Costruisce l'`initial_prompt` per WhisperX dal contesto evento.

    L'initial_prompt è un testo (~200 tokens max) che guida Whisper
    sul vocabolario specifico dell'evento. Non viene trascritto: è
    solo "memoria" del modello durante la decodifica. Tipico contenuto:
    nome evento, organizzazione, nomi propri dei relatori, sigle.

    Esempio:
      "Riunione del Dipartimento per la Trasformazione Digitale.
       Partecipanti: Raffaele Vitiello, Alex Marchetti, Paolo Rossi.
       Argomenti: piattaforma video, Kubernetes, Azure, OVH, PCM."
    """
    parts: List[str] = []
    if event_title:
        parts.append(event_title.strip())
    if organizer:
        parts.append(f"Organizzato da {organizer.strip()}.")
    if speakers_info:
        parts.append(f"Partecipanti e relatori: {speakers_info.strip()}.")
    if extra_terms:
        parts.append("Termini tecnici: " + ", ".join(extra_terms) + ".")
    return " ".join(parts)[:800]  # safety cap
