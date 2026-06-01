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


def main() -> None:
    with open(SUMMARY_IN) as f:
        sm = json.load(f)
    with open(TX_IN) as f:
        tx = json.load(f)
    segs = sm.get("transcript_en", [])
    if not segs:
        raise SystemExit("transcript_en vuoto — esegui prima summarize.py")
    duration = max((s["end"] for s in segs), default=0)

    # Pool (single-speaker delle 16 onnx scaricate + pitch variants).
    # Per il setup locale la "dir lang" è piatta, dato che ho tutto in
    # piper-voices/. Il builder si aspetta voices_path/<lang>/, quindi
    # creo simlink (idempotente) prima di chiamarlo.
    lang_dir = Path(VOICES_PATH) / LANGUAGE
    lang_dir.parent.mkdir(parents=True, exist_ok=True)
    if not lang_dir.exists():
        # creo dir e copio-symlinko tutti gli onnx dentro
        lang_dir.mkdir()
        for onnx in Path(VOICES_PATH).glob("*.onnx"):
            (lang_dir / onnx.name).symlink_to(Path("..") / onnx.name)
            cfg = Path(str(onnx) + ".json")
            (lang_dir / cfg.name).symlink_to(Path("..") / cfg.name)

    pool = vp.build_voice_pool(VOICES_PATH, LANGUAGE,
                               pitch_variants=(0, -300, +300),
                               multispeaker_limit=20)

    speakers = tx.get("speakers", [])
    # innesto displayName dai speakers_named
    names = sm.get("speakers_named") or {}
    for sp_row in speakers:
        if not sp_row.get("displayName"):
            n = names.get(sp_row["diarLabel"])
            if isinstance(n, str) and n.strip():
                sp_row["displayName"] = n

    display_names = [s.get("displayName") or "" for s in speakers]
    gender_map = ng.name_gender_map(display_names)
    voice_map = vp.assign_voices(speakers, pool, name_gender=gender_map)

    print(f"Pool: {len(pool)} entries (gender-aware + pitch variants)")
    print("Gender inference:")
    for k, v in gender_map.items():
        print(f"  {k}: {v}")
    print("Voice assignment:")
    for sp_label, entry in sorted(voice_map.items(), key=lambda x: x[0]):
        dname = next((s.get("displayName") for s in speakers if s["diarLabel"] == sp_label), None)
        print(f"  {sp_label} ({dname or '?'}, {entry.gender}) → {entry.voice_id}  pitch={entry.pitch_cents}c sid={entry.speaker_id}")

    print(f"Dubbing {len(segs)} segments, target duration {duration:.0f}s")

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        parts: list[tuple[float, Path]] = []
        for i, s in enumerate(segs):
            text_en = (s.get("text_en") or "").strip()
            if not text_en:
                continue
            target = s["end"] - s["start"]
            if target < 0.3:
                continue
            entry = voice_map.get(s.get("speaker") or "", pool[0])

            raw = td / f"seg{i:04d}_raw.wav"
            piper_say(text_en, raw, voice_path=entry.voice_path, speaker_id=entry.speaker_id)

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
            if (i + 1) % 20 == 0:
                print(f"  segment {i + 1}/{len(segs)}")

        # Mix con silenzio base + adelay
        print("Concatenating with silence padding…")
        silence = td / "silence.wav"
        sp.run(["ffmpeg", "-y", "-loglevel", "error",
                "-f", "lavfi", "-t", str(duration + 5),
                "-i", f"anullsrc=channel_layout=mono:sample_rate={SAMPLE_RATE}",
                "-c:a", "pcm_s16le", str(silence)], check=True)

        inputs = ["-i", str(silence)]
        filters = []
        amix_inputs = ["[0:a]"]
        for k, (start, path) in enumerate(parts, start=1):
            inputs.extend(["-i", str(path)])
            delay_ms = int(start * 1000)
            filters.append(f"[{k}:a]adelay={delay_ms}|{delay_ms},apad[a{k}]")
            amix_inputs.append(f"[a{k}]")
        filt = ";".join(filters + ["".join(amix_inputs) + f"amix=inputs={len(amix_inputs)}:duration=longest:normalize=0[out]"])
        sp.run(["ffmpeg", "-y", "-loglevel", "error", *inputs,
                "-filter_complex", filt, "-map", "[out]",
                "-ac", "1", "-ar", str(SAMPLE_RATE), "-t", str(duration + 1),
                OUT_WAV], check=True)
        print(f"  -> {OUT_WAV}")

    sp.run(["ffmpeg", "-y", "-loglevel", "error", "-i", OUT_WAV,
            "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", OUT_M4A], check=True)
    print(f"  -> {OUT_M4A}")


if __name__ == "__main__":
    main()
