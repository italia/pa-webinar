"""Traduzione di titolo e descrizione dell'evento (job TRANSLATE_TEXT).

Il testo lo traduce il motore di traduzione su CPU dell'installazione
(llama.cpp con EuroLLM-9B-Instruct, ``postprod.mt`` nel chart), che parla il
protocollo OpenAI /chat/completions: il portale ne manda l'indirizzo nel claim
(``providerHints.mtBaseUrl``). Niente vLLM, niente GPU, e nessuna dipendenza
nativa nel worker: solo HTTP.

Il modello traduce bene una frase alla volta con il suo formato di richiesta
(un solo messaggio, nessun prompt di sistema, temperatura 0), quindi:

  * la descrizione (Markdown) si traduce riga per riga: il prefisso della riga
    (rientro, titoli, elenchi, citazioni) e le righe vuote restano come sono,
    i blocchi di codice (fra ``` o rientrati) e i separatori non si traducono;
  * una riga o un pezzo senza niente da tradurre (vuoto, numeri e simboli,
    un'immagine senza testo alternativo) resta com'e' e al modello non va;
  * i link diventano ``<aN>testo</aN>``, che il modello conserva, e l'indirizzo
    si rimette dopo; se un segnaposto si perde, il testo del link si traduce a
    parte e il link non va perso;
  * indirizzi web, email e termini del glossario diventano segnaposto ``⟦n⟧``
    che il modello copia (un modello cambia volentieri una parola dentro un
    indirizzo email); se ne perde uno, la riga si traduce senza;
  * il titolo si divide sul primo ``|`` (il sopratitolo) e le due parti si
    traducono a parte.

Il motore si accende quando il lavoro e' in coda (l'orchestratore lo porta a
una replica): la prima richiesta aspetta che finisca di scaricare e caricare
il modello, fino a MT_CONNECT_WAIT_S secondi. Il testo che torna e' da
rileggere: il portale lo salva come proposta, mai al posto del testo
dell'evento.
"""

from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx

try:  # nel pacchetto del worker
    from . import glossary as gl
    from . import llm
except ImportError:  # nei test, che importano i moduli per nome (conftest.py)
    import glossary as gl  # type: ignore[no-redef]
    import llm  # type: ignore[no-redef]

log = logging.getLogger(__name__)

# Il nome inglese di ogni lingua, come lo vuole il modello nella richiesta.
LINGUE: Dict[str, str] = {
    "bg": "Bulgarian",
    "cs": "Czech",
    "da": "Danish",
    "de": "German",
    "el": "Greek",
    "en": "English",
    "es": "Spanish",
    "et": "Estonian",
    "fi": "Finnish",
    "fr": "French",
    "ga": "Irish",
    "hr": "Croatian",
    "hu": "Hungarian",
    "it": "Italian",
    "lt": "Lithuanian",
    "lv": "Latvian",
    "mt": "Maltese",
    "nl": "Dutch",
    "pl": "Polish",
    "pt": "Portuguese",
    "ro": "Romanian",
    "sk": "Slovak",
    "sl": "Slovenian",
    "sv": "Swedish",
}

# Quanto si aspetta il motore al primo avvio (nodo, scaricamento del modello,
# caricamento): sotto il lease di 30 minuti, che il primo passo ha appena
# rinnovato.
ATTESA_MOTORE_S = 900.0
# Una volta che il motore ha risposto, una nuova attesa e' un riavvio del pod.
ATTESA_RIAVVIO_S = 180.0
# Una riga lunga si divide in frasi fino a questa lunghezza: il contesto del
# motore e' di 4096 token, richiesta e risposta comprese.
PEZZO_MAX = 1000

_UNREACHABLE = (httpx.ConnectError, httpx.ConnectTimeout, httpx.RemoteProtocolError)


class MotoreIrraggiungibile(RuntimeError):
    """Il motore non ha risposto entro l'attesa: inutile provare le altre lingue."""


def _stub() -> bool:
    return os.environ.get("WORKER_STUB") == "1"


def _attesa_iniziale() -> float:
    try:
        return float(os.environ.get("MT_CONNECT_WAIT_S", str(ATTESA_MOTORE_S)))
    except ValueError:
        return ATTESA_MOTORE_S


