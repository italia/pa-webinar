"""Text-to-Speech (TTS) per il job DUB.

Usa **Piper** (rhasspy/piper, MIT license) per la sintesi vocale
**neutra** — voce sintetica non clonata. Scelta deliberata per evitare
problemi Art. 9 GDPR (voice cloning = dato biometrico) e dare comunque
un audio sincronizzato con i sottotitoli tradotti.

Piper è un wrapper C++ ONNX, gira su CPU (la GPU sta servendo Whisper/
vLLM). Voci pre-trained scaricabili da huggingface.co/rhasspy/piper-voices
(MIT license sui modelli). Pre-bake nella PVC /models/piper/<lang>/.

Output: file audio AAC in MP4 container (.m4a) con segmenti TTS
allineati ai timestamp del transcript tradotto. Stesso minutaggio del
video originale (gap di silenzio dove serve).

Stub mode: WORKER_STUB=1 produce un m4a di 5s con un beep per
permettere smoke test end-to-end senza generare audio reale.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, TypedDict

log = logging.getLogger(__name__)


class Segment(TypedDict, total=False):
    start: float
    end: float
    text: str
    speaker: Optional[str]


@dataclass
class DubResult:
    """Risultato del dub: path del .m4a generato + metadati."""
    audio_path: str
    duration_sec: float
    engine: str
    voice_id: str
    model_version: str


# ---------------------------------------------------------------------------
# Stub (per smoke test senza scaricare voci Piper)
# ---------------------------------------------------------------------------


def dub_stub(*, target_language: str, total_duration_sec: float, workdir: str) -> DubResult:
    """Genera un m4a fisso (tono sinusoidale) per smoke test."""
    out = Path(workdir) / f"dubbed.{target_language}.m4a"
    # ffmpeg: tono 440Hz mono per N secondi → AAC m4a
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-f", "lavfi",
            "-i", f"sine=frequency=440:duration={max(1.0, total_duration_sec):.1f}",
            "-ac", "1",
            "-ar", "16000",
            "-c:a", "aac",
            "-b:a", "48k",
            str(out),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return DubResult(
        audio_path=str(out),
        duration_sec=total_duration_sec,
        engine="stub",
        voice_id="sine-440",
        model_version="stub-0",
    )


# ---------------------------------------------------------------------------
# Piper TTS implementation
# ---------------------------------------------------------------------------


# Mapping ISO-639-1 → voce Piper default. Per cluster, l'admin può
# rimpiazzare il file .onnx in /models/piper/<lang>/ con una voce
# diversa senza toccare il codice. Le voci scelte qui sono "medium"
# (compromesso qualità/dimensione: ~30MB, ~22050Hz output).
DEFAULT_VOICES = {
    "en": "en_US-lessac-medium",
    "it": "it_IT-paola-medium",
    "fr": "fr_FR-tom-medium",
    "de": "de_DE-thorsten-medium",
    "es": "es_ES-davefx-medium",
}


def _find_voice(voices_path: str, language: str) -> tuple[str, str]:
    """Cerca un file .onnx per la lingua nella PVC. Ritorna (model_path, voice_id)."""
    lang_dir = Path(voices_path) / language
    if not lang_dir.is_dir():
        raise FileNotFoundError(
            f"No Piper voice directory for {language} at {lang_dir}. "
            f"Pre-seed the PVC with `python -m piper.download_voices "
            f"{DEFAULT_VOICES.get(language, '<voice>')} --data-dir {voices_path}/{language}`."
        )
    onnx_files = sorted(lang_dir.glob("*.onnx"))
    if not onnx_files:
        raise FileNotFoundError(f"No .onnx file in {lang_dir}")
    return str(onnx_files[0]), onnx_files[0].stem


def _voice_pool(voices_path: str, language: str) -> list[tuple[str, str]]:
    """Tutte le voci disponibili per `language` nella PVC, in ordine
    deterministico. Ritorna `[(model_path, voice_id), ...]`.

    Permette il dubbing **multivoce**: con N speaker distinti, ogni
    SPEAKER_xx riceve una delle voci del pool. Restano voci sintetiche
    pre-trained pubbliche — NON è voice cloning, nessuna imitazione
    della voce reale. Vedi `assign_voices` per la logica di assegnazione.

    Se la PVC contiene una sola voce per lingua, il pool ha un solo
    elemento e il dub fallback su single-voice (comportamento V1).
    """
    lang_dir = Path(voices_path) / language
    onnx_files = sorted(lang_dir.glob("*.onnx"))
    if not onnx_files:
        raise FileNotFoundError(f"No .onnx file in {lang_dir}")
    return [(str(f), f.stem) for f in onnx_files]


def assign_voices(
    segments: List[Segment],
    pool: list[tuple[str, str]],
) -> dict[str, tuple[str, str]]:
    """Mapping SPEAKER_xx → (voice_path, voice_id) deterministico.

    Strategia: ordina gli speaker per tempo totale di parola
    decrescente; assegna le voci del pool nell'ordine. Lo speaker che
    parla di più riceve la voce più "central" (primo elemento del
    pool); a seguire le altre. Pool ciclico se gli speaker eccedono.
    """
    times: dict[str, float] = {}
    for s in segments:
        sp = s.get("speaker") or "SPEAKER_??"
        times[sp] = times.get(sp, 0.0) + max(0.0, float(s.get("end", 0)) - float(s.get("start", 0)))
    ordered = sorted(times.items(), key=lambda kv: -kv[1])
    mapping: dict[str, tuple[str, str]] = {}
    for i, (sp_label, _) in enumerate(ordered):
        mapping[sp_label] = pool[i % len(pool)]
    return mapping


def _format_silence(duration_sec: float, out_path: str) -> None:
    """Genera N secondi di silenzio mono 22050Hz per i gap fra segmenti."""
    if duration_sec <= 0:
        return
    subprocess.check_call(
        [
            "ffmpeg", "-y",
            "-f", "lavfi",
            "-i", f"anullsrc=channel_layout=mono:sample_rate=22050",
            "-t", f"{duration_sec:.3f}",
            "-c:a", "pcm_s16le",
            out_path,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def dub_with_piper(
    *,
    segments: List[Segment],
    target_language: str,
    voices_path: str,
    total_duration_sec: float,
) -> DubResult:
    """Genera audio TTS allineato ai timestamp dei segmenti tradotti.

    Strategia:
      1. Per ogni segmento, fai Piper TTS sul testo → wav 22050Hz.
      2. Fra un segmento e il successivo, inserisci silenzio per
         mantenere l'allineamento ai timestamp originali (così l'audio
         dubbed coincide visivamente con la persona che parla).
      3. Concat tutti i wav in un singolo m4a AAC 48 kbps mono.

    Quando il TTS produce un segmento più lungo del gap originale, lo
    lasciamo "sforare" — Piper non supporta controllo durata stretto,
    e per "dubbing operativo" (non production-grade lip-sync) va bene.
    Un futuro upgrade può aggiungere atempo per stretching audio.
    """
    import piper  # type: ignore[import-not-found]

    pool = _voice_pool(voices_path, target_language)
    voice_map = assign_voices(segments, pool)
    log.info(
        "Piper voice pool=%d, speaker assignment: %s",
        len(pool),
        {k: vid for k, (_, vid) in voice_map.items()},
    )

    # Cache di PiperVoice istanze caricate (evita reload per ogni segmento).
    loaded: dict[str, "piper.PiperVoice"] = {}

    def get_voice(model_path: str) -> "piper.PiperVoice":
        v = loaded.get(model_path)
        if v is None:
            v = piper.PiperVoice.load(model_path)
            loaded[model_path] = v
        return v

    fallback_voice = pool[0]

    with tempfile.TemporaryDirectory(prefix="dub-") as workdir:
        chunks: list[str] = []
        cursor = 0.0  # cursore della timeline dell'audio prodotto finora

        for idx, seg in enumerate(segments):
            start = float(seg.get("start", 0.0))
            text = (seg.get("text") or "").strip()
            if not text:
                continue

            # Silenzio fra cursor e start del segmento corrente.
            gap = max(0.0, start - cursor)
            if gap > 0.05:
                sil_path = os.path.join(workdir, f"sil-{idx}.wav")
                _format_silence(gap, sil_path)
                chunks.append(sil_path)
                cursor += gap

            # Voce per questo segmento = voce assegnata allo speaker.
            voice_model_path, _ = voice_map.get(
                seg.get("speaker") or "", fallback_voice
            )
            piper_voice = get_voice(voice_model_path)

            # TTS del testo. Piper API: voice.synthesize_wav(text, file).
            seg_path = os.path.join(workdir, f"seg-{idx:04d}.wav")
            with open(seg_path, "wb") as f:
                piper_voice.synthesize_wav(text, f)
            chunks.append(seg_path)

            # Stima della durata del wav generato per aggiornare il cursore.
            # ffprobe è già installato nel container worker.
            dur_str = subprocess.check_output(
                [
                    "ffprobe", "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    seg_path,
                ],
                text=True,
            ).strip()
            cursor += float(dur_str)

        # Padding finale se il video è più lungo dell'ultimo segmento
        # (silenzio fino a total_duration_sec).
        tail = max(0.0, total_duration_sec - cursor)
        if tail > 0.05:
            tail_path = os.path.join(workdir, "sil-tail.wav")
            _format_silence(tail, tail_path)
            chunks.append(tail_path)

        # Concat di tutti i chunk in un m4a finale.
        # Usiamo il concat demuxer (richiede una lista in un file).
        concat_list = os.path.join(workdir, "concat.txt")
        with open(concat_list, "w") as f:
            for c in chunks:
                f.write(f"file '{c}'\n")

        out_path = os.path.join(workdir, f"dubbed.{target_language}.m4a")
        subprocess.check_call(
            [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_list,
                "-c:a", "aac",
                "-b:a", "48k",
                "-ar", "22050",
                "-ac", "1",
                out_path,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        # Sposta in un path stabile fuori da workdir (rimuove il
        # cleanup automatico del TemporaryDirectory).
        final = tempfile.NamedTemporaryFile(
            prefix="dubbed-", suffix=".m4a", delete=False
        )
        final.close()
        shutil.copy(out_path, final.name)

    # voice_id riportato nel result è un multi-voice id sintetico,
    # es. "multivoice:lessac,amy,alan" (massimo 3 entry per leggibilità).
    used_voices = sorted({vid for _, vid in voice_map.values()})
    voice_id = (
        used_voices[0] if len(used_voices) == 1
        else "multivoice:" + ",".join(used_voices[:3]) + ("…" if len(used_voices) > 3 else "")
    )

    return DubResult(
        audio_path=final.name,
        duration_sec=total_duration_sec,
        engine="piper",
        voice_id=voice_id,
        model_version=os.environ.get("PIPER_VERSION", "piper-1.2"),
    )
