"""Il resoconto dell'evento (lavoro REPORT): prompt, riassunto a pezzi,
normalizzazione, traduzione."""

from __future__ import annotations

import json

import pytest

from . import llm as llmmod
from . import report as rep


def _ingresso(righe=None):
    return {
        "language": "it",
        "event": {
            "title": "Evento di prova",
            "description": "Una presentazione delle funzioni della piattaforma.",
            "startsAt": "2026-10-20T08:00:00.000Z",
            "durationMin": 60,
            "timezone": "Europe/Rome",
            "organizations": ["Ente di prova"],
            "people": [{"name": "Relatore 1", "role": "speaker", "organization": "Ente di prova"}],
        },
        "agenda": [{"label": "Apertura", "status": "DONE", "plannedMinutes": 10, "actualMinutes": 12, "agree": 7, "disagree": 1}],
        "transcript": {"source": "live-captions", "lines": righe or ["[00:05] Relatore 1: Buongiorno a tutti."], "truncated": False},
        "summary": None,
        "chat": {"total": 2, "messages": [{"at": "10:05", "role": "participant", "question": True, "text": "Si puo' registrare?"}]},
        "questions": [{"text": "Quando esce la versione nuova?", "upvotes": 3, "answered": True, "answer": "A novembre."}],
        "polls": [{"question": "Vi e' utile?", "options": [{"text": "Si'", "votes": 9}, {"text": "No", "votes": 1}], "totalVotes": 10}],
        "words": [{"word": "accessibilita'", "count": 4}],
        "feedback": {"responses": 5, "average": 4.4, "items": [{"prompt": "Utilita'", "average": 4.4, "scaleMin": 1, "scaleMax": 5}], "comments": ["Molto chiaro."]},
        "metrics": {
            "attendance": {"registered": 40, "joined": 25, "peak": 22, "conversionPct": 63},
            "participation": {"interactions": 50, "activePeople": 15, "activePct": 60, "chatMessages": 20,
                              "questions": 4, "pollVotes": 10, "words": 4, "reactions": 12, "handRaises": 2, "attention": 71},
        },
    }


def _risposta_valida(**extra):
    base = {
        "title": "Il resoconto",
        "abstract": "Si e' parlato della piattaforma.",
        "summary": "Paragrafo uno.\n\nParagrafo due.",
        "highlights": ["Uno", "Uno", "Due"],
        "topics": [{"title": "Apertura", "explanation": "Saluti.", "keyPoints": ["a"], "start": "00:05",
                    "agreement": "high", "positions": [{"stance": "support", "text": "Piace"}, {"stance": "boh", "text": "x"}]}],
        "conceptMap": {"nodes": [{"id": "Piattaforma", "label": "Piattaforma", "kind": "topic"},
                                 {"id": "ente", "label": "Ente", "kind": "soggetto"}],
                       "edges": [{"from": "ente", "to": "piattaforma", "label": "usa"},
                                 {"from": "ente", "to": "fantasma", "label": "no"}]},
    }
    base.update(extra)
    return base


def test_componi_richiesta_ha_i_blocchi_e_nessun_nome_in_chat():
    testo = rep.componi_richiesta(_ingresso(), "# Trascrizione\n[00:05] Relatore 1: Buongiorno.")
    for blocco in ("# Evento", "# Agenda", "# Numeri della piattaforma", "# Sondaggi pubblicati",
                   "# Domande del pubblico", "# Trascrizione", "# Chat", "# Valutazioni dopo l'evento"):
        assert blocco in testo
    assert "d'accordo 7, non d'accordo 1" in testo
    assert "Relatore 1 (speaker, Ente di prova)" in testo
    assert "(partecipante, domanda) Si puo' registrare?" in testo


def test_pezzi_trascrizione_rispetta_il_limite():
    righe = [f"[00:{i:02d}] Voce 1: " + "parola " * 50 for i in range(60)]
    pezzi = rep.pezzi_trascrizione(righe, massimo=2000)
    assert len(pezzi) > 1
    assert all(len(p) <= 2000 for p in pezzi)
    assert "\n".join(pezzi).count("Voce 1") == 60


def test_normalizza_tiene_solo_la_forma_attesa():
    n = rep.normalizza(_risposta_valida())
    assert n["highlights"] == ["Uno", "Due"]
    assert n["topics"][0]["positions"] == [{"stance": "support", "text": "Piace"}]
    assert {x["id"] for x in n["conceptMap"]["nodes"]} == {"piattaforma", "ente"}
    assert n["conceptMap"]["nodes"][1]["kind"] == "concept"
    # L'arco verso un nodo che non c'e' se ne va.
    assert n["conceptMap"]["edges"] == [{"from": "ente", "to": "piattaforma", "label": "usa"}]
    assert n["consensus"] == {"summary": "", "agreements": [], "disagreements": []}


def test_genera_resoconto_riassume_a_pezzi_una_trascrizione_lunga(monkeypatch):
    chiamate = []

    def finto(**kw):
        chiamate.append(kw)
        if kw.get("json_mode"):
            return json.dumps(_risposta_valida())
        return "[00:01] Voce 1: nota"

    monkeypatch.setattr(llmmod, "_chat_completions", finto)
    monkeypatch.delenv("WORKER_STUB", raising=False)
    righe = [f"[00:{i % 60:02d}] Voce 1: " + "parola " * 80 for i in range(200)]
    out = rep.genera_resoconto(_ingresso(righe), base_url="http://llm/v1", model_id="m")
    note = [c for c in chiamate if not c.get("json_mode")]
    finale = [c for c in chiamate if c.get("json_mode")]
    assert len(note) > 1 and len(finale) == 1
    assert "# Note dalla trascrizione" in finale[0]["messages"][1]["content"]
    assert out["title"] == "Il resoconto"


