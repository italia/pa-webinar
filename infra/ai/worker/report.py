"""Il resoconto dell'evento (lavoro REPORT).

Il portale raccoglie gli ingressi al claim (``reportInput``: evento, agenda con
«d'accordo» e «non d'accordo», trascrizione, chat senza nomi, domande,
sondaggi, parole, valutazioni e commenti, numeri della piattaforma). Qui il
modello linguistico scrive il testo: sintesi, argomenti spiegati, mappa
concettuale, consenso e dissenso, partecipazione, benefici, valutazioni,
domande aperte e prossimi passi; poi lo traduce nelle lingue chieste.

I numeri non li scrive il modello: li calcola il portale e la pagina li
disegna. Il modello li legge solo per commentarli.

Una trascrizione lunga si riassume prima a pezzi (note con il minuto), cosi'
la richiesta finale resta nel contesto del modello.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from typing import Any, Callable, Dict, List, Optional

from . import glossary as gl
from . import llm as llmmod

log = logging.getLogger(__name__)

# Oltre questi caratteri la trascrizione si riassume a pezzi.
TRASCRIZIONE_DIRETTA = 30_000
PEZZO = 18_000
# Tetti dei blocchi del prompt finale.
MAX_CHAT = 24_000
MAX_COMMENTI = 12_000
MAX_DOMANDE = 8_000

LINGUE = {
    "it": "italiano", "en": "English", "fr": "français", "de": "Deutsch", "es": "español",
    "pt": "português", "nl": "Nederlands", "pl": "polski", "ro": "română", "el": "ελληνικά",
    "cs": "čeština", "sk": "slovenčina", "sl": "slovenščina", "hr": "hrvatski", "hu": "magyar",
    "bg": "български", "da": "dansk", "sv": "svenska", "fi": "suomi", "et": "eesti",
    "lv": "latviešu", "lt": "lietuvių", "mt": "Malti", "ga": "Gaeilge",
}

SCHEMA = """{
  "title": "titolo breve del resoconto",
  "abstract": "2-4 frasi: di cosa si e' parlato e con quale esito",
  "summary": "il resoconto per esteso, 3-6 paragrafi separati da una riga vuota",
  "highlights": ["3-6 punti salienti"],
  "topics": [{
    "title": "tema",
    "explanation": "il tema spiegato a chi non c'era, 2-5 frasi",
    "keyPoints": ["punti chiave"],
    "start": "MM:SS dalla trascrizione, o null",
    "agreement": "high | mixed | low | unknown",
    "positions": [{"stance": "support | concern | question", "text": "posizione espressa, senza nomi di partecipanti"}]
  }],
  "conceptMap": {
    "nodes": [{"id": "breve-id", "label": "etichetta", "kind": "topic | concept | actor | outcome"}],
    "edges": [{"from": "id", "to": "id", "label": "verbo breve"}]
  },
  "consensus": {"summary": "dove c'e' stato accordo e dove no", "agreements": ["..."], "disagreements": ["..."]},
  "engagement": {"summary": "come hanno partecipato le persone", "observations": ["..."]},
  "benefits": {"summary": "cosa ne ricava chi ha partecipato", "items": ["..."]},
  "feedback": {"summary": "cosa dicono le valutazioni", "strengths": ["..."], "improvements": ["..."], "quotes": ["voci dai commenti, riformulate in breve"]},
  "openQuestions": ["domande rimaste aperte"],
  "nextSteps": ["prossimi passi emersi"]
}"""

SISTEMA = """Sei un analista che scrive il resoconto pubblico di un evento della Pubblica
Amministrazione italiana (webinar, convegno, riunione pubblica). Scrivi in {lingua},
in uno stile chiaro e istituzionale, comprensibile a una persona che non c'era.

Regole:
- Usa solo le informazioni fornite. Non inventare fatti, decisioni, numeri o nomi.
- I numeri li calcola la piattaforma e la pagina li mostra in grafici: citane pochi,
  solo se servono al discorso, e identici a quelli forniti.
