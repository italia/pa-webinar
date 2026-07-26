"""Ancora la radice del pacchetto per pytest.

I test importano i moduli del worker per nome (`import align`, `import llm`,
...). Con `python -m pytest` funziona perché Python mette la directory corrente
in `sys.path`; con l'eseguibile `pytest` — quello che usa la CI — non succede, e
la raccolta dei test falliva con `ModuleNotFoundError: No module named 'align'`.

La sola presenza di questo file fa sì che pytest (import mode `prepend`) inserisca
questa directory in `sys.path`, quindi le due invocazioni si comportano allo
stesso modo. Il riga sotto lo rende esplicito e indipendente dal rootdir scelto.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
