"""Test della cross-correlazione pura per l'allineamento multi-traccia (C)."""

import numpy as np

from align import xcorr_refine


def _signal(n, seed):
    rng = np.random.default_rng(seed)
    return rng.random(n).astype(np.float32)


def test_recovers_known_lag():
    # La traccia è un segmento del mix che inizia al frame `lag`.
    pattern = _signal(200, seed=1)
    lag = 137
    mix = np.concatenate([_signal(lag, 2), pattern, _signal(90, 3)])
    res = xcorr_refine(pattern, mix, prior_frames=130, window_frames=50)
    assert res is not None
    best, conf = res
    assert abs(best - lag) <= 1  # preciso al frame (20 ms)
    assert conf > 0.9  # match quasi perfetto


def test_prior_window_restricts_search():
    # Due copie del pattern nel mix; il prior deve scegliere quella vicina.
    pattern = _signal(150, seed=10)
    mix = np.concatenate([
        _signal(50, 11), pattern, _signal(400, 12), pattern, _signal(30, 13),
    ])
    lag2 = 50 + 150 + 400  # seconda occorrenza
    res = xcorr_refine(pattern, mix, prior_frames=lag2, window_frames=40)
    assert res is not None
    best, _ = res
    assert abs(best - lag2) <= 1


def test_silent_track_returns_none():
    silent = np.zeros(100, dtype=np.float32)
    mix = _signal(500, seed=20)
    assert xcorr_refine(silent, mix, prior_frames=50, window_frames=50) is None


def test_track_longer_than_mix_returns_none():
    assert xcorr_refine(_signal(300, 1), _signal(100, 2), prior_frames=0, window_frames=10) is None
