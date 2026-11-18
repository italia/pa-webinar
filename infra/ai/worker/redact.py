# SPDX-License-Identifier: EUPL-1.2
# SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

"""Rimozione di una persona da un video (job REDACT).

Per ogni intervallo chiesto lo staff ha confermato che la persona compare o
parla: li' il video diventa il cartello «contenuto rimosso su richiesta» a
schermo pieno e l'audio si azzera. La durata resta quella dell'originale, cosi'
i tempi di trascrizione, sottotitoli e capitoli restano validi.

Solo ffmpeg su CPU: un passaggio solo, con i filtri ``overlay`` (o ``drawbox``,
senza cartello) e ``volume`` abilitati sugli intervalli. Il video si ricodifica
(H.264 + AAC in MP4, ``faststart`` per la riproduzione nel browser). Il cartello
arriva dal portale come PNG: qui niente caratteri ne' testi.
"""

from __future__ import annotations

import json
import logging
import subprocess
import tempfile
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

log = logging.getLogger("postprod-worker")

# Il colore del riquadro senza cartello e del bordo del cartello: il blu scuro
# del design system, lo stesso dello sfondo del cartello.
COLORE_SFONDO = "0x17324D"
# Intervalli piu' vicini di cosi' diventano uno solo.
UNIONE_S = 0.05
# Ogni quanto si dice al portale che il lavoro e' vivo (rinnova il lease).
AVANZAMENTO_OGNI_S = 30.0


@dataclass(frozen=True)
class InfoVideo:
    duration: Optional[float]
    width: Optional[int]
    height: Optional[int]
    has_video: bool
    has_audio: bool


