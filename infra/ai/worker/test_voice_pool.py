"""Assegnazione delle voci del doppiaggio."""
from __future__ import annotations

from .voice_pool import VoiceEntry, assign_voices


def voce(nome: str) -> VoiceEntry:
    return VoiceEntry(voice_path=f"/v/{nome}.onnx", voice_id=nome, speaker_id=None, pitch_cents=0)


def test_assegna_per_tempo_di_parola() -> None:
    pool = [voce("a"), voce("b")]
    voci = assign_voices(
        [
            {"diarLabel": "SPEAKER_00", "totalSpeechSec": 10},
            {"diarLabel": "SPEAKER_01", "totalSpeechSec": 90},
        ],
        pool,
    )
    assert voci["SPEAKER_01"].voice_id == "a"
    assert voci["SPEAKER_00"].voice_id == "b"


def test_il_nome_non_cambia_la_voce() -> None:
    pool = [voce("a"), voce("b")]
    base = {"diarLabel": "SPEAKER_00", "totalSpeechSec": 10}
    assert assign_voices([{**base, "displayName": "Relatore 1"}], pool) == assign_voices([base], pool)


def test_finito_il_pool_le_voci_si_riusano() -> None:
    pool = [voce("a")]
    voci = assign_voices(
        [
            {"diarLabel": "SPEAKER_00", "totalSpeechSec": 2},
            {"diarLabel": "SPEAKER_01", "totalSpeechSec": 1},
        ],
        pool,
    )
    assert voci["SPEAKER_00"] == voci["SPEAKER_01"]
