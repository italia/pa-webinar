"""
Catalogo voci Piper + pool builder per il dubbing multivoce.

Tre estensioni rispetto al pool naïve "una voce = un .onnx":

  1) **Catalogo gender-aware**. Ogni voce ha un attributo `gender` =
     `"M" | "F" | "N"`. Permette `assign_voices` di scegliere una voce
     coerente col gender del nome reale dello speaker (Alex → M,
     Ilaria → F). Voci `N` (neutre/sconosciute) usate come fallback
     per nomi neutri o non identificati.

  2) **Pitch variants**. Quando il pool non basta (es. lingue povere
     come IT con 2 sole voci), generiamo varianti da una stessa voce
     applicando un pitch shift di ±N cents in post. Una voce con 3
     pitch (−5, 0, +5%) diventa 3 timbri distinti, ognuno mantenendo
     la stessa identità di gender. Implementazione del pitch shift in
     `tts.py` con `ffmpeg asetrate + atempo` (preserva durata).

  3) **Multi-speaker support (VCTK/libritts_r)**. I dataset open
     multi-speaker hanno una singola `.onnx` che espone N voci interne
     selezionabili via `speaker_id`. Il pool builder le espande
     automaticamente: con `en_GB-vctk-medium.onnx` aggiungiamo 109
     voci EN GB. Il gender per ogni speaker_id arriva da `data/`
     (CSV mantenuto fuori dal codice). Se manca, lo speaker viene
     trattato come `N`. **NOTA V1**: per ora carichiamo solo le prime
     ~20 voci di un multi-speaker (limite di praticità: caricare 109
     PiperVoice in memoria pesa). Sufficiente per cast >12 senza ricorso
     al pitch variant.
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
    gender: str                # "M" | "F" | "N"
    speaker_id: Optional[int]  # None per single-speaker; int per VCTK/libritts
    pitch_cents: int           # 0 = nessuno shift; ±100 ~ semitono


# Catalogo gender per le voci single-speaker più comuni di Piper.
# Manutenuto a mano (Piper non espone gender nei metadata). Mantenuto
# minuscolo per match case-insensitive sui voice_id Piper. Nuove voci
# vanno aggiunte qui prima di poter essere usate in modalità
# gender-aware.
SINGLE_SPEAKER_GENDER: dict[str, str] = {
    # en_US — M
    "lessac": "M", "ryan": "M", "joe": "M", "john": "M",
    "danny": "M", "bryce": "M", "norman": "M", "kusal": "M",
    "arctic": "M", "sam": "M", "hfc_male": "M",
    # en_US — F
    "amy": "F", "kristin": "F", "kathleen": "F", "ljspeech": "F",
    "hfc_female": "F", "libritts_r": "N",  # multispeaker; vedi multi
    # en_GB — M
    "alan": "M", "northern_english_male": "M",
    # en_GB — F
    "jenny_dioco": "F", "alba": "F", "cori": "F", "aru": "F",
    "southern_english_female": "F", "semaine": "F",
    # it_IT
    "paola": "F", "riccardo": "M",
    # de_DE
    "thorsten": "M", "ramona": "F", "kerstin": "F", "eva_k": "F",
    "karlsson": "M", "pavoque": "M",
    # fr_FR
    "tom": "M", "siwis": "F", "gilles": "M", "upmc-pierre": "M",
    "upmc-jessica": "F",
    # es_ES / es_MX
    "davefx": "M", "sharvard": "M", "carlfm": "M",
    # nl_NL
    "mls_5809": "F", "mls_7432": "M",
    # pt_PT / pt_BR
    "tugão": "M", "edresson": "M", "faber": "M",
}


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


def gender_of_voice(voice_id: str) -> str:
    """Restituisce M/F/N. Match case-insensitive."""
    return SINGLE_SPEAKER_GENDER.get(voice_id.lower(), "N")


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

    Tutte le varianti di una stessa identità (es. paola con pitch
    diversi) ereditano il gender della voce sorgente.
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
    # (timbri derivati). Risultato: con 24 voci M nel pool e 3 speaker
    # M, ognuno riceve una voce-base diversa, non "voce-X-with-pitch-Y"
    # × 3.
    identities: list[tuple[str, str, str, Optional[int]]] = []
    # (voice_path, voice_id, gender, speaker_id)
    for onnx_path in sorted(lang_dir.glob("*.onnx")):
        cfg_path = Path(str(onnx_path) + ".json")
        if not cfg_path.exists():
            log.warning("no .onnx.json for %s, skipping", onnx_path)
            continue
        with open(cfg_path) as f:
            cfg = json.load(f)
        num_speakers = int(cfg.get("num_speakers") or 1)
        base_id = voice_id_from_path(onnx_path)
        gender = gender_of_voice(base_id)

        if num_speakers == 1:
            identities.append((str(onnx_path), base_id, gender, None))
        else:
            # Multi-speaker (VCTK / libritts_r): gender non noto per
            # ogni speaker_id senza metadata esterno. V1: tutti `N`
            # (fallback) — l'eterogeneità del dataset (es. vctk
            # bilanciato M/F) dà comunque un mix sensato. V2: file
            # `data/<voice>_genders.csv` con mapping per speaker_id.
            for sid in range(min(num_speakers, multispeaker_limit)):
                vid = f"{base_id}:{sid:03d}"
                identities.append((str(onnx_path), vid, "N", sid))

    entries: list[VoiceEntry] = []
    for pc in pitch_variants:
        for path_, vid, gender, sid in identities:
            suffix = "" if pc == 0 else f"{'+' if pc > 0 else ''}{pc}c"
            entries.append(VoiceEntry(
                voice_path=path_,
                voice_id=vid + suffix,
                gender=gender,
                speaker_id=sid,
                pitch_cents=pc,
            ))

    if not entries:
        raise FileNotFoundError(f"empty voice pool for {language}")
    return entries


def assign_voices(
    speakers: list[dict],
    pool: list[VoiceEntry],
    *,
    name_gender: Optional[dict[str, str]] = None,
) -> dict[str, VoiceEntry]:
    """Assegna a ogni `SPEAKER_xx` un `VoiceEntry`. Deterministico.

    - `speakers`: lista di Speaker rows (`{diarLabel, displayName,
      totalSpeechSec}`).
    - `pool`: prodotto di `build_voice_pool`.
    - `name_gender`: mapping `displayName.lower() → "M"|"F"|"N"` già
      risolto (l'inferenza vive in `name_gender.py`).

    Ordina gli speaker per tempo di parola decrescente. Per ognuno:
      1. determina gender atteso (da `displayName` via `name_gender`)
      2. sceglie la prossima entry non-utilizzata che matcha il gender;
         se non c'è, fallback alla prossima entry generica.

    Se non c'è displayName o il gender è `N`, fallback alla prossima
    entry generica.
    """
    name_gender = name_gender or {}
    ordered = sorted(speakers, key=lambda s: -float(s.get("totalSpeechSec") or 0))

    # Code separate per F / M / N per matching efficiente.
    queues = {"M": [v for v in pool if v.gender == "M"],
              "F": [v for v in pool if v.gender == "F"],
              "N": [v for v in pool if v.gender == "N"]}
    fallback_queue = list(pool)  # consumiamo da qui se le code sopra finiscono

    assigned: dict[str, VoiceEntry] = {}
    used: set[str] = set()

    def pop_from(g: str) -> Optional[VoiceEntry]:
        while queues[g]:
            v = queues[g].pop(0)
            if v.voice_id not in used:
                used.add(v.voice_id)
                return v
        return None

    def pop_fallback() -> VoiceEntry:
        while fallback_queue:
            v = fallback_queue.pop(0)
            if v.voice_id not in used:
                used.add(v.voice_id)
                return v
        # pool esaurito → ricicliamo
        for g in ("M", "F", "N"):
            for v in pool:
                if v.gender == g:
                    return v
        return pool[0]

    for sp in ordered:
        diar_label = sp["diarLabel"]
        display = (sp.get("displayName") or "").strip()
        if not display:
            wanted = "N"
        else:
            first_name = display.split()[0]
            wanted = name_gender.get(first_name.lower(), "N")

        chosen = None
        if wanted in ("M", "F"):
            chosen = pop_from(wanted)
            # se la coda di un genere è finita ma esistono varianti
            # pitch di voci di quel genere, riusale (più voci-base usate
            # con pitch diverso valgono come varianti coerenti).
            if chosen is None:
                # consumiamo dalle voci del pool con gender matching,
                # anche se già usate (riciclo controllato).
                for v in pool:
                    if v.gender == wanted:
                        chosen = v
                        break
        if chosen is None:
            chosen = pop_fallback()
        assigned[diar_label] = chosen
    return assigned
