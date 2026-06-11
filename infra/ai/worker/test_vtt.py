"""Test del parsing WebVTT per il dubbing (regression del blocker).

segments_to_vtt scrive "<v LABEL>LABEL: testo": parse_translated_vtt deve
togliere SIA il tag SIA il prefisso duplicato (altrimenti Piper pronuncia
"SPEAKER zero zero") SENZA intaccare i ':' interni al testo tradotto.
Round-trip writer→reader così i due non possono divergere.
"""

import vtt


def test_roundtrip_strips_tag_and_duplicate_prefix():
    segs = [
        {"start": 0.0, "end": 2.5, "text": "Hello everyone", "speaker": "SPEAKER_00"},
        {"start": 3.0, "end": 5.0, "text": "Note: this is important", "speaker": "SPEAKER_00"},
    ]
    vtt_text = vtt.segments_to_vtt(segs)
    # il writer mette DAVVERO sia tag sia prefisso duplicato
    assert "<v SPEAKER_00>SPEAKER_00: Hello everyone" in vtt_text

    parsed, dur = vtt.parse_translated_vtt(vtt_text)
    assert [p["text"] for p in parsed] == ["Hello everyone", "Note: this is important"]
    assert all(p["speaker"] == "SPEAKER_00" for p in parsed)
    # il ':' interno al testo NON deve essere toccato
    assert parsed[1]["text"] == "Note: this is important"
    assert dur == 5.0


def test_human_name_label():
    segs = [{"start": 1.0, "end": 2.0, "text": "Bonjour", "speaker": "SPEAKER_00"}]
    vtt_text = vtt.segments_to_vtt(segs, speaker_names={"SPEAKER_00": "Paolo"})
    assert "<v Paolo>Paolo: Bonjour" in vtt_text
    parsed, _ = vtt.parse_translated_vtt(vtt_text)
    assert parsed[0]["text"] == "Bonjour"
    assert parsed[0]["speaker"] == "Paolo"


def test_without_speaker_no_tag():
    segs = [{"start": 0.0, "end": 1.0, "text": "Plain line"}]
    vtt_text = vtt.segments_to_vtt(segs)  # speaker None → niente tag/prefisso
    parsed, _ = vtt.parse_translated_vtt(vtt_text)
    assert parsed[0]["text"] == "Plain line"
    assert parsed[0]["speaker"] is None


def test_parse_ts_formats():
    assert vtt._parse_ts("00:01:30.500") == 90.5
    assert vtt._parse_ts("02:05.000") == 125.0
    assert vtt._parse_ts("7.250") == 7.25


def test_plain_text_resolves_speaker_names():
    """La sintesi/LLM deve vedere il NOME reale, non SPEAKER_00."""
    from vtt import segments_to_plain_text

    segs = [
        {"start": 1.0, "end": 2.0, "text": "ciao", "speaker": "SPEAKER_00"},
        {"start": 3.0, "end": 4.0, "text": "salve", "speaker": "SPEAKER_01"},
    ]
    out = segments_to_plain_text(segs, speaker_names={"SPEAKER_00": "Raffaele"})
    assert "Raffaele: ciao" in out
    assert "SPEAKER_00" not in out  # risolto al nome
    assert "SPEAKER_01: salve" in out  # non mappato → resta il label


def test_plain_text_without_names_keeps_label():
    from vtt import segments_to_plain_text

    out = segments_to_plain_text(
        [{"start": 0.0, "end": 1.0, "text": "x", "speaker": "SPEAKER_00"}]
    )
    assert "SPEAKER_00: x" in out
