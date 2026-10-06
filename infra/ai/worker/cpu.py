"""Punto d'ingresso del worker senza GPU (`python -m worker.cpu`).

Esegue lo stesso ciclo di ``worker.main`` ma solo per i tipi di job in
AI_WORKER_KINDS, che il chart imposta ai job che non usano la GPU nel worker
(sintesi, traduzioni, archivio). Si rifiuta di partire se l'elenco manca o
comprende un job del worker con la GPU: su un pod con pochi GB e senza GPU
una trascrizione finirebbe uccisa a meta', e il job perderebbe un tentativo.

Il modulo esiste solo nelle immagini che sanno filtrare per tipo: un'immagine
precedente, avviata con questo comando, termina subito senza prendere job.
"""

from __future__ import annotations

import logging
import sys

from . import client as cli
from . import main as mainmod

log = logging.getLogger("worker.cpu")

def main() -> int:
    mainmod.configure_logging()
    kinds = cli.worker_kinds()
    if not cli.cpu_kinds_ok(kinds):
        log.error(
            "AI_WORKER_KINDS=%r: il worker senza GPU richiede un elenco senza %s",
            ",".join(kinds),
            ",".join(sorted(cli.GPU_WORKER_KINDS)),
        )
        return 2
    return mainmod.run_one()


if __name__ == "__main__":
    sys.exit(main())
