"""Il glossario della post-produzione (app: lib/ai/glossary.ts).

Ogni voce dice come un termine si scrive, come puo' arrivare dalla
trascrizione automatica, come si pronuncia nel doppiaggio e come si traduce.
Il portale lo manda con il job (``providerHints.glossary``); qui si applica:

  * trascrizione: le forme sbagliate tornano alla forma scritta
    (``normalize_text``), i termini e il loro significato guidano la
    correzione con il modello (``correction_terms``); quando il testo di un
    segmento cambia, le parole con i tempi vengono riallineate
    (``realign_words``) perche' il lettore le evidenzia una per una;
  * traduzione: i termini diventano segnaposto che il modello copia senza
    toccarli (``protect``/``restore``), e tornano come termine o come
    traduzione fissa della lingua;
  * doppiaggio: ``speakable`` sostituisce il termine con la sua pronuncia
    nella lingua, o lo legge lettera per lettera ("A-B-C": la forma con i
    trattini e' quella che la sintesi vocale compita in ogni lingua).

Tutte funzioni pure, senza rete ne' modelli.
"""

from __future__ import annotations

import difflib
import math
import re
from functools import lru_cache
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

READINGS = ("auto", "spell", "word")


@dataclass(frozen=True)
class Term:
    term: str
    aliases: Tuple[str, ...] = ()
    reading: str = "auto"
    spoken: Dict[str, str] = field(default_factory=dict)
    translations: Dict[str, str] = field(default_factory=dict)
    note: Optional[str] = None


def _texts(v: Any) -> Dict[str, str]:
    if not isinstance(v, dict):
        return {}
    return {str(k): str(x).strip() for k, x in v.items() if isinstance(x, str) and x.strip()}


def parse(raw: Optional[Iterable[Any]]) -> List[Term]:
    """Le voci del job; quelle senza termine si scartano."""
    out: List[Term] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        term = str(item.get("term") or "").strip()
        if not term:
            continue
        reading = item.get("reading") if item.get("reading") in READINGS else "auto"
        aliases = tuple(
            a.strip() for a in (item.get("aliases") or []) if isinstance(a, str) and a.strip()
        )
        note = item.get("note")
        out.append(
            Term(
                term=term,
                aliases=aliases,
                reading=reading,
                spoken=_texts(item.get("spoken")),
                translations=_texts(item.get("translations")),
                note=note.strip() if isinstance(note, str) and note.strip() else None,
            )
        )
    return out


# Confini di parola: lettere e cifre di qualunque alfabeto.
_B = r"(?<![\w])"
_E = r"(?![\w])"


def _form_pattern(form: str) -> str:
    """Il termine scritto esattamente cosi', non dentro un'altra parola."""
    return _B + re.escape(form) + _E


# ---------------------------------------------------------------------------
# Trascrizione
# ---------------------------------------------------------------------------


def _alias_regex(alias: str) -> Optional[str]:
    """Una forma detta: le parole come sono scritte (simboli compresi), con
    spazi, virgole o trattini fra l'una e l'altra, o niente: "a bi ci"
    prende anche "A, bi, ci" e "abici". Il punto no: separerebbe due frasi."""
    parts = [re.escape(p) for p in alias.split() if p]
    if not parts or not re.search(r"\w", alias):
        return None
    return _B + r"[\s,\-]*".join(parts) + _E


def _dotted_regex(term: str) -> Optional[str]:
    """Una sigla compitata da chi trascrive: "A.B.C" o "A B C" per ABC. Il
    punto finale resta: puo' chiudere la frase."""
    if not (2 <= len(term) <= 6) or not term.isalnum():
        return None
    return _B + r"(?:\.\s?|\s)".join(re.escape(c) for c in term) + _E


