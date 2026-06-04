"""Archivio scaricabile multi-traccia (job ARCHIVE — ADR-013).

Muxa in un singolo file MKV:
  - il video Jibri (mix) come traccia video + la sua audio mista,
  - una traccia audio per partecipante (etichettata col displayName,
    sfasata di `offset_ms` per allinearsi al t0 del mix),
  - i sottotitoli sorgente (VTT) come traccia sottotitoli embedded.

MKV è il contenitore giusto: supporta N tracce audio nominate + Opus
nativo + sottotitoli testuali, senza re-encoding (`-c copy`). I browser
non sanno cambiare traccia audio in un MKV → l'archivio è per il
DOWNLOAD; il riascolto per-relatore in-app usa il player multi-audio
(VideoPlayer con audioTracks, sync manuale via offset).

Niente dipendenze nuove: ffmpeg è già nell'immagine worker.
"""

from __future__ import annotations

import logging
import subprocess
from typing import List, Optional, TypedDict

log = logging.getLogger("postprod-worker")


class ArchiveTrack(TypedDict):
    path: str
    title: str
    language: Optional[str]
    offset_ms: int


def _sanitize(value: str) -> str:
    """Metadata title: niente newline/`=`/`;` che confonderebbero il
    parser dei metadata di ffmpeg. Cap a 200 char."""
    cleaned = value.replace("\n", " ").replace("\r", " ").replace("=", "-").replace(";", ",")
    return cleaned.strip()[:200] or "Partecipante"


def build_archive_command(
    *,
    mix_path: str,
    tracks: List[ArchiveTrack],
    subtitle_path: Optional[str],
    out_path: str,
) -> List[str]:
    """Costruisce la command-line ffmpeg per il mux dell'archivio.

    Logica PURA (nessun I/O) → unit-testabile. L'ordine degli input:
        0            = mix (video + audio mista)
        1..N         = tracce per-partecipante (ognuna con -itsoffset)
        N+1          = sottotitoli (se presenti)

    Mapping nel contenitore:
        video        = mix 0:v
        audio 0      = mix 0:a (Originale / mix) — opzionale (a?)
        audio 1..N   = tracce per-partecipante
        subtitle 0   = VTT (convertito a SRT, S_TEXT/UTF8 — ben supportato)
    """
    cmd: List[str] = ["ffmpeg", "-nostdin", "-y", "-i", mix_path]

    # Tracce: -itsoffset sposta in avanti i timestamp dell'input così la
    # traccia parte a `offset_ms` sul timeline del mix. Offset clampato a 0.
    for tr in tracks:
        off_s = max(0, tr["offset_ms"]) / 1000.0
        cmd += ["-itsoffset", f"{off_s:.3f}", "-i", tr["path"]]

    sub_index: Optional[int] = None
    if subtitle_path:
        sub_index = 1 + len(tracks)
        cmd += ["-i", subtitle_path]

    # Map: video + audio mista (opzionale) dal mix.
    cmd += ["-map", "0:v:0", "-map", "0:a:0?"]
    # Map: una traccia audio per partecipante.
    for i in range(len(tracks)):
        cmd += ["-map", f"{i + 1}:a:0"]
    # Map: sottotitoli.
    if sub_index is not None:
        cmd += ["-map", f"{sub_index}:0"]

    # Copy ovunque (no re-encode): video H.264 e audio Opus passano
    # invariati nel contenitore MKV. Sottotitoli convertiti a SRT.
    cmd += ["-c:v", "copy", "-c:a", "copy"]
    if sub_index is not None:
        cmd += ["-c:s", "srt"]

    # Metadata tracce audio: 0 = mix originale, 1..N = partecipanti.
    cmd += ["-metadata:s:a:0", "title=Originale (mix)"]
    for i, tr in enumerate(tracks):
        cmd += [f"-metadata:s:a:{i + 1}", f"title={_sanitize(tr['title'])}"]
        if tr.get("language"):
            cmd += [f"-metadata:s:a:{i + 1}", f"language={tr['language']}"]
    if sub_index is not None:
        cmd += ["-metadata:s:s:0", "title=Sottotitoli"]

    cmd += ["-f", "matroska", out_path]
    return cmd


def build_archive_mkv(
    *,
    mix_path: str,
    tracks: List[ArchiveTrack],
    subtitle_path: Optional[str],
    out_path: str,
    timeout_s: int = 1800,
) -> None:
    """Esegue il mux. Solleva CalledProcessError se ffmpeg fallisce."""
    cmd = build_archive_command(
        mix_path=mix_path,
        tracks=tracks,
        subtitle_path=subtitle_path,
        out_path=out_path,
    )
    log.info("archive ffmpeg: %d track(s), subs=%s", len(tracks), bool(subtitle_path))
    subprocess.run(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        check=True,
        timeout=timeout_s,
    )
