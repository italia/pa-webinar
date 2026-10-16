"""Test della misura dei sottotitoli su un evento vero."""

import json

from event_wer import compare, main, problems, render


def _editor(segments, speakers, original):
    return {
        "segments": [{"index": i, "start": i, "end": i + 1, **s} for i, s in enumerate(segments)],
        "speakers": [{"diarLabel": label, "displayName": name} for label, name in speakers],
        "original": original,
    }


ORIGINAL = {"modelId": "live-captions", "comparable": True, "certainMachineOrigin": True}
TRANSCRIPT = _editor(
    [
        {"speaker": "SPEAKER_00", "text": "Buongiorno a tutti, benvenuti.", "originalText": "Buongiorno a tutti, ben venuti."},
        {"speaker": "SPEAKER_01", "text": "Grazie, parliamo del 2026.", "originalText": None},
        {"speaker": "SPEAKER_00", "text": "Partiamo.", "originalText": None},
    ],
    [("SPEAKER_00", "Anna Rossi"), ("SPEAKER_01", "Marco Bianchi")],
    ORIGINAL,
)


def test_compare_counts_machine_errors_against_the_corrected_text():
    result = compare(TRANSCRIPT)
    # "benvenuti" -> "ben venuti": una sostituzione e un inserimento.
    assert result["rows"] == [
        {"name": "Anna Rossi", "ref_words": 5, "errors": 2, "segments": 2},
        {"name": "Marco Bianchi", "ref_words": 4, "errors": 0, "segments": 1},
    ]
    assert (result["errors"], result["ref_words"], result["changed_segments"]) == (2, 9, 1)
    assert problems(result) == []


def test_render_hides_names_unless_asked():
    text = render(compare(TRANSCRIPT), show_names=False)
    assert "Anna" not in text and "Persona 1" in text and "22.2%" in text
    assert "Anna Rossi" in render(compare(TRANSCRIPT), show_names=True)


def test_refuses_a_transcript_without_a_reference():
    assert problems(compare({**TRANSCRIPT, "original": None}))
    assert problems(compare({**TRANSCRIPT, "original": {**ORIGINAL, "comparable": False}}))
    # Solo i nomi riassegnati: la versione della macchina c'e', il testo e' lo stesso.
    untouched = {**TRANSCRIPT, "segments": [{**s, "originalText": None} for s in TRANSCRIPT["segments"]]}
    assert problems(compare(untouched))


def test_says_when_the_text_is_not_from_captions():
    text = render(compare({**TRANSCRIPT, "original": {**ORIGINAL, "modelId": "whisperx"}}), show_names=False)
    assert "whisperx" in text


def test_main(tmp_path, capsys):
    path = tmp_path / "t.json"
    path.write_text(json.dumps({**TRANSCRIPT, "original": None}), encoding="utf-8")
    assert main([str(path)]) == 1
    path.write_text(json.dumps(TRANSCRIPT), encoding="utf-8")
    assert main([str(path), "--json"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert [row["name"] for row in out["rows"]] == ["Persona 1", "Persona 2"]
    assert out["wer"] == 2 / 9