def test_genera_resoconto_fallisce_senza_testo_utilizzabile(monkeypatch):
    monkeypatch.setattr(llmmod, "_chat_completions", lambda **kw: "{}")
    monkeypatch.delenv("WORKER_STUB", raising=False)
    with pytest.raises(RuntimeError):
        rep.genera_resoconto(_ingresso(), base_url="http://llm/v1", model_id="m")


def test_traduzione_conserva_minuti_e_mappa(monkeypatch):
    sorgente = rep.normalizza(_risposta_valida())
    tradotta = _risposta_valida(title="The report", abstract="We talked about the platform.")
    tradotta["topics"][0]["start"] = "99:99"
    tradotta["conceptMap"]["nodes"][0]["id"] = "platform"
    monkeypatch.setattr(llmmod, "_chat_completions", lambda **kw: json.dumps(tradotta))
    monkeypatch.delenv("WORKER_STUB", raising=False)
    out = rep.traduci_resoconto(sorgente, "en", base_url="http://llm/v1", model_id="m")
    assert out is not None
    assert out["title"] == "The report"
    assert out["topics"][0]["start"] == "00:05"
    # Gli id cambiati: resta la mappa della lingua dell'evento.
    assert {n["id"] for n in out["conceptMap"]["nodes"]} == {"piattaforma", "ente"}


def test_stub(monkeypatch):
    monkeypatch.setenv("WORKER_STUB", "1")
    out = rep.genera_resoconto(_ingresso(), base_url=None, model_id=None)
    assert out["topics"] and out["conceptMap"]["nodes"]


def test_una_riga_piu_lunga_di_un_pezzo_si_spezza_senza_perdere_testo():
    riga = "[00:00] Voce: " + "parola " * 6000
    pezzi = rep.pezzi_trascrizione([riga], massimo=10_000)
    assert len(pezzi) == 5
    assert all(len(p) <= 10_000 for p in pezzi)
    assert "".join(pezzi) == riga


def test_i_nodi_della_mappa_in_altri_alfabeti_restano():
    out = rep.normalizza({
        "abstract": "x",
        "conceptMap": {
            "nodes": [
                {"id": "διαφάνεια", "label": "Διαφάνεια", "kind": "topic"},
                {"id": "", "label": "Δημόσια διοίκηση", "kind": "actor"},
            ],
            "edges": [{"from": "διαφάνεια", "to": "δημόσια-διοίκηση", "label": "αφορά"}],
        },
    })
    ids = [n["id"] for n in out["conceptMap"]["nodes"]]
    assert ids == ["διαφανεια", "δημοσια-διοικηση"]
    assert out["conceptMap"]["edges"] == [{"from": "διαφανεια", "to": "δημοσια-διοικηση", "label": "αφορά"}]


def test_la_traduzione_che_cambia_gli_id_tiene_la_mappa_con_le_etichette_tradotte(monkeypatch):
    originale = rep.normalizza({
        "abstract": "Sintesi",
        "conceptMap": {
            "nodes": [{"id": "trasparenza", "label": "Trasparenza", "kind": "topic"},
                      {"id": "comuni", "label": "Comuni", "kind": "actor"}],
            "edges": [{"from": "comuni", "to": "trasparenza", "label": "applicano"}],
        },
    })
    tradotto = {
        "abstract": "Summary",
        "conceptMap": {
            "nodes": [{"id": "transparency", "label": "Transparency", "kind": "topic"},
                      {"id": "municipalities", "label": "Municipalities", "kind": "actor"}],
            "edges": [{"from": "municipalities", "to": "transparency", "label": "apply"}],
        },
    }
    monkeypatch.setattr(llmmod, "_stub_enabled", lambda: False)
    monkeypatch.setattr(llmmod, "_chat_completions", lambda **_: json.dumps(tradotto))
    out = rep.traduci_resoconto(originale, "en", base_url="http://llm", model_id="m")
    assert [n["id"] for n in out["conceptMap"]["nodes"]] == ["trasparenza", "comuni"]
    assert [n["label"] for n in out["conceptMap"]["nodes"]] == ["Transparency", "Municipalities"]
    assert out["conceptMap"]["edges"] == originale["conceptMap"]["edges"]


def test_genera_resoconto_rinnova_il_lease_a_ogni_pezzo(monkeypatch):
    righe = [f"[00:{i:02d}] Voce: " + "parola " * 900 for i in range(10)]
    monkeypatch.setattr(llmmod, "_stub_enabled", lambda: False)
    monkeypatch.setattr(
        llmmod,
        "_chat_completions",
        lambda **kw: json.dumps({"abstract": "Sintesi", "topics": []}) if kw.get("json_mode") else "note",
    )
    passi = []
    rep.genera_resoconto(
        {"language": "it", "transcript": {"lines": righe}},
        base_url="http://llm",
        model_id="m",
        avanzamento=lambda pct, msg: passi.append((pct, msg)),
    )
    pezzi = len(rep.pezzi_trascrizione(righe))
    assert pezzi > 1
    assert len(passi) == pezzi + 1
    assert passi[-1] == (40.0, "writing report")
