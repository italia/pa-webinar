"""Test della risoluzione del path voci Piper (fallback all'immagine).

Garantisce che il DUB usi le voci bakate in /opt/piper-voices quando il
path configurato (es. /models/piper su emptyDir non seedato) è vuoto —
così il job non fallisce con FileNotFoundError.
"""

import tts


def test_has_voice(tmp_path):
    en = tmp_path / "en"
    en.mkdir()
    assert tts._has_voice(str(tmp_path), "en") is False  # dir ma nessun .onnx
    (en / "en_US-lessac-medium.onnx").write_bytes(b"x")
    assert tts._has_voice(str(tmp_path), "en") is True
    assert tts._has_voice(str(tmp_path), "fr") is False  # lingua assente
    assert tts._has_voice("", "en") is False


def test_resolve_prefers_configured(tmp_path):
    cfg = tmp_path / "cfg"
    (cfg / "en").mkdir(parents=True)
    (cfg / "en" / "v.onnx").write_bytes(b"x")
    assert tts.resolve_voices_path(str(cfg), "en") == str(cfg)


def test_resolve_falls_back_to_baked(tmp_path, monkeypatch):
    baked = tmp_path / "baked"
    (baked / "fr").mkdir(parents=True)
    (baked / "fr" / "v.onnx").write_bytes(b"x")
    monkeypatch.setattr(tts, "BAKED_VOICES_PATH", str(baked))
    # configured non esiste/vuoto → fallback alle voci bakate
    assert tts.resolve_voices_path(str(tmp_path / "empty"), "fr") == str(baked)


def test_resolve_returns_configured_when_nothing_available(tmp_path, monkeypatch):
    # Né configured né baked hanno voci → ritorna configured così
    # build_voice_pool solleva l'errore originale chiaro.
    monkeypatch.setattr(tts, "BAKED_VOICES_PATH", str(tmp_path / "nobaked"))
    cfg = str(tmp_path / "nocfg")
    assert tts.resolve_voices_path(cfg, "de") == cfg
