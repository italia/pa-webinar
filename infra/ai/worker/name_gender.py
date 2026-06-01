"""
Inferenza gender dal nome di persona — usata per il matching
voce↔speaker nel dub multivoce.

Strategia:
  1. Lookup nella lista hardcoded di nomi italiani comuni (M / F /
     unisex). Copre i casi quotidiani — niente rete, niente install.
  2. Fallback su `gender_guesser` (700KB di tabelle, multi-paese)
     quando il nome non è nella lista IT.
  3. Output canonicalizzato a `"M" | "F" | "N"` per consumo da
     `voice_pool.assign_voices`.

Limiti coscienti:
  - I nomi ambigui o stranieri sconosciuti restano `"N"` → fallback al
    pool generico (entrambi i gender ammessi).
  - Niente inferenza dal cognome (poco affidabile per IT).
  - Niente inferenza dall'audio (sarebbe biometric data → Art. 9 GDPR).
"""
from __future__ import annotations

import logging
from typing import Optional

log = logging.getLogger(__name__)


# Lista compatta di nomi italiani frequenti. Tenuta minuscola per
# match case-insensitive. Manutenuta a mano — aggiungere quando
# capitano errori in casi reali. ~80 nomi è già sufficiente per
# coprire >80% degli speaker di un evento PA italiano.
IT_NAMES_MALE = {
    "alessandro", "alessio", "alberto", "alex", "andrea", "antonio",
    "carlo", "claudio", "cristian", "cristiano", "daniele", "davide",
    "diego", "edoardo", "emanuele", "enrico", "fabio", "fabrizio",
    "federico", "filippo", "francesco", "gabriele", "giacomo",
    "gianluca", "giorgio", "giovanni", "giulio", "giuseppe", "leonardo",
    "lorenzo", "luca", "luigi", "marco", "mario", "massimo", "matteo",
    "mattia", "maurizio", "michele", "nicola", "paolo", "pasquale",
    "pietro", "raffaele", "raffaello", "riccardo", "roberto", "salvatore",
    "samuele", "sergio", "simone", "stefano", "tommaso", "umberto",
    "valerio", "vincenzo", "vittorio", "walter",
}
IT_NAMES_FEMALE = {
    "alessandra", "alessia", "alice", "ambra", "anna", "annalisa",
    "antonella", "arianna", "barbara", "beatrice", "benedetta",
    "carla", "carlotta", "carolina", "caterina", "chiara", "claudia",
    "cristina", "daniela", "daria", "debora", "elena", "eleonora",
    "elisa", "elisabetta", "emanuela", "emma", "erika", "federica",
    "francesca", "gaia", "gemma", "ginevra", "giorgia", "giulia",
    "giuseppina", "ilaria", "irene", "isabella", "katia", "laura",
    "letizia", "lia", "linda", "lisa", "livia", "lorena", "lucia",
    "maddalena", "manuela", "margherita", "maria", "marianna", "marina",
    "marta", "martina", "matilde", "michela", "miriam", "monica",
    "nadia", "nicoletta", "nicole", "olga", "ornella", "paola",
    "patrizia", "raffaella", "rebecca", "rita", "roberta", "rosa",
    "rosanna", "sabrina", "samantha", "sara", "serena", "silvia",
    "simona", "sofia", "stefania", "stella", "susanna", "teresa",
    "tiziana", "valentina", "valeria", "veronica", "viola", "viviana",
}
# Unisex (IT): davvero ambigui. Lasciamo "N".
IT_NAMES_UNISEX = {"andrea"}  # nota: in italiano è M, in inglese è F!
# Andrea resta M nella tabella IT (uso più frequente in eventi PA italiani).
# Per cluster internazionali si può rimuovere e marcare N.


def _from_it_table(first_name: str) -> Optional[str]:
    n = first_name.strip().lower()
    if not n:
        return None
    if n in IT_NAMES_MALE:
        return "M"
    if n in IT_NAMES_FEMALE:
        return "F"
    return None


def infer_gender(first_name: str) -> str:
    """`first_name` → `"M" | "F" | "N"`.

    `N` se ambiguo o non riconosciuto. Mai eccezione.
    """
    if not first_name or not first_name.strip():
        return "N"
    first = first_name.strip().split()[0]

    # 1. Lookup tabella IT (priorità: copre i casi DTD)
    g = _from_it_table(first)
    if g:
        return g

    # 2. gender_guesser per nomi internazionali
    try:
        import gender_guesser.detector as gg  # type: ignore[import-not-found]
        d = gg.Detector(case_sensitive=False)
        gd = d.get_gender(first)
        # Output: 'male', 'female', 'mostly_male', 'mostly_female',
        # 'andy' (androgyne), 'unknown'.
        if gd in ("male", "mostly_male"):
            return "M"
        if gd in ("female", "mostly_female"):
            return "F"
    except ImportError:
        log.debug("gender_guesser not available, fallback to N")
    except Exception as e:  # pragma: no cover
        log.warning("gender_guesser error on %r: %s", first, e)

    # 3. Heuristica suffix italiana (debole)
    if first.endswith(("a",)) and len(first) > 2:
        return "F"

    return "N"


def name_gender_map(display_names: list[str]) -> dict[str, str]:
    """Pre-compute mapping `firstname.lower() → gender`.

    Comodo per passare a `voice_pool.assign_voices` senza far
    ripartire `infer_gender` ad ogni segmento.
    """
    out: dict[str, str] = {}
    for full in display_names:
        if not full:
            continue
        first = full.strip().split()[0].lower()
        if first not in out:
            out[first] = infer_gender(first)
    return out