@dataclass
class Motore:
    """Il motore di traduzione su CPU: indirizzo, modello e se ha gia' risposto."""

    base_url: Optional[str]
    model_id: Optional[str]
    risposto: bool = False
    richieste: int = 0
    secondi: float = 0.0

    def traduci_frase(self, testo: str, sorgente: str, destinazione: str) -> str:
        """Una frase (o una riga) con il formato di richiesta del modello."""
        if not testo.strip():
            # A una richiesta vuota il modello risponde con una frase sua.
            return ""
        if _stub() or not self.base_url or not self.model_id:
            return f"[{destinazione}] {testo}"
        src, dst = LINGUE[sorgente], LINGUE[destinazione]
        richiesta = f"Translate the following {src} source text to {dst}:\n{src}: {testo} \n{dst}: "
        inizio = time.monotonic()
        try:
            risposta = llm._chat_completions(
                base_url=self.base_url,
                model_id=self.model_id,
                messages=[{"role": "user", "content": richiesta}],
                temperature=0.0,
                max_tokens=min(2048, 64 + int(1.5 * len(testo))),
                timeout=600.0,
                connect_wait=ATTESA_RIAVVIO_S if self.risposto else _attesa_iniziale(),
                fail_if_unresolvable=True,
            )
        except _UNREACHABLE as e:
            raise MotoreIrraggiungibile(f"translation engine unreachable: {type(e).__name__}: {e}") from e
        except httpx.HTTPStatusError as e:
            if e.response is not None and e.response.status_code == 503:
                raise MotoreIrraggiungibile("translation engine still loading after the wait") from e
            raise
        self.risposto = True
        self.richieste += 1
        self.secondi += time.monotonic() - inizio
        return prima_riga(risposta, src, dst)


def prima_riga(risposta: str, src: str, dst: str) -> str:
    """La prima riga non vuota della risposta, senza l'etichetta della lingua
    che il modello a volte ripete ("German: ...")."""
    for riga in (risposta or "").splitlines():
        r = riga.strip()
        for etichetta in (f"{dst}:", f"{src}:"):
            if r.lower().startswith(etichetta.lower()):
                r = r[len(etichetta):].strip()
        if r:
            return r
    return ""


# ---------------------------------------------------------------------------
# Segnaposto: link, indirizzi, glossario
# ---------------------------------------------------------------------------

# [testo](indirizzo "titolo") e ![alt](indirizzo)
_LINK = re.compile(r'(!?)\[([^\]\n]*)\]\(([^)\s]+(?:\s+"[^"\n]*")?)\)')
_TAG = re.compile(r"<a(\d+)>(.*?)</a\1>", re.S)
# Indirizzi web (anche fra < >) ed email: il modello non li deve toccare.
_INDIRIZZO = re.compile(
    r"<(?:https?://|mailto:)[^>\s]+>|https?://[^\s<>()\[\]]+[^\s<>()\[\].,;:!?'\"]|"
    r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"
)
# Il codice in linea (`...`): come gli indirizzi, resta com'e'.
_CODICE = re.compile(r"`[^`\n]+`")
_PRIVATO = re.compile("(\\d+)")


@dataclass
class Link:
    immagine: bool
    testo: str
    destinazione: str

    def come_markdown(self, testo: str) -> str:
        return f"{'!' if self.immagine else ''}[{testo}]({self.destinazione})"


def estrai_link(riga: str) -> Tuple[str, List[Link]]:
    """La riga con ``<aN>testo</aN>`` al posto di ogni link, e i link."""
    link: List[Link] = []

    def sost(m: re.Match[str]) -> str:
        link.append(Link(m.group(1) == "!", m.group(2), m.group(3)))
        return f"<a{len(link)}>{m.group(2)}</a{len(link)}>"

    return _LINK.sub(sost, riga), link


def rimetti_link(tradotta: str, link: List[Link]) -> Optional[str]:
    """I link al loro posto; None se un segnaposto manca o e' doppio."""
    trovati = [int(m.group(1)) for m in _TAG.finditer(tradotta)]
    if sorted(trovati) != list(range(1, len(link) + 1)):
        return None
    return _TAG.sub(lambda m: link[int(m.group(1)) - 1].come_markdown(m.group(2).strip()), tradotta)


def proteggi(testo: str, termini: List["gl.Term"], destinazione: str) -> Tuple[str, List[str]]:
    """Codice in linea, indirizzi, email e termini del glossario come ⟦n⟧; il
    secondo valore dice con che cosa rimetterli (il termine, o la sua
    traduzione fissa)."""
    indirizzi: List[str] = []

    def via(m: re.Match[str]) -> str:
        indirizzi.append(m.group(0))
        return f"{len(indirizzi)}"

    # Prima il codice in linea e gli indirizzi, con caratteri privati che il
    # glossario non tocca.
    testo = _CODICE.sub(via, testo)
    testo = _INDIRIZZO.sub(via, testo)
    testo, sostituzioni = gl.protect(testo, termini, destinazione) if termini else (testo, [])
    base = len(sostituzioni)
    testo = _PRIVATO.sub(lambda m: f"⟦{base + int(m.group(1))}⟧", testo)
    return testo, sostituzioni + indirizzi