- Persone: puoi nominare solo le persone dell'elenco «Persone dell'evento» e quelle che
  parlano con un nome nella trascrizione. Per chiunque altro scrivi «un partecipante»
  o «alcuni partecipanti». Non attribuire mai a qualcuno frasi della chat o dei
  commenti; non riportare dati personali (email, telefoni, indirizzi).
- Consenso e dissenso: ricavali dai «d'accordo» e «non d'accordo» dell'agenda, dai
  sondaggi, dalla chat e dagli interventi. Se i segnali mancano, scrivi che non si
  possono valutare e usa "unknown".
- Benefici: cosa hanno ottenuto i partecipanti (conoscenze, strumenti, chiarimenti,
  contatti), ricavato da trascrizione e valutazioni; niente promesse.
- Voci dalle valutazioni («quotes»): riformula sempre con parole tue, in breve; mai il testo
  di un commento parola per parola, mai nomi o riferimenti a persone.
- Argomenti: da 3 a 8, nell'ordine in cui sono stati trattati, con il minuto "start"
  preso dalla trascrizione quando c'e'.
- Mappa concettuale: da 8 a 20 nodi (temi, concetti, soggetti come enti e ruoli,
  esiti) e archi con un verbo breve; ogni arco collega due nodi che esistono.
- Se una sezione non ha materiale, lasciala vuota invece di riempirla.

Rispondi SOLO con un oggetto JSON con questa forma:
{schema}"""

NOTE_SISTEMA = """Riassumi questo tratto della trascrizione di un evento in note puntuali, in {lingua}.
Una nota per ogni passaggio rilevante, nella forma: [MM:SS] Chi parla: cosa dice,
con le posizioni favorevoli o contrarie e le domande. Niente introduzioni, solo le note."""


def _lingua(codice: str) -> str:
    return LINGUE.get((codice or "it").split("-")[0].lower(), codice or "italiano")


def _num(v: Any) -> str:
    return "—" if v is None else str(v)


def _taglia(testo: str, massimo: int) -> str:
    return testo if len(testo) <= massimo else testo[: massimo - 1].rstrip() + "…"


def pezzi_trascrizione(righe: List[str], massimo: int = PEZZO) -> List[str]:
    """Le righe della trascrizione in pezzi di al piu' ``massimo`` caratteri."""
    pezzi: List[str] = []
    corrente: List[str] = []
    lunghezza = 0
    # Una riga piu' lunga di un pezzo si spezza: nessun tratto va perso.
    spezzate = [r[i : i + massimo] for r in righe for i in range(0, max(1, len(r)), massimo)]
    for r in spezzate:
        if corrente and lunghezza + len(r) + 1 > massimo:
            pezzi.append("\n".join(corrente))
            corrente, lunghezza = [], 0
        corrente.append(r)
        lunghezza += len(r) + 1
    if corrente:
        pezzi.append("\n".join(corrente))
    return pezzi


