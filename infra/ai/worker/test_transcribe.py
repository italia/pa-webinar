"""Test dei fallback robusti di transcribe (diarization best-effort).

Coprono il bug che bruciava i nodi A100: token HF segnaposto →
pyannote `Pipeline.from_pretrained` ritorna None → `.to()` esplode. Ora
la diarization degrada a single-speaker invece di far fallire il job.
Sono funzioni pure: nessuna GPU / nessun whisperx caricato.
"""

import sys

import transcribe as tr


# ---------------------------------------------------------------------------
# Fake whisperx — niente GPU, niente pesi. Conta i load per verificare il
# riuso dei modelli tra le tracce (audit #6). Iniettato in sys.modules così
# l'`import whisperx` locale dentro transcribe.py lo raccoglie.
# ---------------------------------------------------------------------------


class _FakeWhisperx:
    def __init__(self):
        self.load_model_calls = 0
        self.load_align_calls = []  # lingue richieste, in ordine

    def load_model(self, model_id, device, compute_type=None, asr_options=None):
        self.load_model_calls += 1
        asr = _FakeASR()
        asr.model_id = model_id
        return asr

    def load_align_model(self, language_code=None, device=None):
        self.load_align_calls.append(language_code)
        return (f"align-model-{language_code}", {"lang": language_code})

    def load_audio(self, path):
        return f"audio:{path}"

    def align(self, segments, align_model, metadata, audio, device, return_char_alignments=False):
        # Echo dei segmenti (l'allineamento non cambia il testo nei test).
        return {"segments": [dict(s) for s in segments]}


class _FakeASR:
    model_id = "stub"

    def transcribe(self, audio, language=None, batch_size=16):
        # Una battuta per traccia; rispetta la lingua passata (hint).
        return {
            "language": language or "it",
            "segments": [{"start": 0.0, "end": 1.0, "text": "ciao", "avg_logprob": -0.1, "no_speech_prob": 0.0}],
        }


def _install_fake_whisperx(monkeypatch):
    fake = _FakeWhisperx()
    monkeypatch.setitem(sys.modules, "whisperx", fake)
    return fake


def test_single_track_wrapper_loads_then_calls(monkeypatch):
    """Il wrapper single-track resta load-then-call: 1 ASR + 1 align."""
    fake = _install_fake_whisperx(monkeypatch)
    out = tr.transcribe_single_speaker(
        "/tmp/t.wav", language_hint="it", asr_model_id="large-v3"
    )
    assert fake.load_model_calls == 1
    assert fake.load_align_calls == ["it"]
    assert out["language"] == "it"
    assert out["segments"][0]["text"] == "ciao"
    assert out["segments"][0]["start"] == 0.0


def test_multitrack_reuses_asr_and_memoizes_align(monkeypatch):
    """Pattern multitrack: K tracce → load_model UNA volta, align per lingua.

    Replica il contratto di riuso usato da run_transcribe_multitrack:
    carica l'ASR una sola volta prima del loop e memoizza l'align per lingua
    via callback. Verifica che gli output per-traccia restino invariati.
    """
    fake = _install_fake_whisperx(monkeypatch)

    K = 5
    asr_model = tr.load_asr_model("large-v3")
    align_cache = {}

    def get_align(language):
        if language not in align_cache:
            align_cache[language] = tr.load_align_model(language)
        return align_cache[language]

    outputs = []
    for i in range(K):
        outputs.append(
            tr.transcribe_single_speaker_with_models(
                f"/tmp/track-{i}.wav",
                asr=asr_model,
                get_align_model=get_align,
                language_hint="it",
            )
        )

    # ASR caricato UNA volta per K tracce (non K volte).
    assert fake.load_model_calls == 1
    # Align memoizzato: tutte le tracce condividono "it" → un solo load.
    assert fake.load_align_calls == ["it"]
    # Output per-traccia invariato vs. il path classico.
    for out in outputs:
        assert out["language"] == "it"
        assert out["segments"][0]["text"] == "ciao"


def test_multitrack_align_memoized_per_language(monkeypatch):
    """Tracce con lingue diverse → un load align PER lingua distinta."""
    fake = _install_fake_whisperx(monkeypatch)
    asr_model = tr.load_asr_model("large-v3")
    align_cache = {}

    def get_align(language):
        if language not in align_cache:
            align_cache[language] = tr.load_align_model(language)
        return align_cache[language]

    # 4 tracce: it, it, en, it → align caricato per "it" una volta e "en" una.
    for lang in ["it", "it", "en", "it"]:
        tr.transcribe_single_speaker_with_models(
            "/tmp/x.wav", asr=asr_model, get_align_model=get_align, language_hint=lang
        )

    assert fake.load_model_calls == 1
    assert fake.load_align_calls == ["it", "en"]


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
