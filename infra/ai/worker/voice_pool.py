"""
Catalogo voci Piper + pool builder per il dubbing multivoce.

Due estensioni rispetto al pool naïve "una voce = un .onnx":

  1) **Pitch variants**. Quando il pool non basta (es. lingue povere
     come IT con 2 sole voci), generiamo varianti da una stessa voce
     applicando un pitch shift di ±N cents in post. Una voce con 3
     pitch (−5, 0, +5%) diventa 3 timbri distinti. Implementazione del
     pitch shift in `tts.py` con `ffmpeg asetrate + atempo` (preserva
     durata).

  2) **Multi-speaker support (VCTK/libritts_r)**. I dataset open
     multi-speaker hanno una singola `.onnx` che espone N voci interne
     selezionabili via `speaker_id`. Il pool builder le espande
     automaticamente: con `en_GB-vctk-medium.onnx` aggiungiamo 109
     voci EN GB. **NOTA V1**: per ora carichiamo solo le prime
     ~20 voci di un multi-speaker (limite di praticità: caricare 109
     PiperVoice in memoria pesa). Sufficiente per cast >12 senza ricorso
     al pitch variant.

La voce non dice niente sulla persona: si assegna per tempo di parola, senza
guardare il nome.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class VoiceEntry:
    """Una voce del pool. Identifica univocamente un timbro nel dub."""
    voice_path: str            # path al file .onnx
    voice_id: str              # nome stabile per audit, es. "lessac" o "vctk:p234"
    speaker_id: Optional[int]  # None per single-speaker; int per VCTK/libritts
    pitch_cents: int           # 0 = nessuno shift; ±100 ~ semitono


def voice_id_from_path(path: Path) -> str:
    """Estrae il voice_id stabile dal nome file Piper.

    `en_US-lessac-medium.onnx` → `lessac`
    `en_GB-vctk-medium.onnx`   → `vctk`
    """
    stem = path.stem  # rimuove .onnx
    parts = stem.split("-")
    # formato: <langcode>-<voice>-<quality>
    if len(parts) >= 3:
        return parts[1]
    return stem


def build_voice_pool(
    voices_path: str,
    language: str,
    *,
    pitch_variants: tuple[int, ...] = (0,),
    multispeaker_limit: int = 20,
) -> list[VoiceEntry]:
    """Costruisce il pool di tutte le voci utilizzabili per `language`.

    Espansione, in ordine:
      1. file `.onnx` nella dir → single-speaker entries (uno per file)
      2. multi-speaker `.onnx` (num_speakers > 1 nel .json) → fino a
         `multispeaker_limit` entries con speaker_id distinto
      3. per ogni entry sopra, le `pitch_variants` aggiungono varianti

    Es: pool con 6 single-speaker voci + 1 multispeaker da 109 +
    pitch_variants=(0, -300, +300) → 6 single + 20 multispeaker = 26
    timbri base; × 3 pitch = **78 timbri distinti**.
    """
    lang_dir = Path(voices_path) / language
    if not lang_dir.is_dir():
        raise FileNotFoundError(f"No Piper voice dir for {language} at {lang_dir}")

    # Raccolgo prima tutte le "identità" (voce-base × speaker_id), poi
    # le espando per pitch variant **in modo che il pool sia
    # raggruppato per pitch_cents**: prima tutte le entry pitch=0, poi
    # tutte le pitch=−300, poi le +300. Questo garantisce che
    # assign_voices esaurisca prima le voci-base distinte (timbri
    # naturalmente diversi) e solo dopo ricorra alle varianti pitched
    # (timbri derivati). Risultato: con 24 voci nel pool e 3 speaker,
    # ognuno riceve una voce-base diversa, non "voce-X-with-pitch-Y" × 3.
    identities: list[tuple[str, str, Optional[int]]] = []
    # (voice_path, voice_id, speaker_id)
    for onnx_path in sorted(lang_dir.glob("*.onnx")):
        cfg_path = Path(str(onnx_path) + ".json")
        if not cfg_path.exists():
            log.warning("no .onnx.json for %s, skipping", onnx_path)
            continue
        with open(cfg_path) as f:
            cfg = json.load(f)
        num_speakers = int(cfg.get("num_speakers") or 1)
        base_id = voice_id_from_path(onnx_path)

        if num_speakers == 1:
            identities.append((str(onnx_path), base_id, None))
        else:
            for sid in range(min(num_speakers, multispeaker_limit)):
                vid = f"{base_id}:{sid:03d}"
                identities.append((str(onnx_path), vid, sid))

    entries: list[VoiceEntry] = []
    for pc in pitch_variants:
        for path_, vid, sid in identities:
            suffix = "" if pc == 0 else f"{'+' if pc > 0 else ''}{pc}c"
            entries.append(VoiceEntry(
                voice_path=path_,
                voice_id=vid + suffix,
                speaker_id=sid,
                pitch_cents=pc,
            ))

    if not entries:
        raise FileNotFoundError(f"empty voice pool for {language}")
    return entries


def assign_voices(
    speakers: list[dict],
    pool: list[VoiceEntry],
) -> dict[str, VoiceEntry]:
    """Assegna a ogni `SPEAKER_xx` un `VoiceEntry`. Deterministico.

    - `speakers`: lista di Speaker rows (`{diarLabel, totalSpeechSec}`).
    - `pool`: prodotto di `build_voice_pool`.

    Ordina gli speaker per tempo di parola decrescente e da' a ciascuno la
    prossima voce del pool: prima le voci-base, poi le varianti. Finito il
    pool, le voci si riusano dall'inizio.
    """
    ordered = sorted(speakers, key=lambda s: -float(s.get("totalSpeechSec") or 0))
    return {
        sp["diarLabel"]: pool[i % len(pool)]
        for i, sp in enumerate(ordered)
    }
