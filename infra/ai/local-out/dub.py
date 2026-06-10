#!/usr/bin/env python3
"""
Dubbing sintetico EN con Piper TTS — **multivoce gender-aware**.

Estensioni vs V1:
  - **Pool gender-aware**: F per Ilaria/Paola, M per Alex/Raffaele
    (logica in `name_gender.py`, catalogo voci in `voice_pool.py`).
  - **Pitch variants**: per estendere il pool delle lingue povere
    (IT, RO, CS) genero ±300 cents variants dalla stessa voce-base,
    preservando il gender.
  - **Multi-speaker datasets**: se la PVC contiene `en_GB-vctk-medium`
    (109 voci interne), il builder le espande tutte.

Niente cloning: pool sempre di voci pre-trained Piper pubbliche.

Input: summary.json + transcript_diarized.json
Output: dubbed_en.wav + dubbed_en.m4a
"""
from __future__ import annotations
import json
import subprocess as sp
import sys
import tempfile
import wave
from pathlib import Path

# riuso dei moduli worker (sono pure Python, niente runtime k8s)
HERE = Path(__file__).resolve().parent
WORKER_DIR = HERE.parent / "worker"
sys.path.insert(0, str(WORKER_DIR))
import voice_pool as vp   # noqa: E402
import name_gender as ng  # noqa: E402

VOICES_PATH = str(HERE / "piper-voices")
LANGUAGE = "en_US"  # alias: la dir reale è piper-voices/ (no subfolder)
SAMPLE_RATE = 22050
SUMMARY_IN = "summary.json"
TX_IN = "transcript_diarized.json"
OUT_WAV = "dubbed_en.wav"
OUT_M4A = "dubbed_en.m4a"


def piper_say(text: str, out: Path, *, voice_path: str, speaker_id: int | None = None) -> None:
    cmd = ["piper", "--model", voice_path, "--output_file", str(out)]
    if speaker_id is not None:
        cmd.extend(["--speaker", str(speaker_id)])
    sp.run(cmd, input=text.encode(), check=True, capture_output=True)


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / w.getframerate()


def atempo_chain(ratio: float) -> str:
    chain = []
    while ratio > 2.0:
        chain.append("atempo=2.0"); ratio /= 2.0
    while ratio < 0.5:
        chain.append("atempo=0.5"); ratio /= 0.5
    chain.append(f"atempo={ratio:.3f}")
    return ",".join(chain)


def apply_pitch(in_wav: Path, out_wav: Path, cents: int) -> None:
    """Pitch shift via asetrate + atempo (mantiene la durata).
    No-op se cents=0 (solo trans-codifica per uniformità output)."""
    if cents == 0:
        sp.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(in_wav),
                "-ar", str(SAMPLE_RATE), "-ac", "1", str(out_wav)], check=True)
        return
    r = 2 ** (cents / 1200)
    inv = max(0.5, min(2.0, 1 / r))
    sp.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(in_wav),
            "-filter:a", f"asetrate={SAMPLE_RATE}*{r:.5f},aresample={SAMPLE_RATE},atempo={inv:.5f}",
            "-ar", str(SAMPLE_RATE), "-ac", "1", str(out_wav)], check=True)


def _setup_lang_dir(lang: str) -> None:
    """piper-voices/<lang>/ con symlink alle SOLE voci di quella lingua
    (es. 'en' → en_US-*/en_GB-*, 'fr' → fr_FR-*). build_voice_pool si
    aspetta voices_path/<lang>/*.onnx."""
    lang_dir = Path(VOICES_PATH) / lang
    lang_dir.mkdir(parents=True, exist_ok=True)
    for onnx in Path(VOICES_PATH).glob(f"{lang}_*.onnx"):
        for fn in (onnx.name, onnx.name + ".json"):
            link = lang_dir / fn
            if not link.exists():
                link.symlink_to(Path("..") / fn)


