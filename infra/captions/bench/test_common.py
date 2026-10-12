"""Test delle parti del banco di prova che non richiedono il motore."""

import array
import struct

import pytest

from common import corpus_wer, edit_distance, normalize_words, parse_wav, percentile, write_wav
from prepare import speech_bounds


def test_normalize_keeps_inner_apostrophes_and_drops_punctuation():
    assert normalize_words("L’incidente è avvenuto, in alta montagna!") == [
        "l'incidente", "è", "avvenuto", "in", "alta", "montagna",
    ]


def test_normalize_drops_language_tag_and_loose_apostrophes():
    assert normalize_words("Fine della frase. <it-IT> 'citato'") == ["fine", "della", "frase", "citato"]


def test_edit_distance_counts_substitutions_insertions_deletions():
    assert edit_distance(["a", "b", "c"], ["a", "x", "c", "d"]) == 2
    assert edit_distance([], ["a"]) == 1
    assert edit_distance(["a"], []) == 1


def test_corpus_wer_is_errors_over_reference_words():
    result = corpus_wer([("uno due tre quattro", "uno due tre"), ("cinque", "Cinque.")])
    assert result == {"wer": 0.2, "errors": 1, "ref_words": 5}


def test_percentile_interpolates_and_handles_empty():
    assert percentile([], 50) is None
    assert percentile([1.0, 2.0, 3.0, 4.0], 50) == pytest.approx(2.5)
    assert percentile([5.0], 95) == 5.0


def _wav(tag: int, channels: int, bits: int, payload: bytes, rate: int = 16000) -> bytes:
    fmt = struct.pack("<HHIIHH", tag, channels, rate, rate * channels * bits // 8, channels * bits // 8, bits)
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(payload)) + payload
    return b"RIFF" + struct.pack("<I", len(body)) + body


def test_parse_wav_float32_is_scaled_to_int16():
    samples, rate = parse_wav(_wav(3, 1, 32, array.array("f", [0.0, 0.5, -1.0, 2.0]).tobytes()))
    assert rate == 16000
    assert list(samples) == [0, 16384, -32767, 32767]


def test_parse_wav_stereo_pcm16_is_downmixed():
    samples, _ = parse_wav(_wav(1, 2, 16, array.array("h", [100, 300, -50, -150]).tobytes()))
    assert list(samples) == [200, -100]


def test_parse_wav_rejects_unsupported_formats():
    with pytest.raises(ValueError):
        parse_wav(_wav(1, 1, 8, b"\x00\x01"))


def test_write_then_parse_roundtrip(tmp_path):
    original = array.array("h", [0, 1, -1, 32767, -32768])
    write_wav(tmp_path / "x.wav", original)
    samples, rate = parse_wav((tmp_path / "x.wav").read_bytes())
    assert rate == 16000 and samples == original


def test_speech_bounds_trims_leading_and_trailing_silence():
    silence = array.array("h", bytes(2 * 16000))
    tone = array.array("h", [8000 if (i // 20) % 2 else -8000 for i in range(16000)])
    clip = silence + tone + silence
    start, end = speech_bounds(clip)
    # Margine di 100 ms attorno al parlato, allineato ai frame da 20 ms.
    assert start == 16000 - 1600
    assert end == 32000 + 1600