def normalizer(terms: List[Term]) -> Callable[[str], str]:
    """La funzione che riporta alla forma scritta le forme note di ogni
    termine, compilata una volta per tutta la trascrizione. Le forme dette
    non distinguono maiuscole ("spid" -> "SPID"); la sigla compitata si
    riconosce solo in maiuscolo, per non toccare parole comuni.

    Un solo passaggio con tutte le forme, dalla piu' lunga: il termine gia'
    scritto bene si riconosce per primo e resta com'e', cosi' una forma che
    sta dentro il termine stesso (un cognome per "Nome Cognome") non lo
    raddoppia, e ripassare lo stesso testo non cambia nulla.
    """
    # (lunghezza, espressione, termine, cosa deve comparire nel testo)
    # Il filtro: parti in minuscolo che devono esserci tutte nel testo in
    # minuscolo; per la sigla compitata, la prima lettera maiuscola seguita
    # da punto o spazio.
    alternatives: List[Tuple[int, str, str, Tuple[str, ...]]] = []
    parti = lambda forma: tuple(p.lower() for p in re.findall(r"\w+", forma))  # noqa: E731
    for t in terms:
        if parti(t.term):
            alternatives.append((len(t.term), _form_pattern(t.term), t.term, parti(t.term)))
        if len(parti(t.term)) > 1:
            # Un termine di piu' parole scritto in minuscolo o con altri
            # separatori ("mario rossi") e' ancora il termine: riconoscerlo
            # qui impedisce a una sua parte usata come forma ("rossi") di
            # raddoppiarlo.
            rx = _alias_regex(t.term)
            if rx:
                alternatives.append((len(t.term), "(?i:" + rx + ")", t.term, parti(t.term)))
        for a in t.aliases:
            rx = _alias_regex(a)
            if rx:
                alternatives.append((len(a), "(?i:" + rx + ")", t.term, parti(a)))
        if t.reading == "spell":
            rx = _dotted_regex(t.term)
            if rx:
                alternatives.append((len(t.term) * 2, rx, t.term, ("\x00" + t.term[0],)))
    if not alternatives:
        return lambda text: text
    alternatives.sort(key=lambda a: -a[0])
    replacements = [a[2] for a in alternatives]

    # Prefiltro: una riga prova solo le forme le cui parti ci sono tutte.
    # Con centinaia di termini un'espressione con tutte le forme costerebbe
    # minuti su una trascrizione lunga.
    @lru_cache(maxsize=512)
    def espressione(indici: Tuple[int, ...]) -> "re.Pattern[str]":
        return re.compile("|".join(f"({alternatives[i][1]})" for i in indici))

    def presente(filtro: Tuple[str, ...], basso: str, testo: str) -> bool:
        if filtro and filtro[0].startswith("\x00"):
            lettera = filtro[0][1:]
            return f"{lettera}." in testo or f"{lettera} " in testo
        return all(p in basso for p in filtro)

    def run(text: str) -> str:
        if not text:
            return text
        basso = text.lower()
        indici = tuple(i for i, a in enumerate(alternatives) if presente(a[3], basso, text))
        if not indici:
            return text
        rx = espressione(indici)
        return rx.sub(lambda m: replacements[indici[(m.lastindex or 1) - 1]], text)

    return run


def normalize_text(text: str, terms: List[Term]) -> str:
    """``normalizer`` per un testo solo."""
    return normalizer(terms)(text) if terms else text


def correction_terms(terms: List[Term], names: Iterable[str] = ()) -> List[str]:
    """I termini per la correzione con il modello: prima i nomi di chi parla,
    poi le voci nell'ordine del job (quelle dell'evento per prime), ciascuna
    con il significato quando c'e'. Il prompt ne tiene un numero limitato:
    l'ordine decide quali restano."""
    out = [n for n in names if n]
    out.extend(f"{t.term} ({t.note})" if t.note else t.term for t in terms)
    return out


def allowed_tokens(terms: List[Term], names: Iterable[str] = ()) -> set:
    """Le parole che la correzione puo' introdurre anche se non somigliano a
    quelle originali: i termini e i nomi."""
    out = set()
    for x in [t.term for t in terms] + [n for n in names if n]:
        out.update(_token_key(p) for p in x.split() if _token_key(p))
    return out


def _token_key(tok: str) -> str:
    return re.sub(r"[^\w]", "", tok.lower())


