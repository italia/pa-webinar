"""Parametri Punkt di NLTK per la divisione in frasi dell'allineamento.

L'allineamento di WhisperX divide il testo in frasi con il tokenizer Punkt di
NLTK e ne cerca i parametri in ``tokenizers/punkt_tab/<lingua>/``. Il worker
non spedisce i modelli Punkt pubblicati da NLTK: sono addestrati su corpora di
giornali la cui licenza non e' dichiarata. Al loro posto, per ogni lingua che
WhisperX conosce, scrive parametri non addestrati con un elenco di
abbreviazioni: le frasi si chiudono a ogni punto fermo che non segue
un'abbreviazione.

L'immagine li genera al build (vedi Dockerfile.worker)::

    python -m worker.punkt_params /usr/local/share/nltk_data
"""

from __future__ import annotations

import os
import sys
from typing import Iterable

# Le abbreviazioni dopo cui un punto non chiude la frase: quelle che WhisperX
# usava fino alla 3.4, piu' titoli e sigle comuni nei testi della PA. Valgono
# per ogni lingua.
ABBREVIATIONS = frozenset({
    "dr", "vs", "mr", "mrs", "prof",
    "dott", "ing", "avv", "arch", "geom", "rag", "sig", "sigg", "on", "sen",
    "art", "artt", "c", "co", "cfr", "ecc", "es", "n", "nn", "pag", "pagg",
    "cap", "tel", "rif", "prot", "dlgs", "dpr", "dl",
})


def write_params(nltk_data_dir: str, languages: Iterable[str]) -> list[str]:
    """Scrive i parametri per ``languages``; ritorna le cartelle scritte."""
    from nltk.tokenize.punkt import PunktParameters, save_punkt_params

    base = os.path.join(nltk_data_dir, "tokenizers", "punkt_tab")
    os.makedirs(base, exist_ok=True)
    params = PunktParameters()
    params.abbrev_types = set(ABBREVIATIONS)
    written = []
    for lang in sorted(set(languages)):
        lang_dir = os.path.join(base, lang)
        save_punkt_params(params, dir=lang_dir)
        written.append(lang_dir)
    return written


def main(argv: list[str]) -> int:
    from whisperx.utils import PUNKT_LANGUAGES

    if len(argv) != 1:
        print("uso: python -m worker.punkt_params <nltk_data_dir>", file=sys.stderr)
        return 2
    # `english` e' la lingua di riserva di WhisperX per le lingue senza modello.
    for lang_dir in write_params(argv[0], set(PUNKT_LANGUAGES.values()) | {"english"}):
        print(lang_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
