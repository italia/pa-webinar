"""Audio waveform peak extraction.

Produces a compact, normalised amplitude envelope of a recording so the
admin transcript editor can draw a waveform/timeline WITHOUT the browser
downloading the (often ~1 GB) source MP4.

Approach: decode the audio track to mono 16-bit PCM at a low sample rate
via ffmpeg (already present in the worker image — WhisperX shells out to
it too), then reduce it to at most `max_buckets` peak values. Each bucket
holds the max absolute amplitude over its slice, normalised to 0..1 over
the whole clip so the rendered waveform uses the full vertical range.

Output JSON shape (kept small — 2-decimal floats, ~5 bytes each):

    {
        "version": 1,
        "duration": 3601.2,     # seconds
        "buckets": 4000,
        "peaks": [0.0, 0.42, 1.0, ...]   # len == buckets, each 0..1
    }

At the 64 KB inline cap, 4000 buckets * ~5 chars ≈ 20 KB → comfortably
inlined by the artifact endpoint, so the app serves it from Postgres
without a storage round-trip.
"""

from __future__ import annotations

import subprocess
from typing import Any, Dict

# Decode resolution. 1 kHz mono keeps the speech envelope intact while
# making a 1h clip only ~3.6M samples (~7 MB) in memory.
DECODE_HZ = 1000
# ~4 visual buckets/sec is plenty for an overview timeline; capped so the
# JSON stays small for very long recordings.
BUCKETS_PER_SEC = 4
MAX_BUCKETS = 4000


def compute_waveform(
    audio_path: str,
    *,
    decode_hz: int = DECODE_HZ,
    max_buckets: int = MAX_BUCKETS,
) -> Dict[str, Any]:
    """Decode `audio_path` and return a normalised peak envelope.

    Raises CalledProcessError if ffmpeg fails. Callers should treat
    waveform extraction as best-effort and not fail the whole TRANSCRIBE
    job if it errors (the editor degrades to a segment-only timeline).
    """
    import numpy as np  # local import: keeps module import cheap in stub mode

    proc = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-loglevel",
            "error",
            "-threads",
            "1",
            "-i",
            audio_path,
            "-f",
            "s16le",
            "-ac",
            "1",
            "-ar",
            str(decode_hz),
            "-",
        ],
        capture_output=True,
        check=True,
    )

    samples = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    n = int(samples.size)
    if n == 0:
        return {"version": 1, "duration": 0.0, "buckets": 0, "peaks": []}

    duration = n / decode_hz
    bucket_count = min(max_buckets, max(1, int(duration * BUCKETS_PER_SEC)))

    # Boundaries via linspace so buckets are as even as possible even when
    # n isn't divisible by bucket_count.
    bounds = np.linspace(0, n, bucket_count + 1).astype(int)
    abs_samples = np.abs(samples)
    peaks = np.empty(bucket_count, dtype=np.float32)
    for i in range(bucket_count):
        lo, hi = bounds[i], bounds[i + 1]
        peaks[i] = abs_samples[lo:hi].max() if hi > lo else 0.0

    peak_max = float(peaks.max())
    if peak_max > 0:
        peaks = peaks / peak_max

    return {
        "version": 1,
        "duration": round(duration, 2),
        "buckets": bucket_count,
        "peaks": [round(float(p), 2) for p in peaks],
    }
