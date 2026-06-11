"""Tests for the multi-track merge (ADR-013, Fase 1)."""

from multitrack import merge_tracks


def test_merges_and_sorts_by_global_time_with_real_names():
    tracks = [
        {
            "participant_id": "p-alex",
            "display_name": "Alex",
            "start_offset_ms": 0,
            "segments": [
                {"start": 0.0, "end": 2.0, "text": "Buongiorno"},
                {"start": 5.0, "end": 6.0, "text": "grazie"},
            ],
        },
        {
            "participant_id": "p-bob",
            "display_name": "Bob",
            "start_offset_ms": 1000,  # joined 1s later
            "segments": [
                {"start": 0.0, "end": 1.5, "text": "ciao a tutti"},
            ],
        },
    ]
    out = merge_tracks(tracks, language="it")
    assert out["multitrack"] is True
    assert out["language"] == "it"
    # global order: Alex@0.0, Bob@1.0 (offset), Alex@5.0
    starts = [(s["start"], s["speaker"]) for s in out["segments"]]
    assert starts == [(0.0, "p-alex"), (1.0, "p-bob"), (5.0, "p-alex")]
    # real names carried, no manual mapping needed
    names = {sp["diarLabel"]: sp["displayName"] for sp in out["speakers"]}
    assert names == {"p-alex": "Alex", "p-bob": "Bob"}


def test_preserves_overlaps_as_concurrent_segments():
    # Alex 0–4s, Bob 1–3s → genuine overlap, both kept
    tracks = [
        {"participant_id": "a", "display_name": "A", "start_offset_ms": 0,
         "segments": [{"start": 0.0, "end": 4.0, "text": "sto parlando"}]},
        {"participant_id": "b", "display_name": "B", "start_offset_ms": 0,
         "segments": [{"start": 1.0, "end": 3.0, "text": "ti interrompo"}]},
    ]
    out = merge_tracks(tracks)
    assert len(out["segments"]) == 2
    a = next(s for s in out["segments"] if s["speaker"] == "a")
    b = next(s for s in out["segments"] if s["speaker"] == "b")
    # overlap interval is non-empty
    assert a["start"] < b["end"] and b["start"] < a["end"]


def test_totalspeechsec_ranks_speakers_by_talk_time():
    tracks = [
        {"participant_id": "quiet", "display_name": "Q", "start_offset_ms": 0,
         "segments": [{"start": 0.0, "end": 1.0, "text": "ok"}]},
        {"participant_id": "loud", "display_name": "L", "start_offset_ms": 0,
         "segments": [{"start": 0.0, "end": 10.0, "text": "lungo intervento"}]},
    ]
    out = merge_tracks(tracks)
    # top speaker first
    assert out["speakers"][0]["diarLabel"] == "loud"
    assert out["speakers"][0]["totalSpeechSec"] == 10
    assert out["speakers"][1]["totalSpeechSec"] == 1


def test_word_timestamps_shifted_to_global_and_blanks_dropped():
    tracks = [
        {"participant_id": "p", "display_name": "P", "start_offset_ms": 2000,
         "segments": [
             {"start": 0.0, "end": 1.0, "text": "  ", "words": []},  # blank → dropped
             {"start": 1.0, "end": 2.0, "text": "ecco",
              "words": [{"start": 1.0, "end": 2.0, "word": "ecco"}]},
         ]},
    ]
    out = merge_tracks(tracks)
    assert len(out["segments"]) == 1
    seg = out["segments"][0]
    assert seg["start"] == 3.0  # 1.0 + 2.0s offset
    assert seg["words"][0]["start"] == 3.0


def test_marks_concurrent_segments_on_cross_speaker_overlap():
    """Parlato simultaneo (tracce diverse che si sovrappongono nel tempo)
    deve essere marcato `concurrent`; il parlato sequenziale no."""
    tracks = [
        {
            "participant_id": "r",
            "display_name": "Raffaele",
            "start_offset_ms": 0,
            "segments": [
                {"start": 0.0, "end": 5.0, "text": "da solo"},
                {"start": 62.0, "end": 64.0, "text": "insieme R"},
            ],
        },
        {
            "participant_id": "p",
            "display_name": "Paolo",
            "start_offset_ms": 60_000,  # entra +60s
            "segments": [{"start": 0.0, "end": 5.0, "text": "insieme P"}],
        },
    ]
    out = merge_tracks(tracks, language="it")
    by_text = {s["text"]: s for s in out["segments"]}
    # "da solo" (0-5, unico parlante) NON è concorrente
    assert not by_text["da solo"].get("concurrent")
    # "insieme P" (60-65) e "insieme R" (62-64) si sovrappongono → concorrenti
    assert by_text["insieme P"].get("concurrent") is True
    assert by_text["insieme R"].get("concurrent") is True


def test_no_concurrent_flag_for_same_speaker_adjacent():
    """Due segmenti dello STESSO parlante che si toccano NON sono concorrenti."""
    tracks = [
        {
            "participant_id": "solo",
            "display_name": "Solo",
            "start_offset_ms": 0,
            "segments": [
                {"start": 0.0, "end": 5.0, "text": "uno"},
                {"start": 4.0, "end": 8.0, "text": "due"},  # overlap stesso pid
            ],
        },
    ]
    out = merge_tracks(tracks, language="it")
    assert all(not s.get("concurrent") for s in out["segments"])