# ---------------------------------------------------------------------------
# Righe, titolo, descrizione
# ---------------------------------------------------------------------------

_SOLO_SIMBOLI = re.compile(r"^[\W\d_]*$")


def _frasi(testo: str) -> List[str]:
    """Una riga lunga in pezzi di al piu' PEZZO_MAX caratteri, fra una frase e l'altra."""
    if len(testo) <= PEZZO_MAX:
        return [testo]
    pezzi: List[str] = []
    corrente = ""
    for frase in re.split(r"(?<=[.!?;:])\s+", testo):
        if corrente and len(corrente) + 1 + len(frase) > PEZZO_MAX:
            pezzi.append(corrente)
            corrente = frase
        else:
            corrente = f"{corrente} {frase}" if corrente else frase
    if corrente:
        pezzi.append(corrente)
    # Una frase sola piu' lunga del massimo si taglia fra le parole.
    out: List[str] = []
    for p in pezzi:
        while len(p) > PEZZO_MAX:
            taglio = p.rfind(" ", 0, PEZZO_MAX)
            taglio = taglio if taglio > PEZZO_MAX // 2 else PEZZO_MAX
            out.append(p[:taglio])
            p = p[taglio:].lstrip()
        if p:
            out.append(p)
    return out


def _traduci_semplice(motore: Motore, testo: str, sorgente: str, destinazione: str,
                      termini: List["gl.Term"]) -> str:
    """Un testo senza link: indirizzi e glossario protetti, se il modello li
    conserva; altrimenti tradotto com'e'. Vuoto, torna vuoto."""
    pezzi = []
    for pezzo in _frasi(testo):
        if _SOLO_SIMBOLI.match(pezzo):
            # Niente da tradurre (vuoto, numeri, simboli): al modello non va.
            pezzi.append(pezzo if pezzo.strip() else "")
            continue
        protetto, sostituzioni = proteggi(pezzo, termini, destinazione)
        if _SOLO_SIMBOLI.match(protetto):
            # Solo indirizzi e termini del glossario: si rimettono e basta.
            pezzi.append(gl.restore(protetto, sostituzioni) or pezzo)
            continue
        tradotto = motore.traduci_frase(protetto, sorgente, destinazione)
        rimesso = gl.restore(tradotto, sostituzioni) if sostituzioni else tradotto
        if rimesso is None:
            log.info("placeholder lost translating to %s: retrying without", destinazione)
            rimesso = motore.traduci_frase(pezzo, sorgente, destinazione)
        pezzi.append(rimesso)
    return " ".join(p for p in pezzi if p)


def traduci_riga(motore: Motore, testo: str, sorgente: str, destinazione: str,
                 termini: Optional[List["gl.Term"]] = None) -> str:
    """Il testo di una riga (senza il prefisso Markdown), con i suoi link."""
    termini = termini or []
    # Il testo senza i link: vuoto o di soli numeri e simboli (anche una riga
    # con la sola immagine senza testo alternativo) non c'e' niente da
    # tradurre, e la riga resta com'e'.
    piano = _LINK.sub(lambda m: m.group(2), testo)
    if _SOLO_SIMBOLI.match(piano):
        return testo
    con_tag, link = estrai_link(testo)
    if not link:
        return _traduci_semplice(motore, testo, sorgente, destinazione, termini)
    if len(con_tag) <= PEZZO_MAX:
        protetto, sostituzioni = proteggi(con_tag, termini, destinazione)
        tradotto = motore.traduci_frase(protetto, sorgente, destinazione)
        rimesso = gl.restore(tradotto, sostituzioni) if sostituzioni else tradotto
        if rimesso is not None:
            finale = rimetti_link(rimesso, link)
            if finale is not None:
                return finale
    # Un segnaposto si e' perso (o la riga e' troppo lunga per tradurla in un
    # colpo): il testo senza link, poi ogni link a parte, rimesso dove si
    # ritrova il suo testo tradotto, o in fondo alla riga.
    log.info("link placeholder lost translating to %s: translating links apart", destinazione)
    tradotto = _traduci_semplice(motore, piano, sorgente, destinazione, termini)
    for l in link:
        testo_link = _traduci_semplice(motore, l.testo, sorgente, destinazione, termini) if l.testo.strip() else l.testo
        posto = tradotto.find(testo_link) if testo_link else -1
        if posto >= 0:
            tradotto = tradotto[:posto] + l.come_markdown(testo_link) + tradotto[posto + len(testo_link):]
        else:
            tradotto = f"{tradotto} ({l.come_markdown(testo_link)})"
    return tradotto


