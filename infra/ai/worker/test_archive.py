"""Unit test per la costruzione del comando ffmpeg dell'archivio MKV."""

from . import archive as arc


def _tracks():
    return [
        {"path": "/tmp/a.ogg", "title": "Alice", "language": "it", "offset_ms": 1500},
        {"path": "/tmp/b.ogg", "title": "Marco", "language": None, "offset_ms": 0},
    ]


def test_input_order_and_offsets():
    cmd = arc.build_archive_command(
        mix_path="/tmp/mix.mp4",
        tracks=_tracks(),
        subtitle_path="/tmp/sub.vtt",
        out_path="/tmp/out.mkv",
    )
    # mix è l'input 0, le tracce seguono con -itsoffset, i sub per ultimi.
    assert cmd[:5] == ["ffmpeg", "-nostdin", "-y", "-i", "/tmp/mix.mp4"]
    assert "-itsoffset" in cmd
    i = cmd.index("-itsoffset")
    assert cmd[i + 1] == "1.500"  # 1500 ms → 1.500 s
    assert "/tmp/a.ogg" in cmd and "/tmp/b.ogg" in cmd
    assert "/tmp/sub.vtt" in cmd


def test_maps_video_audio_subtitle():
    cmd = arc.build_archive_command(
        mix_path="/tmp/mix.mp4",
        tracks=_tracks(),
        subtitle_path="/tmp/sub.vtt",
        out_path="/tmp/out.mkv",
    )
    # video + audio mista + 2 tracce + sottotitoli.
    assert "0:v:0" in cmd
    assert "0:a:0?" in cmd
    assert "1:a:0" in cmd and "2:a:0" in cmd
    # input sottotitoli = 1 + n_tracks = 3
    assert "3:0" in cmd
    assert "-c:s" in cmd and "srt" in cmd
    # titoli tracce: mix + nomi.
    joined = " ".join(cmd)
    assert "title=Originale (mix)" in joined
    assert "title=Alice" in joined and "title=Marco" in joined
    assert "language=it" in joined


def test_no_subtitle_omits_subtitle_stream():
    cmd = arc.build_archive_command(
        mix_path="/tmp/mix.mp4",
        tracks=_tracks(),
        subtitle_path=None,
        out_path="/tmp/out.mkv",
    )
    assert "-c:s" not in cmd
    assert "3:0" not in cmd
    assert "-map" in cmd


def test_negative_offset_clamped_to_zero():
    cmd = arc.build_archive_command(
        mix_path="/tmp/mix.mp4",
        tracks=[{"path": "/tmp/a.ogg", "title": "X", "language": None, "offset_ms": -500}],
        subtitle_path=None,
        out_path="/tmp/out.mkv",
    )
    i = cmd.index("-itsoffset")
    assert cmd[i + 1] == "0.000"


def test_title_sanitized():
    cmd = arc.build_archive_command(
        mix_path="/tmp/mix.mp4",
        tracks=[{"path": "/tmp/a.ogg", "title": "Bad=Name;\nLine", "language": None, "offset_ms": 0}],
        subtitle_path=None,
        out_path="/tmp/out.mkv",
    )
    joined = " ".join(cmd)
    assert "title=Bad-Name, Line" in joined
