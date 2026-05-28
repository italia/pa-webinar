#!/usr/bin/env python3
"""
Dubbing sintetico EN con Piper TTS (voce neutra, no cloning).

Input:  summary.json (transcript_en)
Output: dubbed_en.wav (mono 22050, sincronizzato cue-to-cue con sorgente)
        + dubbed_en.m4a (compresso AAC per delivery)

Strategia di sync:
- Genera il TTS di OGNI segmento separatamente.
- Time-stretch (rubberband o atempo di ffmpeg) ogni clip per farla
  rientrare nell'intervallo [start, end] del segmento originale.
- Concatena tutti i clip in una traccia continua, paddata con silenzio.
"""
from __future__ import annotations
import json
import subprocess as sp
import tempfile
import wave
from pathlib import Path

VOICE = "piper-voices/en_US-lessac-medium.onnx"
SAMPLE_RATE = 22050
SUMMARY_IN = "summary.json"
OUT_WAV = "dubbed_en.wav"
OUT_M4A = "dubbed_en.m4a"


def piper_say(text: str, out: Path) -> None:
    # piper CLI accetta stdin (testo) e scrive su stdout (WAV)
    p = sp.run(
        ["piper", "--model", VOICE, "--output_file", str(out)],
        input=text.encode(),
        check=True,
        capture_output=True,
    )


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / w.getframerate()


def atempo_chain(ratio: float) -> str:
    """ffmpeg atempo accetta 0.5..100; concateno se servono ratio estremi."""
    chain = []
    while ratio > 2.0:
        chain.append("atempo=2.0")
        ratio /= 2.0
    while ratio < 0.5:
        chain.append("atempo=0.5")
        ratio /= 0.5
    chain.append(f"atempo={ratio:.3f}")
    return ",".join(chain)


def main():
    with open(SUMMARY_IN) as f:
        sm = json.load(f)
    segs = sm.get("transcript_en", [])
    if not segs:
        raise SystemExit("transcript_en vuoto — esegui prima summarize.py")
    duration = max((s["end"] for s in segs), default=0)
    print(f"Dubbing {len(segs)} segments, target duration {duration:.0f}s")

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        parts = []
        for i, s in enumerate(segs):
            text_en = (s.get("text_en") or "").strip()
            if not text_en:
                continue
            target = s["end"] - s["start"]
            if target < 0.3:
                continue
            raw = td / f"seg{i:04d}_raw.wav"
            piper_say(text_en, raw)
            d = wav_duration(raw)
            # se la voce TTS è più lunga del target, time-stretch up; se più
            # corta, lasciamo (paddiamo dopo). atempo ratio = TTS_len / target.
            stretched = td / f"seg{i:04d}_fit.wav"
            if d > target * 1.05:
                ratio = d / target
                sp.run(
                    [
                        "ffmpeg", "-y", "-loglevel", "error",
                        "-i", str(raw),
                        "-filter:a", atempo_chain(ratio),
                        "-ar", str(SAMPLE_RATE), "-ac", "1",
                        str(stretched),
                    ],
                    check=True,
                )
            else:
                sp.run(
                    [
                        "ffmpeg", "-y", "-loglevel", "error",
                        "-i", str(raw),
                        "-ar", str(SAMPLE_RATE), "-ac", "1",
                        str(stretched),
                    ],
                    check=True,
                )
            parts.append((s["start"], stretched, d, target))
            if (i + 1) % 10 == 0:
                print(f"  segment {i+1}/{len(segs)}")

        # 5. Costruisci la traccia finale con padding di silenzio
        print("Concatenating with silence padding…")
        # Genero un silenzio base lungo `duration` + 5s e lo sovrappongo
        # con amix di ogni clip ritardata via adelay.
        # Più semplice: aconcat segmento_silenzio + clip ripetuti.
        silence = td / "silence.wav"
        sp.run(
            [
                "ffmpeg", "-y", "-loglevel", "error",
                "-f", "lavfi", "-t", str(duration + 5),
                "-i", f"anullsrc=channel_layout=mono:sample_rate={SAMPLE_RATE}",
                "-c:a", "pcm_s16le",
                str(silence),
            ],
            check=True,
        )

        # amix: silence base + clip con adelay (delay in ms, padding finale)
        inputs = ["-i", str(silence)]
        filters = []
        amix_inputs = ["[0:a]"]
        for k, (start, path, *_rest) in enumerate(parts, start=1):
            inputs.extend(["-i", str(path)])
            delay_ms = int(start * 1000)
            filters.append(f"[{k}:a]adelay={delay_ms}|{delay_ms},apad[a{k}]")
            amix_inputs.append(f"[a{k}]")
        amix_concat = "".join(amix_inputs) + f"amix=inputs={len(amix_inputs)}:duration=longest:normalize=0[out]"
        filter_complex = ";".join(filters + [amix_concat])

        sp.run(
            ["ffmpeg", "-y", "-loglevel", "error", *inputs,
             "-filter_complex", filter_complex,
             "-map", "[out]",
             "-ac", "1", "-ar", str(SAMPLE_RATE), "-t", str(duration + 1),
             OUT_WAV],
            check=True,
        )
        print(f"  -> {OUT_WAV}")

    # AAC m4a (delivery)
    sp.run(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-i", OUT_WAV,
         "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
         OUT_M4A],
        check=True,
    )
    print(f"  -> {OUT_M4A}")


if __name__ == "__main__":
    main()
