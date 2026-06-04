"""Allineamento preciso delle tracce per-partecipante alla timeline del mix
Jibri via cross-correlazione dell'inviluppo di energia (ADR-013, raffinamento
sincronizzazione — "Opzione C").

Il recorder multi-traccia produce N file audio, ciascuno con un `startOffsetMs`
stimato dal wall-clock di arrivo del primo chunk (preciso a ~decine/centinaia
di ms). Questo modulo **raffina** quell'offset ancorandolo all'audio MISTO di
Jibri: poiché la voce del partecipante è presente nel mix, la cross-correlazione
dei due inviluppi di energia ha il picco esattamente al ritardo reale.

Strategia (robusta + economica):
  - decodifica entrambi a un inviluppo di energia RMS a bassa frequenza (50 Hz)
    via ffmpeg (no dipendenze nuove: numpy + ffmpeg sono già nel worker);
  - usa l'offset del manifest come PRIOR e cerca il picco solo in una finestra
    ±`search_window_ms` attorno ad esso (evita match spuri su registrazioni
    lunghe ed è veloce);
  - cross-correlazione NORMALIZZATA (coefficiente tipo Pearson per finestra) →
    `confidence` in ~[-1,1]; sotto soglia si ricade sull'offset del manifest.

Logica pura testabile: `xcorr_refine` lavora su array numpy (no I/O).
"""

from __future__ import annotations

import logging
import subprocess
from typing import Optional, Tuple

log = logging.getLogger("postprod-worker")

ENVELOPE_HZ = 50  # frame dell'inviluppo (20 ms)
_DECODE_SR = 4000  # Hz, mono: sufficiente per l'energia vocale


def decode_energy_envelope(path: str, *, frame_hz: int = ENVELOPE_HZ):
    """Decodifica `path` (qualsiasi formato) a un inviluppo RMS mono a
    `frame_hz` frame/sec. Ritorna un np.ndarray float32. Solleva
    CalledProcessError se ffmpeg fallisce (il chiamante gestisce il fallback).
    """
    import numpy as np  # import locale: stub mode resta leggero

    proc = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-i", path,
            "-ac", "1", "-ar", str(_DECODE_SR),
            "-f", "s16le", "-",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=True,
    )
    samples = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    frame_len = max(1, _DECODE_SR // frame_hz)
    n_frames = len(samples) // frame_len
    if n_frames == 0:
        return np.zeros(0, dtype=np.float32)
    framed = samples[: n_frames * frame_len].reshape(n_frames, frame_len)
    # RMS per frame.
    return np.sqrt(np.mean(framed * framed, axis=1)).astype(np.float32)


def xcorr_refine(
    track_env,
    mix_env,
    *,
    prior_frames: int,
    window_frames: int,
):
    """Cross-correlazione normalizzata di `track_env` dentro `mix_env`,
    cercando il lag (in frame) attorno a `prior_frames` ±`window_frames`.

    Ritorna (best_lag_frames, confidence) oppure None se non calcolabile.
    `best_lag_frames` = indice in `mix_env` dove la traccia inizia.
    Logica PURA (numpy), niente I/O → unit-testabile.
    """
    import numpy as np

    t = np.asarray(track_env, dtype=np.float64)
    m = np.asarray(mix_env, dtype=np.float64)
    lt, lm = len(t), len(m)
    if lt == 0 or lm == 0 or lt > lm:
        return None

    t = t - t.mean()
    m = m - m.mean()
    t_norm = float(np.sqrt((t * t).sum()))
    if t_norm <= 1e-9:
        return None  # traccia silenziosa: niente da correlare

    # Cross-correlazione completa via FFT: cc[k] = sum_i m[i+k]*t[i],
    # lag valido k in [0, lm-lt].
    n = lm + lt - 1
    nfft = 1 << (n - 1).bit_length()
    cc = np.fft.irfft(np.fft.rfft(m, nfft) * np.conj(np.fft.rfft(t, nfft)), nfft)
    max_lag = lm - lt
    cc = cc[: max_lag + 1]

    # Norma L2 della finestra del mix m[k:k+lt] via somma cumulata di m^2.
    m2 = np.concatenate([[0.0], np.cumsum(m * m)])
    win_energy = m2[lt : lt + len(cc)] - m2[0 : len(cc)]
    denom = t_norm * np.sqrt(np.maximum(win_energy, 1e-12))
    ncc = cc / denom  # coefficiente normalizzato ~[-1, 1]

    lo = max(0, prior_frames - window_frames)
    hi = min(len(ncc), prior_frames + window_frames + 1)
    if lo >= hi:
        lo, hi = 0, len(ncc)
    seg = ncc[lo:hi]
    best = int(np.argmax(seg)) + lo
    return best, float(ncc[best])


def estimate_track_offset_ms(
    track_path: str,
    mix_path: str,
    *,
    prior_ms: int,
    search_window_ms: int = 10_000,
    frame_hz: int = ENVELOPE_HZ,
    min_confidence: float = 0.30,
) -> Optional[Tuple[int, float]]:
    """Stima l'offset (ms) della traccia rispetto al mix Jibri, raffinando
    `prior_ms` (offset del manifest). Ritorna (offset_ms, confidence) se la
    correlazione è affidabile (>= min_confidence), altrimenti None → il
    chiamante usa l'offset del manifest. Best-effort: qualunque errore
    (mix assente, ffmpeg, ecc.) → None.
    """
    try:
        track_env = decode_energy_envelope(track_path, frame_hz=frame_hz)
        mix_env = decode_energy_envelope(mix_path, frame_hz=frame_hz)
    except Exception:  # noqa: BLE001 — best-effort
        log.exception("xcorr: decodifica inviluppo fallita")
        return None

    prior_frames = int(round(prior_ms / 1000.0 * frame_hz))
    window_frames = int(round(search_window_ms / 1000.0 * frame_hz))
    res = xcorr_refine(
        track_env, mix_env, prior_frames=prior_frames, window_frames=window_frames
    )
    if res is None:
        return None
    best_lag, conf = res
    if conf < min_confidence:
        return None
    offset_ms = int(round(best_lag / frame_hz * 1000.0))
    return offset_ms, conf