# Il prefisso di una riga Markdown: titoli, citazioni, elenchi (anche annidati
# e con casella), numeri.
_PREFISSO = re.compile(r"^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,3}[.)]\s+)")
_RECINTO = re.compile(r"^\s*(```|~~~)")
_SEPARATORE = re.compile(r"^\s*([-*_])(?:\s*\1){2,}\s*$")
_TABELLA_SEP = re.compile(r"^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*(?::?-{3,}:?\s*)?\|?\s*$")
# Il segno di una voce d'elenco con il suo rientro e lo spazio dopo: dove
# finisce comincia il contenuto della voce.
_VOCE = re.compile(r"[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+")
# Il codice rientrato: almeno quattro colonne oltre il margine, o oltre il
# contenuto della voce d'elenco in cui sta.
RIENTRO_CODICE = 4


def _colonne(testo: str) -> int:
    """La larghezza in colonne, con il tab fino al multiplo di 4 successivo
    (come lo conta il Markdown)."""
    return len(testo.expandtabs(4))


def _rientro(riga: str) -> int:
    return _colonne(riga[: len(riga) - len(riga.lstrip(" \t"))])


def dividi_prefisso(riga: str) -> Tuple[str, str]:
    """(prefisso, testo) di una riga Markdown: il prefisso e' il rientro con i
    segni di titolo, citazione ed elenco, il testo comincia dopo gli spazi."""
    fine = 0
    while True:
        m = _PREFISSO.match(riga[fine:])
        if not m or not m.group(0):
            break
        fine += m.end()
    # Anche il rientro senza segni (il seguito di una voce d'elenco, una riga
    # che continua il paragrafo) e' prefisso: senza, la struttura cambia.
    resto = riga[fine:]
    fine += len(resto) - len(resto.lstrip())
    return riga[:fine], riga[fine:]


def traduci_markdown(motore: Motore, testo: str, sorgente: str, destinazione: str,
                     termini: Optional[List["gl.Term"]] = None) -> str:
    """La descrizione, riga per riga, con la struttura Markdown intatta."""
    out: List[str] = []
    nel_codice: Optional[str] = None
    # La colonna del contenuto di ogni voce d'elenco aperta, le annidate in
    # coda: una riga rientrata fin li' e' il seguito della voce, non codice.
    voci: List[int] = []
    # La riga prima e' testo di un paragrafo: una riga rientrata lo continua,
    # perche' il codice rientrato non interrompe un paragrafo.
    dopo_testo = False
    for riga in testo.replace("\r\n", "\n").split("\n"):
        recinto = _RECINTO.match(riga)
        if nel_codice:
            out.append(riga)
            if recinto and recinto.group(1) == nel_codice:
                nel_codice = None
            continue
        # Vuota come la intende il Markdown: solo spazi e tabulazioni. Una riga
        # di soli spazi unificatori (incollata da una pagina web) e' testo del
        # paragrafo, e la riga rientrata che segue lo continua.
        if not riga.strip(" \t"):
            out.append(riga)
            dopo_testo = False
            continue
        rientro = _rientro(riga)
        separatore = _SEPARATORE.match(riga)
        # Una riga che continua il paragrafo resta nella voce anche se rientra
        # meno; ogni altra chiude le voci di cui non raggiunge il contenuto.
        continua = dopo_testo and not (_PREFISSO.match(riga) or recinto or separatore)
        if not continua:
            while voci and rientro < voci[-1]:
                voci.pop()
        if not dopo_testo and rientro >= (voci[-1] if voci else 0) + RIENTRO_CODICE:
            # Codice rientrato: come quello fra ```, non si traduce.
            out.append(riga)
            continue
        dopo_testo = False
        if recinto:
            nel_codice = recinto.group(1)
            out.append(riga)
            continue
        if separatore or _TABELLA_SEP.match(riga):
            out.append(riga)
            continue
        dopo_testo = True
        if riga.lstrip().startswith("|") and riga.rstrip().endswith("|"):
            # Una riga di tabella: si traduce cella per cella.
            celle = riga.split("|")
            out.append("|".join(
                c if i in (0, len(celle) - 1) or not c.strip()
                else f" {traduci_riga(motore, c.strip(), sorgente, destinazione, termini)} "
                for i, c in enumerate(celle)
            ))
            continue
        voce = _VOCE.match(riga)
        if voce:
            voci.append(_colonne(voce.group(0)))
        prefisso, corpo = dividi_prefisso(riga)
        # Dopo un titolo non c'e' un paragrafo da continuare; una riga di soli
        # spazi unificatori invece e' testo (il prefisso se li e' presi tutti).
        dopo_testo = (bool(corpo) or not riga.strip()) and not prefisso.lstrip().startswith("#")
        # Lo spazio in coda che in Markdown va a capo resta.
        frase = corpo.rstrip()
        out.append(prefisso + traduci_riga(motore, frase, sorgente, destinazione, termini) + corpo[len(frase):])
    return "\n".join(out)