def realign_words(words: Any, new_text: str) -> Optional[List[Dict[str, Any]]]:
    """Le parole con i tempi di un segmento, adattate al testo nuovo.

    Le parole rimaste uguali tengono i loro tempi; un gruppo sostituito
    ("a bi ci" -> "ABC") prende l'intervallo del gruppo originale,
    diviso in parti uguali fra le parole nuove; una parola aggiunta prende il
    tempo della vicina. Senza parole di partenza restituisce None.
    """
    if not isinstance(words, list) or not words:
        return None
    old = [w for w in words if isinstance(w, dict) and isinstance(w.get("word"), str)]
    if not old:
        return None
    new_tokens = new_text.split()
    if [w["word"].strip() for w in old] == new_tokens:
        return old

    def tempo(w: Dict[str, Any], k: str) -> Optional[float]:
        v = w.get(k)
        return float(v) if isinstance(v, (int, float)) else None

    sm = difflib.SequenceMatcher(
        a=[_token_key(w["word"]) for w in old],
        b=[_token_key(t) for t in new_tokens],
        autojunk=False,
    )
    out: List[Dict[str, Any]] = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                out.append({**old[i1 + k], "word": new_tokens[j1 + k]})
            continue
        if tag == "delete":
            continue
        span = old[i1:i2]
        starts = [s for s in (tempo(w, "start") for w in span) if s is not None]
        ends = [e for e in (tempo(w, "end") for w in span) if e is not None]
        if starts and ends:
            start, end = min(starts), max(ends)
        else:
            # Parola aggiunta: il tempo della precedente, o della successiva.
            prev = next((tempo(w, "end") for w in reversed(out) if tempo(w, "end") is not None), None)
            nxt = next((tempo(w, "start") for w in old[i2:] if tempo(w, "start") is not None), None)
            start = end = prev if prev is not None else nxt
        n = j2 - j1
        for k in range(n):
            w: Dict[str, Any] = {"word": new_tokens[j1 + k]}
            if start is not None and end is not None:
                passo = (end - start) / n
                w["start"] = round(start + passo * k, 3)
                w["end"] = round(start + passo * (k + 1), 3)
            out.append(w)
    return out


def apply_text(segments: List[Dict[str, Any]], new_texts: List[str]) -> int:
    """Mette i testi nuovi nei segmenti e riallinea le loro parole; restituisce
    quanti segmenti sono cambiati."""
    changed = 0
    for seg, new in zip(segments, new_texts):
        old = seg.get("text") or ""
        if new is None or new == old:
            continue
        seg["text"] = new
        if "words" in seg:
            words = realign_words(seg.get("words"), new)
            if words is None:
                seg.pop("words", None)
            else:
                seg["words"] = words
        changed += 1
    return changed


def correction_is_safe(original: str, corrected: str, allowed: Optional[set] = None) -> bool:
    """Una correzione del modello si accetta se aggiusta parole, non se
    riscrive la frase. Ogni parte cambiata deve essere una variante scritta
    di quella originale ("Rosi" -> "Rossi", "a bi ci" -> "ABC") o un termine
    o nome noto (`allowed`); niente parole tolte senza sostituto, e al piu' 3
    parole toccate, o il 30% di una riga lunga. Una riga inventata, riassunta
    o tradotta resta quella originale, anche se e' corta."""
    if not corrected.strip():
        return False
    allowed = allowed or set()
    a = [_token_key(t) for t in original.split()]
    b = [_token_key(t) for t in corrected.split()]
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    toccate = 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        if tag == "delete":
            # Una parola tolta del tutto: solo punteggiatura o niente.
            if any(a[i1:i2]):
                return False
            continue
        nuove = [t for t in b[j1:j2] if t]
        vecchio = "".join(a[i1:i2])
        nuovo = "".join(nuove)
        if not nuove:
            continue
        simile = bool(vecchio) and difflib.SequenceMatcher(a=vecchio, b=nuovo).ratio() >= 0.6
        if not (simile or all(t in allowed for t in nuove)):
            return False
        toccate += max(i2 - i1, j2 - j1)
    return toccate <= max(3, math.ceil(0.3 * len(a)))


