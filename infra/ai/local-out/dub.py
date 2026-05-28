#!/usr/bin/env python3
"""
Dubbing sintetico EN con Piper TTS — **multivoce**.

A ogni SPEAKER_xx viene assegnata UNA voce sintetica distinta tra
quelle pre-trained pubbliche di Piper. NON è voice cloning: nessuna
imitazione della voce reale. Restano voci sintetiche neutre, fungibili,
identificabili come AI dal listener — l'unica differenza con la V1
single-voice è che si distinguono N parlanti invece di averli tutti
appiattiti su una sola voce.

Trade-off GDPR/AI Act:
- Voci pre-trained pubbliche, dataset open. Niente fingerprint vocale.
- Mapping SPEAKER → voice è arbitrario (sorted-by-speech-time + indice).
  Il listener NON può risalire all'identità reale dalla voce sintetica.
- Stesso disclaimer "AI-generated" del single-voice. Resta `isSynthetic=true`.

Strategia di sync (invariata vs V1):
- TTS per segmento → atempo per match con la finestra temporale →
  amix con padding silenzio.
"""
from __future__ import annotations
import json
import subprocess as sp
import tempfile
import wave
from pathlib import Path

# Pool di voci EN disponibili nella dir piper-voices/. Ordine =
# preferenza di assegnazione (il top speaker prende la voce più
# "central/neutra" — Lessac M neutral; gli altri ruotano). Tutte
# medium-quality (~22kHz), licenza MIT.
EN_VOICE_POOL = [
    "piper-voices/en_US-lessac-medium.onnx",     # M neutral central
    "piper-voices/en_US-amy-medium.onnx",        # F americana
    "piper-voices/en_GB-alan-medium.onnx",       # M britannico
    "piper-voices/en_US-ryan-medium.onnx",       # M giovane
    "piper-voices/en_GB-jenny_dioco-medium.onnx",# F britannica
    "piper-voices/en_US-kristin-medium.onnx",    # F americana
]
SAMPLE_RATE = 22050
SUMMARY_IN = "summary.json"
TX_IN = "transcript_diarized.json"
OUT_WAV = "dubbed_en.wav"
OUT_M4A = "dubbed_en.m4a"


def piper_say(text: str, out: Path, *, voice: str) -> None:
    sp.run(
        ["piper", "--model", voice, "--output_file", str(out)],
        input=text.encode(), check=True, capture_output=True,
    )


def assign_voices(transcript: dict) -> dict[str, str]:
    """Mapping SPEAKER_xx → voice path.

    Ordina gli speaker per tempo di parola decrescente e li assegna
    alle voci del pool nell'ordine di preferenza. Lo speaker che parla
    di più prende la voce "central" (Lessac neutral M); a seguire le
    altre. Il mapping è deterministico (stessa input → stesso mapping).
    """
    speakers = sorted(
        transcript.get("speakers", []),
        key=lambda s: -s.get("totalSpeechSec", 0),
    )
    mapping = {}
    for i, sp_row in enumerate(speakers):
        mapping[sp_row["diarLabel"]] = EN_VOICE_POOL[i % len(EN_VOICE_POOL)]
    return mapping


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
    with open(TX_IN) as f:
        tx = json.load(f)
    segs = sm.get("transcript_en", [])
    if not segs:
        raise SystemExit("transcript_en vuoto — esegui prima summarize.py")
    duration = max((s["end"] for s in segs), default=0)

    voice_map = assign_voices(tx)
    print(f"Dubbing {len(segs)} segments, target duration {duration:.0f}s")
    print("Voice assignment (most spoken first):")
    for sp_label, voice in sorted(voice_map.items(), key=lambda x: x[0]):
        print(f"  {sp_label} → {Path(voice).stem}")

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
            # Voce per il segmento = voce assegnata allo speaker.
            # Se lo speaker non è mappato (caso outlier), fallback Lessac.
            voice = voice_map.get(s.get("speaker"), EN_VOICE_POOL[0])
            raw = td / f"seg{i:04d}_raw.wav"
            piper_say(text_en, raw, voice=voice)
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