def _blocco_trascrizione(
    inp: Dict[str, Any],
    lingua: str,
    base_url: Optional[str],
    model_id: Optional[str],
    avanzamento: Optional[Callable[[float, str], None]] = None,
) -> str:
    trascrizione = inp.get("transcript") or {}
    righe: List[str] = list(trascrizione.get("lines") or [])
    if not righe:
        return "# Trascrizione\nNon disponibile."
    testo = "\n".join(righe)
    origine = (
        "dai sottotitoli automatici della diretta, solo per chi ha dato il consenso"
        if trascrizione.get("source") == "live-captions"
        else "automatica"
    )
    if len(testo) <= TRASCRIZIONE_DIRETTA:
        return f"# Trascrizione ({origine})\n{testo}"
    note: List[str] = []
    pezzi = pezzi_trascrizione(righe)
    for i, pezzo in enumerate(pezzi):
        log.info("resoconto: note dal pezzo %d/%d della trascrizione", i + 1, len(pezzi))
        # Ogni passo rinnova il lease: una trascrizione lunga fa molte richieste.
        if avanzamento:
            avanzamento(10.0 + 30.0 * i / len(pezzi), f"reading transcript {i + 1}/{len(pezzi)}")
        note.append(
            llmmod._chat_completions(  # pylint: disable=protected-access
                base_url=base_url or "",
                model_id=model_id or "",
                messages=[
                    {"role": "system", "content": NOTE_SISTEMA.format(lingua=_lingua(lingua))},
                    {"role": "user", "content": pezzo},
                ],
                temperature=0.1,
                max_tokens=1500,
            ).strip()
        )
    tronca = " (la trascrizione era piu' lunga del limite: le ultime parti mancano)" if trascrizione.get("truncated") else ""
    return f"# Note dalla trascrizione ({origine}, riassunta a pezzi){tronca}\n" + "\n".join(note)


def componi_richiesta(inp: Dict[str, Any], blocco_trascrizione: str) -> str:
    """Il messaggio per il modello, a blocchi. Puro: si prova senza modello."""
    ev = inp.get("event") or {}
    m = inp.get("metrics") or {}
    pres = m.get("attendance") or {}
    part = m.get("participation") or {}
    blocchi: List[str] = []

    persone = "; ".join(
        f"{p.get('name')} ({p.get('role')}{', ' + p['organization'] if p.get('organization') else ''})"
        for p in ev.get("people") or []
    )
    blocchi.append(
        "# Evento\n"
        f"Titolo: {ev.get('title', '')}\n"
        f"Inizio: {ev.get('startsAt', '')} ({ev.get('timezone', '')}), durata circa {ev.get('durationMin', '—')} minuti\n"
        f"Enti: {', '.join(ev.get('organizations') or []) or '—'}\n"
        f"Persone dell'evento: {persone or '—'}\n"
        f"Descrizione: {ev.get('description') or '—'}"
    )

    agenda = inp.get("agenda") or []
    if agenda:
        righe = [
            f"- {a.get('label')} · {a.get('status')} · previsti {_num(a.get('plannedMinutes'))} min, "
            f"effettivi {_num(a.get('actualMinutes'))} min · d'accordo {a.get('agree', 0)}, non d'accordo {a.get('disagree', 0)}"
            for a in agenda
        ]
        blocchi.append("# Agenda (voce · stato · tempi · reazioni dei partecipanti)\n" + "\n".join(righe))

    blocchi.append(
        "# Numeri della piattaforma\n"
        f"- Iscritti {_num(pres.get('registered'))}, presenti {_num(pres.get('joined'))} "
        f"({_num(pres.get('conversionPct'))}%), picco di persone in sala {_num(pres.get('peak'))}\n"
        f"- {_num(part.get('interactions'))} interazioni da {_num(part.get('activePeople'))} persone "
        f"({_num(part.get('activePct'))}% dei presenti); messaggi in chat {_num(part.get('chatMessages'))}; "
        f"domande {_num(part.get('questions'))}; voti ai sondaggi {_num(part.get('pollVotes'))}; "
        f"parole {_num(part.get('words'))}; reazioni {_num(part.get('reactions'))}; mani alzate {_num(part.get('handRaises'))}"
    )

    sondaggi = inp.get("polls") or []
    if sondaggi:
        righe = []
        for p in sondaggi:
            opzioni = ", ".join(f"{o.get('text')}: {o.get('votes')}" for o in p.get("options") or [])
            righe.append(f"- {p.get('question')} ({p.get('totalVotes')} voti) → {opzioni}")
        blocchi.append("# Sondaggi pubblicati\n" + "\n".join(righe))

    parole = inp.get("words") or []
    if parole:
        blocchi.append("# Parole piu' frequenti («In una parola»)\n" + ", ".join(f"{w.get('word')} ({w.get('count')})" for w in parole))

    domande = inp.get("questions") or []
    if domande:
        righe = []
        for d in domande:
            stato = "con risposta" if d.get("answered") else "senza risposta"
            riga = f"- ({d.get('upvotes', 0)} voti, {stato}) {d.get('text')}"
            if d.get("answer"):
                riga += f" — Risposta: {d['answer']}"
            righe.append(riga)
        blocchi.append("# Domande del pubblico\n" + _taglia("\n".join(righe), MAX_DOMANDE))

    sintesi = inp.get("summary")
    if sintesi and sintesi.get("overall"):
        temi = "\n".join(f"- [{t.get('start')}] {t.get('title')}: {t.get('summary')}" for t in sintesi.get("topics") or [])
        blocchi.append(f"# Sintesi gia' fatta della registrazione\n{sintesi['overall']}\n{temi}")

    blocchi.append(blocco_trascrizione)

    chat = inp.get("chat") or {}
    messaggi = chat.get("messages") or []
    if messaggi:
        righe = []
        for c in messaggi:
            chi = "moderazione" if c.get("role") == "moderator" else "partecipante"
            if c.get("question"):
                chi += ", domanda"
            righe.append(f"[{c.get('at')}] ({chi}) {c.get('text')}")
        blocchi.append(
            f"# Chat ({len(messaggi)} messaggi su {chat.get('total', len(messaggi))}, senza nomi)\n"
            + _taglia("\n".join(righe), MAX_CHAT)
        )

    fb = inp.get("feedback") or {}
    if fb.get("responses"):
        voci = "\n".join(
            f"- {it.get('prompt')}: media {_num(it.get('average'))} (scala {it.get('scaleMin')}-{it.get('scaleMax')})"
            for it in fb.get("items") or []
        )
        commenti = "\n".join(f"- {c}" for c in fb.get("comments") or [])
        blocchi.append(
            f"# Valutazioni dopo l'evento ({fb.get('responses')} risposte, media {_num(fb.get('average'))})\n"
            + (voci + "\n" if voci else "")
            + ("Commenti:\n" + _taglia(commenti, MAX_COMMENTI) if commenti else "")
        )

    return "\n\n".join(blocchi)