def traduci_titolo(motore: Motore, titolo: str, sorgente: str, destinazione: str,
                   termini: Optional[List["gl.Term"]] = None) -> str:
    """Il titolo; con un sopratitolo («Ciclo | Titolo») le due parti a parte."""
    titolo = " ".join(titolo.split())
    if not titolo:
        return ""
    def parte(testo: str) -> str:
        # Un «|» inventato dal modello sposterebbe il sopratitolo.
        return " ".join(traduci_riga(motore, testo, sorgente, destinazione, termini).replace("|", " ").split())

    if "|" in titolo:
        sopra, principale = titolo.split("|", 1)
        if sopra.strip() and principale.strip():
            return f"{parte(sopra.strip())} | {parte(principale.strip())}"
    return parte(titolo)


# ---------------------------------------------------------------------------
# Il lavoro
# ---------------------------------------------------------------------------


@dataclass
class Risultato:
    title: Dict[str, str] = field(default_factory=dict)
    description: Dict[str, str] = field(default_factory=dict)
    # Lingue non tradotte: sconosciute al modello, fallite, o senza tempo.
    mancanti: List[str] = field(default_factory=list)
    secondi: Dict[str, float] = field(default_factory=dict)


def traduci_testi(
    testo: Dict[str, Any],
    *,
    base_url: Optional[str],
    model_id: Optional[str],
    glossario: Optional[List["gl.Term"]] = None,
    avanzamento: Optional[Callable[[float, str], None]] = None,
    tempo_rimasto: Optional[Callable[[], float]] = None,
) -> Risultato:
    """Titolo e descrizione in ogni lingua chiesta, una lingua alla volta.

    ``avanzamento`` dice al portale a che punto si e' (e si ferma se il lavoro
    e' chiuso o ripreso da un altro worker); ``tempo_rimasto`` e' quanto manca
    alla scadenza del Job: se non basta per un'altra lingua, si consegna
    quello che c'e'.
    """
    sorgente = str(testo.get("sourceLanguage") or "it")
    if sorgente not in LINGUE:
        raise RuntimeError(f"unsupported source language: {sorgente}")
    titolo = str(testo.get("title") or "")
    descrizione = str(testo.get("description") or "")
    destinazioni = [l for l in (testo.get("targetLanguages") or []) if l != sorgente]
    motore = Motore(base_url, model_id)
    termini = glossario or []
    esito = Risultato()
    for i, lingua in enumerate(destinazioni):
        if avanzamento:
            avanzamento(10.0 + 85.0 * i / max(1, len(destinazioni)), f"translating to {lingua}")
        if lingua not in LINGUE:
            log.warning("language %s not supported by the translation engine", lingua)
            esito.mancanti.append(lingua)
            continue
        if tempo_rimasto:
            # Il tempo di un'altra lingua: una volta e mezza la piu' lenta finora.
            stima = max(esito.secondi.values()) * 1.5 if esito.secondi else 0.0
            if tempo_rimasto() <= stima:
                log.warning("deadline near: delivering without %s", ", ".join(destinazioni[i:]))
                esito.mancanti.extend(l for l in destinazioni[i:] if l in LINGUE)
                break
        inizio = time.monotonic()
        try:
            t = traduci_titolo(motore, titolo, sorgente, lingua, termini) if titolo.strip() else ""
            d = traduci_markdown(motore, descrizione, sorgente, lingua, termini).strip() if descrizione.strip() else ""
        except MotoreIrraggiungibile:
            raise
        except Exception as e:  # pylint: disable=broad-except
            # Una lingua andata male non butta via le altre.
            log.warning("translation to %s failed: %s", lingua, e)
            esito.mancanti.append(lingua)
            continue
        if t:
            esito.title[lingua] = t
        if d:
            esito.description[lingua] = d
        esito.secondi[lingua] = round(time.monotonic() - inizio, 1)
        log.info("translated to %s in %.1fs", lingua, esito.secondi[lingua])
    return esito
