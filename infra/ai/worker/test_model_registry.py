# SPDX-License-Identifier: EUPL-1.2
# SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

"""I modelli che il worker carica per default stanno nel registro dei pesi.

Il registro (scripts/licenses/models.json) e' la lista che la CI controlla per
licenza, formato e fissaggio (`npm run license:check`). Un default del worker
che non ci sta arriverebbe nelle installazioni senza quei controlli: la
pipeline di diarizzazione, il modello di trascrizione di ripiego, le voci
Piper suggerite e il generatore della filigrana.
"""

import inspect
import json
import re
from pathlib import Path

import transcribe
import tts

QUI = Path(__file__).resolve().parent
REGISTRO = QUI.parents[2] / "scripts" / "licenses" / "models.json"


def _registrati() -> set:
    voci = json.loads(REGISTRO.read_text(encoding="utf-8"))["models"]
    nomi = set()
    for voce in voci:
        nomi.add(voce["name"])
        nomi.update(voce.get("ids", []))
    return nomi


def test_pipeline_di_diarizzazione_registrata():
    assert transcribe.DIARIZATION_MODEL in _registrati()


def test_trascrizione_di_ripiego_registrata():
    registrati = _registrati()
    funzioni = [
        f
        for _, f in inspect.getmembers(transcribe, inspect.isfunction)
        if "asr_model_id" in inspect.signature(f).parameters
        and inspect.signature(f).parameters["asr_model_id"].default is not inspect.Parameter.empty
    ]
    assert funzioni, "nessuna funzione con un asr_model_id predefinito: aggiorna il test"
    for funzione in funzioni:
        predefinito = inspect.signature(funzione).parameters["asr_model_id"].default
        assert predefinito in registrati, funzione.__name__
    # main.py usa lo stesso ripiego quando il job non indica un modello.
    sorgente = (QUI / "main.py").read_text(encoding="utf-8")
    ripieghi = re.findall(r'asrModelId or "([^"]+)"', sorgente)
    assert ripieghi, "main.py non ha piu' il ripiego asrModelId or \"...\": aggiorna il test"
    for modello in ripieghi:
        assert modello in registrati


def test_voci_suggerite_registrate():
    registrati = _registrati()
    for lingua, voce in tts.DEFAULT_VOICES.items():
        assert voce in registrati, lingua


def test_filigrana_registrata():
    sorgente = (QUI / "tts.py").read_text(encoding="utf-8")
    generatori = re.findall(r'load_generator\("([^"]+)"\)', sorgente)
    assert generatori, "tts.py non carica piu' il generatore per nome: aggiorna il test"
    registrati = _registrati()
    for nome in generatori:
        assert nome in registrati