# ── Normalizzazione (il portale normalizza di nuovo) ─────────────────

_STANZE = {"support", "concern", "question"}
_ACCORDI = {"high", "mixed", "low", "unknown"}
_TIPI = {"topic", "concept", "actor", "outcome"}
_MINUTO = re.compile(r"^(\d{1,2}:)?\d{1,2}:\d{2}$")


def _s(v: Any, massimo: int) -> str:
    return _taglia(v.strip(), massimo) if isinstance(v, str) else ""


def _lista(v: Any, massimo: int = 8, lunghezza: int = 400) -> List[str]:
    if not isinstance(v, list):
        return []
    out: List[str] = []
    for x in v:
        t = _s(x.get("text") if isinstance(x, dict) else x, lunghezza)
        if t and t not in out:
            out.append(t)
        if len(out) >= massimo:
            break
    return out


def _d(v: Any) -> Dict[str, Any]:
    return v if isinstance(v, dict) else {}


def _id_nodo(v: Any) -> str:
    """L'id di un nodo della mappa: lettere e cifre di ogni alfabeto, senza
    accenti, separate da trattini (la stessa regola del portale)."""
    t = unicodedata.normalize("NFKD", str(v or "").lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[\W_]+", "-", t).strip("-")[:40]


def normalizza(data: Dict[str, Any]) -> Dict[str, Any]:
    """La risposta del modello nella forma attesa dal portale."""
    temi = []
    for t in data.get("topics") or []:
        t = _d(t)
        titolo = _s(t.get("title"), 140)
        if not titolo:
            continue
        start = t.get("start")
        posizioni = [
            {"stance": str(p.get("stance")).lower(), "text": _s(p.get("text"), 400)}
            for p in (t.get("positions") or [])
            if isinstance(p, dict) and str(p.get("stance")).lower() in _STANZE and _s(p.get("text"), 400)
        ][:6]
        accordo = str(t.get("agreement") or "unknown").lower()
        temi.append({
            "title": titolo,
            "explanation": _s(t.get("explanation"), 1600),
            "keyPoints": _lista(t.get("keyPoints"), 6),
            "start": start.strip() if isinstance(start, str) and _MINUTO.match(start.strip()) else None,
            "agreement": accordo if accordo in _ACCORDI else "unknown",
            "positions": posizioni,
        })
    mappa = _d(data.get("conceptMap"))
    nodi, ids = [], set()
    for n in mappa.get("nodes") or []:
        n = _d(n)
        nid = _id_nodo(n.get("id")) or _id_nodo(n.get("label"))
        etichetta = _s(n.get("label"), 60)
        if not nid or not etichetta or nid in ids:
            continue
        ids.add(nid)
        tipo = str(n.get("kind") or "concept").lower()
        nodi.append({"id": nid, "label": etichetta, "kind": tipo if tipo in _TIPI else "concept"})
    archi = []
    for e in mappa.get("edges") or []:
        e = _d(e)
        da = _id_nodo(e.get("from"))
        a = _id_nodo(e.get("to"))
        if da in ids and a in ids and da != a:
            archi.append({"from": da, "to": a, "label": _s(e.get("label"), 40)})
    con = _d(data.get("consensus"))
    eng = _d(data.get("engagement"))
    ben = _d(data.get("benefits"))
    fb = _d(data.get("feedback"))
    return {
        "title": _s(data.get("title"), 140),
        "abstract": _s(data.get("abstract"), 900),
        "summary": _s(data.get("summary"), 6000),
        "highlights": _lista(data.get("highlights")),
        "topics": temi[:8],
        "conceptMap": {"nodes": nodi[:24], "edges": archi[:40]},
        "consensus": {
            "summary": _s(con.get("summary"), 1600),
            "agreements": _lista(con.get("agreements")),
            "disagreements": _lista(con.get("disagreements")),
        },
        "engagement": {"summary": _s(eng.get("summary"), 1600), "observations": _lista(eng.get("observations"))},
        "benefits": {"summary": _s(ben.get("summary"), 1600), "items": _lista(ben.get("items"))},
        "feedback": {
            "summary": _s(fb.get("summary"), 1600),
            "strengths": _lista(fb.get("strengths")),
            "improvements": _lista(fb.get("improvements")),
            "quotes": _lista(fb.get("quotes"), 5, 300),
        },
        "openQuestions": _lista(data.get("openQuestions")),
        "nextSteps": _lista(data.get("nextSteps")),
    }


def _stub(lingua: str) -> Dict[str, Any]:
    return normalizza({
        "title": "Resoconto di prova",
        "abstract": f"Resoconto di prova generato senza modello ({lingua}).",
        "summary": "Il worker gira in modalita' di prova: questo testo non viene da un modello.",
        "highlights": ["Prova del resoconto"],
        "topics": [{"title": "Apertura", "explanation": "Apertura dell'evento.", "keyPoints": ["Saluti"],
                    "start": "00:00", "agreement": "unknown", "positions": []}],
        "conceptMap": {"nodes": [{"id": "evento", "label": "Evento", "kind": "topic"},
                                 {"id": "pa", "label": "Pubblica Amministrazione", "kind": "actor"}],
                       "edges": [{"from": "pa", "to": "evento", "label": "organizza"}]},
    })


def genera_resoconto(
    inp: Dict[str, Any],
    *,
    base_url: Optional[str],
    model_id: Optional[str],
    avanzamento: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """Il resoconto nella lingua dell'evento. ``avanzamento`` riceve la
    percentuale e il passo: il worker lo usa per rinnovare il lease."""
    lingua = inp.get("language") or "it"
    if llmmod._stub_enabled() or not base_url or not model_id:  # pylint: disable=protected-access
        return _stub(lingua)
    trascrizione = _blocco_trascrizione(inp, lingua, base_url, model_id, avanzamento)
    richiesta = componi_richiesta(inp, trascrizione)
    if avanzamento:
        avanzamento(40.0, "writing report")
    grezzo = llmmod._chat_completions(  # pylint: disable=protected-access
        base_url=base_url,
        model_id=model_id,
        messages=[
            {"role": "system", "content": SISTEMA.format(lingua=_lingua(lingua), schema=SCHEMA)},
            {"role": "user", "content": richiesta},
        ],
        temperature=0.2,
        max_tokens=6000,
        timeout=900.0,
        json_mode=True,
    )
    risultato = normalizza(llmmod._parse_json_lenient(grezzo))  # pylint: disable=protected-access
    if not risultato["abstract"] and not risultato["summary"] and not risultato["topics"]:
        raise RuntimeError("il modello non ha restituito un resoconto utilizzabile")
    return risultato


def traduci_resoconto(
    resoconto: Dict[str, Any],
    destinazione: str,
    *,
    base_url: Optional[str],
    model_id: Optional[str],
    glossario: Optional[List["gl.Term"]] = None,
) -> Optional[Dict[str, Any]]:
    """Il resoconto in un'altra lingua, con le stesse chiavi e gli stessi
    valori tecnici; None se la traduzione non e' utilizzabile."""
    if llmmod._stub_enabled() or not base_url or not model_id:  # pylint: disable=protected-access
        return {**resoconto, "abstract": f"[stub {destinazione}] " + resoconto.get("abstract", "")}
    presenti = gl.terms_in(json.dumps(resoconto, ensure_ascii=False), glossario or [])
    regole = gl.translation_rules(presenti, destinazione) if presenti else ""
    grezzo = llmmod._chat_completions(  # pylint: disable=protected-access
        base_url=base_url,
        model_id=model_id,
        messages=[
            {"role": "system", "content": (
                f"You translate the public report of a public-administration event into {_lingua(destinazione)}. "
                "Keep the SAME JSON keys and structure. Keep these values UNCHANGED: every \"start\", "
                "\"stance\", \"agreement\", \"kind\", \"id\", \"from\" and \"to\". Translate only human-readable "
                "text. Output JSON only."
            ) + (llmmod.GLOSSARY_RULES_PROMPT.format(rules=regole) if regole else "")},
            {"role": "user", "content": json.dumps(resoconto, ensure_ascii=False)},
        ],
        temperature=0.0,
        max_tokens=7000,
        timeout=900.0,
        json_mode=True,
    )
    tradotto = normalizza(llmmod._parse_json_lenient(grezzo))  # pylint: disable=protected-access
    if not tradotto["abstract"] and not tradotto["topics"]:
        return None
    # La mappa concettuale tiene i nodi e gli archi della lingua dell'evento
    # se la traduzione ha cambiato gli id: le etichette tradotte si prendono per
    # posizione, quando i nodi sono gli stessi in numero, altrimenti restano.
    originali = resoconto["conceptMap"]["nodes"]
    nodi_tradotti = tradotto["conceptMap"]["nodes"]
    if {n["id"] for n in nodi_tradotti} != {n["id"] for n in originali}:
        stessi = len(nodi_tradotti) == len(originali)
        tradotto["conceptMap"] = {
            "nodes": [
                {**n, "label": nodi_tradotti[i]["label"] if stessi else n["label"]} for i, n in enumerate(originali)
            ],
            "edges": resoconto["conceptMap"]["edges"],
        }
    for i, t in enumerate(tradotto["topics"]):
        if i < len(resoconto["topics"]):
            t["start"] = resoconto["topics"][i]["start"]
    return tradotto
