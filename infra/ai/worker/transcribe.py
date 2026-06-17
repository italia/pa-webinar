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


def _hf_token_usable(token: Optional[str]) -> bool:
    """True se il token HF sembra reale.

    I token HuggingFace iniziano con ``hf_`` e sono lunghi ~37 char.
    Segnaposti come ``stub-hf-token`` (quello cablato di default nel
    secret) o stringhe vuote → False, così saltiamo del tutto la
    diarization invece di tentare (e fallire) il download del modello
    gated pyannote — che ritorna ``None`` e fa esplodere
    ``.to(device)`` (l'errore "'NoneType' object has no attribute 'to'"
    che bruciava un'intera run GPU prima di crashare).
    """
    return bool(token and token.startswith("hf_") and len(token) >= 20)


def _single_speaker_segments(aligned: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Fallback senza diarization: tutti i segmenti → un unico SPEAKER_00.

    Usato quando il token HF non è valido o pyannote fallisce. Il
    transcript resta pienamente utilizzabile a valle (sintesi,
    traduzione, dubbing); manca solo la separazione per-speaker.
    """
    out: List[Dict[str, Any]] = []
    for seg in aligned.get("segments", []):
        # Stessa forma del path diarizzato (start/end/text/speaker +
        # confidence): niente array `words` pesante da trascinare.
        out.append({
            "start": seg["start"],
            "end": seg["end"],
            "text": (seg.get("text") or "").strip(),
            "speaker": "SPEAKER_00",
            "avg_logprob": seg.get("avg_logprob"),
            "no_speech_prob": seg.get("no_speech_prob"),
        })
    return out


def _diarize_segments(
    whisperx: Any,
    aligned: Dict[str, Any],
    audio: Any,
    *,
    hf_token: Optional[str],
    expected_speakers: Optional[int],
    device: str,
) -> List[Dict[str, Any]]:
    """Diarizza i segmenti allineati, con fallback single-speaker.

    Ritorna la lista di segmenti con campo ``speaker``. La diarization è
    **best-effort**: se il token HF non è valido (segnaposto/assente) o
    pyannote fallisce per qualunque ragione, ogni segmento riceve
    ``SPEAKER_00`` invece di far fallire il job. Così un token non
    configurato non spreca mai una run GPU completa.
    """
    if not _hf_token_usable(hf_token):
        log.warning(
            "HF token assente o non valido (atteso 'hf_…'): salto la "
            "diarization e produco un transcript single-speaker. Imposta "
            "un token HF reale (con le condizioni pyannote accettate) nel "
            "secret per ottenere l'attribuzione per-speaker."
        )
        return _single_speaker_segments(aligned)

    try:
        log.info("running diarization (expected_speakers=%s)", expected_speakers)
        diarize_pipeline = whisperx.DiarizationPipeline(
            use_auth_token=hf_token, device=device
        )
        # Quando il moderatore conosce il numero di speaker, lo forziamo:
        # min_speakers == max_speakers == expected_speakers fissa k.
        if expected_speakers and expected_speakers > 0:
            diarize_segments = diarize_pipeline(
                audio,
                min_speakers=expected_speakers,
                max_speakers=expected_speakers,
            )
        else:
            diarize_segments = diarize_pipeline(audio)
        # Diagnostica: quanti speaker ha trovato pyannote (raw) PRIMA di
        # assign_word_speakers — per distinguere "pyannote collassa a 1"
        # da "assign_word_speakers collassa" (un dialogo a 2 etichettato
        # tutto SPEAKER_00). diarize_segments è un DataFrame (start/end/speaker).
        try:
            uniq = sorted(set(diarize_segments["speaker"].tolist()))
            durs = {}
            for _, r in diarize_segments.iterrows():
                durs[r["speaker"]] = durs.get(r["speaker"], 0.0) + float(r["end"]) - float(r["start"])
            log.info(
                "pyannote raw: %d speaker(s) %s durations(s)=%s",
                len(uniq), uniq, {k: round(v, 1) for k, v in durs.items()},
            )
        except Exception:  # noqa: BLE001 — solo diagnostica
            log.info("pyannote raw: diarize_segments type=%s (no summary)", type(diarize_segments).__name__)
        diarized = whisperx.assign_word_speakers(diarize_segments, aligned)
        segs = diarized["segments"]
        assigned = sorted({s.get("speaker") for s in segs if s.get("speaker")})
        log.info("after assign_word_speakers: %d speaker(s) %s", len(assigned), assigned)
        return segs
    except Exception:  # noqa: BLE001 — diarization è best-effort
        log.exception(
            "diarization fallita — degrado a single-speaker (il transcript "
            "resta valido per sintesi/traduzione/dubbing)"
        )
        return _single_speaker_segments(aligned)


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

    log.info(
        "loading WhisperX model %s on %s (initial_prompt=%s)",
        asr_model_id, device, bool(initial_prompt),
    )
    # L'initial_prompt (nomi propri/sigle/termini dell'evento) va passato a
    # `load_model` via `asr_options` — API stabile di whisperx 3.x. NON
    # mutare `asr.options` dopo il load: in whisperx 3.4 quell'oggetto è
    # cambiato e `._replace` solleva, quindi il prompt veniva silenziosamente
    # SCARTATO (nomi propri non innescati → ortografia imprecisa).
    asr_options = {"initial_prompt": initial_prompt} if initial_prompt else None
    asr = whisperx.load_model(
        asr_model_id, device, compute_type=compute_type, asr_options=asr_options
    )
    audio = whisperx.load_audio(audio_path)

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

    # Diarization (chi-parla) con pyannote 3.1 — modello GATED. È
    # best-effort: senza token HF valido o se pyannote fallisce,
    # `_diarize_segments` degrada a single-speaker invece di crashare.
    diarized_segments = _diarize_segments(
        whisperx,
        aligned,
        audio,
        hf_token=hf_token,
        expected_speakers=expected_speakers,
        device=device,
    )

    segments = []
    speech_by_label: Dict[str, float] = {}
    for seg in diarized_segments:
        speaker = seg.get("speaker") or "SPEAKER_00"
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


def load_asr_model(
    asr_model_id: str,
    *,
    device: str = "cuda",
    compute_type: str = "float16",
    initial_prompt: Optional[str] = None,
) -> Any:
    """Carica SOLO il modello ASR WhisperX (~3GB).

    L'ASR è indipendente dalla lingua (Whisper rileva la lingua in fase di
    decodifica), quindi nel path multitrack va caricato UNA volta e riusato
    su tutte le tracce. initial_prompt via asr_options (vedi nota in
    transcribe_with_whisperx).
    """
    import whisperx  # type: ignore[import-not-found]

    asr_options = {"initial_prompt": initial_prompt} if initial_prompt else None
    return whisperx.load_model(
        asr_model_id, device, compute_type=compute_type, asr_options=asr_options
    )


def load_align_model(language: str, *, device: str = "cuda") -> tuple[Any, Any]:
    """Carica (align_model, align_metadata) per una data lingua.

    Il modello di allineamento dipende SOLO dalla lingua, quindi nel path
    multitrack va memoizzato per lingua (tracce che condividono lingua
    condividono il modello)."""
    import whisperx  # type: ignore[import-not-found]

    return whisperx.load_align_model(language_code=language, device=device)


def load_models(
    asr_model_id: str,
    language: str,
    *,
    device: str = "cuda",
    compute_type: str = "float16",
    initial_prompt: Optional[str] = None,
) -> tuple[Any, Any, Any]:
    """Carica (ASR, align_model, align_metadata) per WhisperX.

    Convenience combiner di `load_asr_model` + `load_align_model`, usato dal
    wrapper single-track. Il path multitrack chiama invece i due loader
    separatamente per riusare l'ASR e memoizzare l'align per lingua.

    initial_prompt via asr_options (vedi nota in transcribe_with_whisperx).
    """
    asr = load_asr_model(
        asr_model_id, device=device, compute_type=compute_type, initial_prompt=initial_prompt
    )
    align_model, align_metadata = load_align_model(language, device=device)
    return asr, align_model, align_metadata


def transcribe_single_speaker_with_models(
    audio_path: str,
    *,
    asr: Any,
    align_model: Any = None,
    align_metadata: Any = None,
    get_align_model: Any = None,
    language_hint: Optional[str] = None,
    device: str = "cuda",
) -> Dict[str, Any]:
    """ASR di UNA traccia mono-parlante usando modelli GIÀ caricati.

    Cuore di `transcribe_single_speaker`: accetta l'ASR precaricato (vedi
    `load_asr_model`) così il path multitrack può caricarlo una volta e
    riusarlo su tutte le tracce. Ritorna ``{"segments": [...], "language":
    str}`` con tempi LOCALI alla traccia. Stesso filtro hallucination +
    allineamento word-level del path principale.

    Il modello di allineamento è specifico per lingua, ma la lingua è nota
    solo DOPO l'ASR. Due modi di fornirlo:
      * `align_model`/`align_metadata` espliciti (lingua già nota), oppure
      * `get_align_model(language) -> (model, metadata)`: callback chiamata
        con la lingua rilevata, usata dal path multitrack per memoizzare
        l'align per lingua tra le tracce.
    """
    import whisperx  # type: ignore[import-not-found]

    audio = whisperx.load_audio(audio_path)
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

    if get_align_model is not None:
        align_model, align_metadata = get_align_model(language)
    aligned = whisperx.align(
        result["segments"], align_model, align_metadata, audio, device, return_char_alignments=False
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

    Wrapper thin: carica i modelli (per la lingua nota/`it` di default) e
    delega a `transcribe_single_speaker_with_models`. I chiamanti
    single-track conservano il comportamento originale (load-then-call). Il
    path multitrack usa invece `load_models` + il core per riusare i modelli
    tra le tracce.
    """
    language = (language_hint or "it").lower()
    asr, align_model, align_metadata = load_models(
        asr_model_id,
        language,
        device=device,
        compute_type=compute_type,
        initial_prompt=initial_prompt,
    )
    return transcribe_single_speaker_with_models(
        audio_path,
        asr=asr,
        align_model=align_model,
        align_metadata=align_metadata,
        language_hint=language_hint,
        device=device,
    )


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
