"""Controllo al build dell'immagine con la GPU (Dockerfile.worker).

Fallisce il build, invece del primo job, se:

- un modulo della catena del worker non si importa (un'ABI rotta dopo la
  sostituzione di torch e numpy nell'immagine NGC);
- torch non e' una build CUDA 12, o nell'immagine c'e' una wheel o una
  libcudart CUDA 13 (il driver 550 dei nodi GPU arriva a CUDA 12);
- un pacchetto con estensioni compilate che dipende da numpy non si importa
  piu': l'immagine NGC ne porta molti compilati su numpy 1.x, che con numpy 2
  si rompono anche quando li importa solo una dipendenza facoltativa.

Si lancia con `python build_check.py`, senza argomenti.
"""

from __future__ import annotations

import glob
import importlib
import importlib.metadata as md
import site
import subprocess
import sys

CATENA = [
    "torch", "torchvision", "torchaudio", "torchcodec", "numpy", "pandas",
    "scipy", "sklearn", "transformers", "whisperx", "whisperx.alignment",
    "whisperx.asr", "whisperx.diarize", "ctranslate2", "pyannote.audio.pipelines",
    "piper", "audioseal",
]


def _importa(modulo: str) -> str | None:
    """Importa `modulo` in un processo a parte; ritorna l'errore o None."""
    esito = subprocess.run(
        [sys.executable, "-c", f"import {modulo}"], capture_output=True, text=True
    )
    if esito.returncode == 0:
        return None
    righe = esito.stderr.strip().splitlines()
    return righe[-1] if righe else f"uscita {esito.returncode}"


def main() -> int:
    errori: list[str] = []

    for modulo in CATENA:
        errore = _importa(modulo)
        if errore:
            errori.append(f"{modulo}: {errore}")

    import torch

    if not (torch.version.cuda or "").startswith("12."):
        errori.append(f"torch non e' una build CUDA 12: {torch.version.cuda}")

    for dist in md.distributions():
        nome = dist.metadata["Name"] or ""
        if "cu13" in f"{nome} {dist.version}".lower():
            errori.append(f"wheel CUDA 13: {nome}=={dist.version}")
    for cartella in site.getsitepackages():
        for libreria in glob.glob(f"{cartella}/**/libcudart.so.13*", recursive=True):
            errori.append(f"libreria CUDA 13: {libreria}")

    for dist in md.distributions():
        file = [str(f) for f in (dist.files or [])]
        dipende = " ".join(dist.requires or []).lower()
        if "numpy" not in dipende or not any(f.endswith(".so") for f in file):
            continue
        for modulo in (dist.read_text("top_level.txt") or "").split():
            if modulo.startswith("_") or "/" in modulo:
                continue
            errore = _importa(modulo)
            if errore:
                errori.append(f"{dist.metadata['Name']}=={dist.version} ({modulo}): {errore}")

    if errori:
        print("BUILD FAIL:", *errori, sep="\n  ")
        return 1
    import ctranslate2

    print("build-check OK: torch", torch.__version__, "CUDA", torch.version.cuda,
          "CT2", ctranslate2.__version__)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