def normalizza_intervalli(
    intervalli: Iterable[Dict[str, Any]], durata: Optional[float]
) -> List[Tuple[float, float]]:
    """Ordina, taglia sul video e fonde gli intervalli; scarta quelli vuoti."""
    grezzi: List[Tuple[float, float]] = []
    for i in intervalli:
        try:
            start = max(0.0, float(i["start"]))
            end = float(i["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if durata is not None:
            end = min(end, durata)
        if end > start:
            grezzi.append((start, end))
    grezzi.sort()
    uniti: List[Tuple[float, float]] = []
    for start, end in grezzi:
        if uniti and start <= uniti[-1][1] + UNIONE_S:
            uniti[-1] = (uniti[-1][0], max(uniti[-1][1], end))
        else:
            uniti.append((start, end))
    return uniti


def espressione_attivo(intervalli: Sequence[Tuple[float, float]]) -> str:
    """L'espressione di ffmpeg vera dentro uno qualunque degli intervalli."""
    return "+".join(f"between(t,{a:.3f},{b:.3f})" for a, b in intervalli)


def costruisci_filtro(
    intervalli: Sequence[Tuple[float, float]],
    info: InfoVideo,
    *,
    con_cartello: bool,
) -> str:
    """Il filtergraph: video coperto e audio muto negli intervalli.

    Ingressi: 0 = il video, 1 = il cartello (se c'e'). Uscite: ``[v]`` e ``[a]``
    per le tracce che il video ha. I tempi ``t`` dei filtri contano dall'inizio
    del file, come il player a cui si riferiscono gli intervalli: ffmpeg toglie
    l'inizio del file a tutte le tracce insieme, e lo scarto fra audio e video
    resta quello dell'originale (azzerarle una per una lo cambierebbe).
    """
    if not intervalli:
        raise ValueError("no interval to remove")
    attivo = espressione_attivo(intervalli)
    parti: List[str] = []
    if info.has_video:
        if con_cartello and info.width and info.height:
            w, h = info.width, info.height
            parti.append(
                f"[1:v]scale={w}:{h}:force_original_aspect_ratio=decrease,"
                f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color={COLORE_SFONDO},setsar=1[cartello]"
            )
            parti.append(f"[0:v][cartello]overlay=0:0:enable='{attivo}':eof_action=repeat[v]")
        else:
            parti.append(f"[0:v]drawbox=x=0:y=0:w=iw:h=ih:color={COLORE_SFONDO}:t=fill:enable='{attivo}'[v]")
    if info.has_audio:
        parti.append(f"[0:a]volume=0:enable='{attivo}'[a]")
    if not parti:
        raise ValueError("the source has neither video nor audio")
    return ";".join(parti)


def costruisci_comando(
    *,
    sorgente: str,
    uscita: str,
    filtro: str,
    info: InfoVideo,
    cartello: Optional[str],
) -> List[str]:
    """La riga di comando di ffmpeg. Logica pura: si prova senza ffmpeg."""
    cmd: List[str] = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-i", sorgente]
    if cartello and info.has_video:
        # Un'immagine ripetuta per tutta la durata: l'overlay finisce con il video.
        cmd += ["-loop", "1"]
        if info.duration:
            cmd += ["-t", f"{info.duration:.3f}"]
        cmd += ["-i", cartello]
    cmd += ["-filter_complex", filtro]
    if info.has_video:
        cmd += ["-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"]
    else:
        cmd += ["-vn"]
    if info.has_audio:
        cmd += ["-map", "[a]", "-c:a", "aac", "-b:a", "128k"]
    else:
        cmd += ["-an"]
    cmd += ["-map_metadata", "0", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", uscita]
    return cmd


def analizza(percorso: str) -> InfoVideo:
    """Durata, dimensioni e tracce del file, da ffprobe."""
    out = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "stream=codec_type,width,height:format=duration",
            "-of", "json", percorso,
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return info_da_ffprobe(json.loads(out or "{}"))


def info_da_ffprobe(dati: Dict[str, Any]) -> InfoVideo:
    flussi = dati.get("streams") or []
    video = next((s for s in flussi if s.get("codec_type") == "video"), None)
    durata_raw = (dati.get("format") or {}).get("duration")
    try:
        durata = float(durata_raw) if durata_raw is not None else None
    except (TypeError, ValueError):
        durata = None
    return InfoVideo(
        duration=durata,
        width=int(video["width"]) if video and video.get("width") else None,
        height=int(video["height"]) if video and video.get("height") else None,
        has_video=video is not None,
        has_audio=any(s.get("codec_type") == "audio" for s in flussi),
    )


def secondi_da_progresso(riga: str) -> Optional[float]:
    """I secondi gia' codificati da una riga di ``-progress`` (``out_time_us`` o ``out_time_ms``, in microsecondi)."""
    chiave, _, valore = riga.strip().partition("=")
    if chiave not in ("out_time_us", "out_time_ms"):
        return None
    try:
        return int(valore) / 1_000_000
    except ValueError:
        return None


def rimuovi_intervalli(
    sorgente: str,
    uscita: str,
    intervalli: Iterable[Dict[str, Any]],
    *,
    cartello: Optional[str] = None,
    info: Optional[InfoVideo] = None,
    avanzamento: Optional[Callable[[float], None]] = None,
) -> InfoVideo:
    """Scrive in ``uscita`` il video con gli intervalli coperti e muti.

    ``avanzamento`` riceve la frazione fatta (0..1) al massimo ogni
    ``AVANZAMENTO_OGNI_S`` secondi: serve a tenere vivo il lavoro durante una
    ricodifica lunga. Solleva se ffmpeg fallisce o se non resta niente da togliere.
    """
    info = info or analizza(sorgente)
    tagli = normalizza_intervalli(intervalli, info.duration)
    filtro = costruisci_filtro(tagli, info, con_cartello=bool(cartello))
    cmd = costruisci_comando(sorgente=sorgente, uscita=uscita, filtro=filtro, info=info, cartello=cartello)
    log.info("redacting %d interval(s), %.1fs in total", len(tagli), sum(b - a for a, b in tagli))
    # Gli errori in un file: una pipe piena bloccherebbe ffmpeg mentre si legge l'avanzamento.
    with tempfile.TemporaryFile(mode="w+") as diario:
        with subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=diario, text=True) as proc:
            assert proc.stdout is not None
            ultimo = time.monotonic()
            try:
                for riga in proc.stdout:
                    fatto = secondi_da_progresso(riga)
                    if fatto is None or avanzamento is None or not info.duration:
                        continue
                    if time.monotonic() - ultimo >= AVANZAMENTO_OGNI_S:
                        ultimo = time.monotonic()
                        avanzamento(min(1.0, fatto / info.duration))
            except BaseException:
                # Chi segue l'avanzamento ha deciso di fermarsi (lavoro chiuso o
                # ripreso da un altro worker): ffmpeg non deve continuare da solo.
                proc.kill()
                raise
            codice = proc.wait()
        diario.seek(0)
        errori = diario.read().splitlines()[-20:]
    if codice != 0:
        raise RuntimeError(f"ffmpeg exited {codice}: {' | '.join(errori)[-1500:]}")
    return info
