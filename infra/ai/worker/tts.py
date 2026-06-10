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
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, TypedDict

log = logging.getLogger(__name__)


# Path delle voci Piper bakate nell'immagine (vedi Dockerfile.worker).
# Serve da fallback quando il path configurato (providerHints.ttsVoicesPath,
# es. /models/piper su una PVC/emptyDir non popolata) non contiene voci
# per la lingua richiesta — così il DUB non fallisce con FileNotFoundError.
BAKED_VOICES_PATH = "/opt/piper-voices"


def _has_voice(root: str, language: str) -> bool:
    """True se `root/<language>` esiste e contiene almeno un .onnx."""
    if not root:
        return False
    d = Path(root) / language
    return d.is_dir() and any(d.glob("*.onnx"))


def resolve_voices_path(configured: str, language: str) -> str:
    """Sceglie la dir voci da usare per `language`.

    Preferisce il path configurato; se non esiste/è vuota, ricade sulle
    voci bakate nell'immagine (`/opt/piper-voices`). Se nessuna delle due
    ha voci ritorna il path configurato, così l'errore originale
    (FileNotFoundError in build_voice_pool) resta esplicito.
    """
    if _has_voice(configured, language):
        return configured
    if _has_voice(BAKED_VOICES_PATH, language):
        log.info(
            "voci Piper per '%s' assenti in %s; uso quelle bakate in %s",
            language, configured, BAKED_VOICES_PATH,
        )
        return BAKED_VOICES_PATH
    return configured


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


# Pitch variants di default: ±300 cents (~3 semitoni). Generano 3
# timbri distinguibili dalla stessa voce-base preservando il gender.
# Utile per lingue povere (IT, RO, CS) dove il pool single-speaker è
# piccolo. Per EN il pool è già abbondante senza pitch.
DEFAULT_PITCH_VARIANTS: tuple[int, ...] = (0, -300, +300)


def _apply_pitch_shift(in_wav: str, out_wav: str, cents: int) -> None:
    """Pitch shift via `asetrate + atempo` ffmpeg: ricampiona per
    spostare la pitch, poi compensa con atempo per mantenere la
    durata originale. Niente time-stretch pitch-preserved (servirebbe
    rubberband). Per dubbing operativo è sufficiente.

    `cents`: 100 = 1 semitono. ±300 = ±3 semitoni.
    """
    if cents == 0:
        # No-op: copy. Lasciamo a ffmpeg per uniformità output format.
        subprocess.check_call(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", in_wav,
             "-ar", "22050", "-ac", "1", out_wav],
        )
        return
    # asetrate sposta la pitch del fattore 2^(cents/1200)
    ratio = 2 ** (cents / 1200)
    # atempo accetta 0.5..2; per ratio piccoli un solo step basta
    inv_ratio = 1 / ratio
    if inv_ratio < 0.5 or inv_ratio > 2:
        # split chain (raro a cents in -1200..+1200)
        inv_ratio = max(0.5, min(2, inv_ratio))
    subprocess.check_call(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", in_wav,
         "-filter:a", f"asetrate=22050*{ratio:.5f},aresample=22050,atempo={inv_ratio:.5f}",
         "-ar", "22050", "-ac", "1", out_wav],
    )


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
    speakers: Optional[list[dict]] = None,
    speaker_names: Optional[dict[str, str]] = None,
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

    # Import locale per evitare di pesare a livello modulo: il pool
    # builder gira solo in handler DUB.
    from . import voice_pool as vp
    from . import name_gender as ng

    # Risolvi il path voci: se quello configurato è vuoto (es. /models/piper
    # su emptyDir non seedato), ricadi sulle voci bakate nell'immagine.
    voices_path = resolve_voices_path(voices_path, target_language)

    # Costruisci il pool. Pitch variants attivi così copriamo bene
    # anche le lingue povere (es. IT con 2 voci → 6 timbri).
    pool = vp.build_voice_pool(
        voices_path, target_language,
        pitch_variants=DEFAULT_PITCH_VARIANTS,
    )

    # Speaker list canonica per assign_voices. Se il chiamante non
    # passa esplicitamente `speakers`, la deriviamo dai segmenti
    # (per backward-compat coi caller V1).
    if speakers is None:
        times: dict[str, float] = {}
        for s in segments:
            sp_label = s.get("speaker") or "SPEAKER_??"
            times[sp_label] = times.get(sp_label, 0.0) + max(
                0.0, float(s.get("end", 0)) - float(s.get("start", 0))
            )
        speakers = [
            {"diarLabel": k, "displayName": (speaker_names or {}).get(k), "totalSpeechSec": v}
            for k, v in times.items()
        ]
    elif speaker_names:
        # arricchisci con displayName se fornito separatamente
        for sp in speakers:
            if not sp.get("displayName"):
                sp["displayName"] = speaker_names.get(sp.get("diarLabel"))

    # Pre-compute gender map (firstname.lower → "M"|"F"|"N")
    display_names = [s.get("displayName") or "" for s in speakers]
    gender_map = ng.name_gender_map(display_names)

    voice_map: dict[str, vp.VoiceEntry] = vp.assign_voices(
        speakers, pool, name_gender=gender_map,
    )
    log.info(
        "Piper pool=%d entries, gender map=%s, assignment=%s",
        len(pool),
        gender_map,
        {k: v.voice_id for k, v in voice_map.items()},
    )

    # Cache di PiperVoice istanze caricate (evita reload per ogni segmento).
    loaded: dict[str, "piper.PiperVoice"] = {}

    def get_voice(model_path: str) -> "piper.PiperVoice":
        v = loaded.get(model_path)
        if v is None:
            v = piper.PiperVoice.load(model_path)
            loaded[model_path] = v
        return v

    # Fallback se uno speaker non è nel mapping (caso outlier).
    fallback_entry = pool[0]

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

            entry = voice_map.get(seg.get("speaker") or "", fallback_entry)
            piper_voice = get_voice(entry.voice_path)

            # TTS del testo. Piper API: voice.synthesize_wav(text, file,
            # speaker_id=N).
            raw_path = os.path.join(workdir, f"seg-{idx:04d}_raw.wav")
            # piper-tts 1.2.0: `synthesize(text, wave.Wave_write[, speaker_id])`.
            # NON `synthesize_wav` (esiste solo in piper più recenti → l'errore
            # "'PiperVoice' object has no attribute 'synthesize_wav'") e NON un
            # file binario grezzo: vuole un oggetto `wave.open(..., "wb")`, su
            # cui synthesize imposta framerate/sampwidth/nchannels e scrive.
            with wave.open(raw_path, "wb") as wav_file:
                if entry.speaker_id is not None:
                    piper_voice.synthesize(text, wav_file, speaker_id=entry.speaker_id)
                else:
                    piper_voice.synthesize(text, wav_file)

            # Pitch shift (no-op se pitch_cents=0)
            seg_path = os.path.join(workdir, f"seg-{idx:04d}.wav")
            _apply_pitch_shift(raw_path, seg_path, entry.pitch_cents)
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
    # es. "multivoice:lessac,amy,alan…" (max 3 entry per leggibilità).
    used_voices = sorted({entry.voice_id for entry in voice_map.values()})
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
