"""Test dei fallback robusti di transcribe (diarization best-effort).

Coprono il bug che bruciava i nodi A100: token HF segnaposto →
pyannote `Pipeline.from_pretrained` ritorna None → `.to()` esplode. Ora
la diarization degrada a single-speaker invece di far fallire il job.
Sono funzioni pure: nessuna GPU / nessun whisperx caricato.
"""

import transcribe as tr


def test_hf_token_usable():
    assert tr._hf_token_usable("hf_" + "a" * 34) is True
    # Il segnaposto cablato di default nel secret.
    assert tr._hf_token_usable("stub-hf-token") is False
    assert tr._hf_token_usable("") is False
    assert tr._hf_token_usable(None) is False
    assert tr._hf_token_usable("hf_short") is False  # troppo corto
    assert tr._hf_token_usable("ghp_notanhftoken1234567890") is False


def test_single_speaker_segments():
    aligned = {
        "segments": [
            {"start": 0.0, "end": 1.0, "text": "ciao"},
            {"start": 1.0, "end": 2.0, "text": "mondo"},
        ]
    }
    out = tr._single_speaker_segments(aligned)
    assert [s["speaker"] for s in out] == ["SPEAKER_00", "SPEAKER_00"]
    assert out[0]["text"] == "ciao"
    # non muta i dict di input
    assert "speaker" not in aligned["segments"][0]


def test_single_speaker_segments_empty():
    assert tr._single_speaker_segments({"segments": []}) == []
    assert tr._single_speaker_segments({}) == []


def test_diarize_segments_skips_without_valid_token():
    aligned = {"segments": [{"start": 0.0, "end": 1.0, "text": "x"}]}
    # whisperx=None: col token non valido la funzione ritorna PRIMA di
    # toccare whisperx — nessuna AttributeError, solo single-speaker.
    out = tr._diarize_segments(
        None, aligned, None,
        hf_token="stub-hf-token", expected_speakers=None, device="cpu",
    )
    assert [s["speaker"] for s in out] == ["SPEAKER_00"]


def test_diarize_segments_falls_back_on_pyannote_error():
    aligned = {"segments": [{"start": 0.0, "end": 1.0, "text": "x"}]}

    class BoomWhisperx:
        def DiarizationPipeline(self, **_kw):
            raise RuntimeError("pyannote unreachable")

    out = tr._diarize_segments(
        BoomWhisperx(), aligned, object(),
        hf_token="hf_" + "a" * 34, expected_speakers=2, device="cpu",
    )
    assert [s["speaker"] for s in out] == ["SPEAKER_00"]


def test_diarize_segments_uses_pyannote_result_when_ok():
    aligned = {"segments": [{"start": 0.0, "end": 1.0, "text": "x"}]}

    class OkWhisperx:
        def DiarizationPipeline(self, **_kw):
            return lambda *a, **k: {"diar": True}

        def assign_word_speakers(self, _diar, _aligned):
            return {
                "segments": [
                    {"start": 0.0, "end": 1.0, "text": "x", "speaker": "SPEAKER_01"}
                ]
            }

    out = tr._diarize_segments(
        OkWhisperx(), aligned, object(),
        hf_token="hf_" + "a" * 34, expected_speakers=None, device="cpu",
    )
    assert out[0]["speaker"] == "SPEAKER_01"