def dub_one(lang: str, sm: dict, tx: dict) -> str | None:
    """Genera dubbed_<lang>.m4a dai segmenti tradotti `transcript_<lang>`."""
    segs = sm.get(f"transcript_{lang}", [])
    text_key = f"text_{lang}"
    if not segs:
        print(f"[{lang}] transcript_{lang} vuoto — skip")
        return None
    _setup_lang_dir(lang)
    try:
        pool = vp.build_voice_pool(VOICES_PATH, lang, pitch_variants=(0, -300, +300), multispeaker_limit=20)
    except FileNotFoundError as e:
        print(f"[{lang}] nessuna voce Piper ({e}) — skip")
        return None
    duration = max((s["end"] for s in segs), default=0)

    speakers = tx.get("speakers", [])
    names = sm.get("speakers_named") or {}
    for sp_row in speakers:
        if not sp_row.get("displayName"):
            n = names.get(sp_row["diarLabel"])
            if isinstance(n, str) and n.strip():
                sp_row["displayName"] = n
    display_names = [s.get("displayName") or "" for s in speakers]
    gender_map = ng.name_gender_map(display_names)
    voice_map = vp.assign_voices(speakers, pool, name_gender=gender_map)
    print(f"[{lang}] pool={len(pool)} voci; dubbing {len(segs)} segmenti, dur {duration:.0f}s; "
          f"assign={ {k: v.voice_id for k, v in voice_map.items()} }")

    out_wav, out_m4a = f"dubbed_{lang}.wav", f"dubbed_{lang}.m4a"
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        parts: list[tuple[float, Path]] = []
        for i, s in enumerate(segs):
            text = (s.get(text_key) or "").strip()
            if not text:
                continue
            target = s["end"] - s["start"]
            if target < 0.3:
                continue
            entry = voice_map.get(s.get("speaker") or "", pool[0])
            raw = td / f"seg{i:04d}_raw.wav"
            piper_say(text, raw, voice_path=entry.voice_path, speaker_id=entry.speaker_id)
            pitched = td / f"seg{i:04d}_pitch.wav"
            apply_pitch(raw, pitched, entry.pitch_cents)
            d = wav_duration(pitched)
            stretched = td / f"seg{i:04d}_fit.wav"
            if d > target * 1.05:
                sp.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(pitched),
                        "-filter:a", atempo_chain(d / target),
                        "-ar", str(SAMPLE_RATE), "-ac", "1", str(stretched)], check=True)
            else:
                stretched = pitched
            parts.append((s["start"], stretched))
        silence = td / "silence.wav"
        sp.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-t", str(duration + 5),
                "-i", f"anullsrc=channel_layout=mono:sample_rate={SAMPLE_RATE}",
                "-c:a", "pcm_s16le", str(silence)], check=True)
        inputs = ["-i", str(silence)]
        filters: list[str] = []
        amix_inputs = ["[0:a]"]
        for k, (start, path) in enumerate(parts, start=1):
            inputs.extend(["-i", str(path)])
            delay_ms = int(start * 1000)
            filters.append(f"[{k}:a]adelay={delay_ms}|{delay_ms},apad[a{k}]")
            amix_inputs.append(f"[a{k}]")
        filt = ";".join(filters + ["".join(amix_inputs) + f"amix=inputs={len(amix_inputs)}:duration=longest:normalize=0[out]"])
        sp.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", filt, "-map", "[out]",
                "-ac", "1", "-ar", str(SAMPLE_RATE), "-t", str(duration + 1), out_wav], check=True)
    sp.run(["ffmpeg", "-y", "-loglevel", "error", "-i", out_wav, "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart", out_m4a], check=True)
    print(f"[{lang}] -> {out_m4a}")
    return out_m4a


def main() -> None:
    with open(SUMMARY_IN) as f:
        sm = json.load(f)
    with open(TX_IN) as f:
        tx = json.load(f)
    langs = sm.get("target_langs") or ["en"]
    for lang in langs:
        dub_one(lang, sm, tx)


if __name__ == "__main__":
    main()