# ---------------------------------------------------------------------------
# Traduzione
# ---------------------------------------------------------------------------

_PH = "⟦{}⟧"  # ⟦n⟧
_PH_RX = re.compile(r"⟦\s*(\d+)\s*⟧")


def target_form(t: Term, lang: str) -> str:
    """Come il termine compare nella lingua: la traduzione fissa, se c'e'."""
    return t.translations.get(lang) or t.term


def _forms_regex(forms: Dict[str, Term]) -> Optional[re.Pattern[str]]:
    if not forms:
        return None
    alts = sorted(forms, key=len, reverse=True)
    return re.compile(_B + "(" + "|".join(re.escape(f) for f in alts) + ")" + _E)


def terms_in(text: str, terms: List[Term]) -> List[Term]:
    """I termini che compaiono nel testo, scritti esattamente cosi'."""
    return [t for t in terms if re.search(_form_pattern(t.term), text)]


def protect(text: str, terms: List[Term], lang: str) -> Tuple[str, List[str]]:
    """Sostituisce ogni termine con un segnaposto ⟦n⟧; il secondo valore dice
    con cosa rimetterlo al ritorno (il termine o la sua traduzione fissa)."""
    rx = _forms_regex({t.term: t for t in terms})
    if rx is None:
        return text, []
    by_form = {t.term: t for t in terms}
    replacements: List[str] = []

    def sub(m: re.Match[str]) -> str:
        replacements.append(target_form(by_form[m.group(1)], lang))
        return _PH.format(len(replacements))

    return rx.sub(sub, text), replacements


def restore(text: str, replacements: List[str]) -> Optional[str]:
    """Rimette i termini; None se il modello ha perso, duplicato o inventato
    un segnaposto (chi chiama traduce di nuovo senza segnaposti)."""
    found = [int(m.group(1)) for m in _PH_RX.finditer(text)]
    if sorted(found) != list(range(1, len(replacements) + 1)):
        return None
    return _PH_RX.sub(lambda m: replacements[int(m.group(1)) - 1], text)


def translation_rules(terms: List[Term], lang: str) -> str:
    """Le regole per il modello che traduce, una riga per termine."""
    righe = []
    for t in terms:
        forma = target_form(t, lang)
        regola = f'- "{t.term}": keep it as "{forma}"' if forma == t.term else f'- "{t.term}": always "{forma}"'
        righe.append(regola + (f" ({t.note})" if t.note else ""))
    return "\n".join(righe)


# ---------------------------------------------------------------------------
# Doppiaggio
# ---------------------------------------------------------------------------


def spell(form: str) -> str:
    """Lettera per lettera: "ABC" -> "A-B-C", "a11y" -> "a-1-1-y"."""
    return "-".join(c for c in form if c.isalnum())


def spoken_form(t: Term, found: str, lang: str) -> str:
    if t.spoken.get(lang):
        return t.spoken[lang]
    if t.spoken.get("*"):
        return t.spoken["*"]
    if len(found.split()) > 1:
        # Una traduzione fissa di piu' parole si legge com'e'.
        return found
    if t.reading == "spell":
        return spell(found)
    if t.reading == "word":
        # Maiuscola solo all'inizio: la sintesi vocale legge come parola.
        return found[:1].upper() + found[1:].lower()
    return found


def speakable(text: str, terms: List[Term], lang: str) -> str:
    """Il testo da dare alla sintesi vocale: ogni termine (o la sua traduzione
    fissa nella lingua) con la sua pronuncia."""
    forms: Dict[str, Term] = {}
    for t in terms:
        forms.setdefault(t.term, t)
        tf = t.translations.get(lang)
        if tf:
            forms.setdefault(tf, t)
    rx = _forms_regex(forms)
    if not text or rx is None:
        return text
    return rx.sub(lambda m: spoken_form(forms[m.group(1)], m.group(1), lang), text)
