"""La traduzione di titolo e descrizione dell'evento (lavoro TRANSLATE_TEXT):
richiesta al motore, Markdown, link, segnaposto, lingue, consegna."""

from __future__ import annotations

import json
import re

import httpx
import pytest

from . import glossary as gl
from . import llm as llmmod
from . import text_translate as tt

RICHIESTA = re.compile(r"^Translate the following (\w+) source text to (\w+):\n\1: (.*) \n\2: $", re.S)


class FintoMotore:
    """Al posto di /chat/completions: controlla la forma della richiesta e
    "traduce" mettendo la lingua davanti, o con la funzione data."""

    def __init__(self, monkeypatch, traduci=None):
        self.richieste = []
        self.traduci = traduci or (lambda testo, dst: f"[{dst}] {testo}")
        monkeypatch.setattr(llmmod, "_chat_completions", self)
        monkeypatch.delenv("WORKER_STUB", raising=False)

    def __call__(self, *, base_url, model_id, messages, temperature, max_tokens, timeout, connect_wait,
                 fail_if_unresolvable, **_):
        assert base_url == "http://mt:8080/v1" and model_id == "modello"
        # Un solo messaggio dell'utente, nessun prompt di sistema, temperatura 0.
        assert len(messages) == 1 and messages[0]["role"] == "user"
        assert temperature == 0.0 and fail_if_unresolvable
        m = RICHIESTA.match(messages[0]["content"])
        assert m, messages[0]["content"]
        testo, dst = m.group(3), m.group(2)
        assert max_tokens == min(2048, 64 + int(1.5 * len(testo)))
        self.richieste.append((testo, dst, connect_wait))
        # Il modello comincia la risposta andando a capo.
        return " \n" + self.traduci(testo, dst)


def _motore():
    return tt.Motore("http://mt:8080/v1", "modello")


def test_prima_riga_toglie_a_capo_ed_etichette():
    assert tt.prima_riga(" \nGerman: Hallo Welt\nItalian: altro", "Italian", "German") == "Hallo Welt"
    assert tt.prima_riga("\n\n", "Italian", "German") == ""


def test_link_e_immagini_tornano_al_loro_posto():
    riga, link = tt.estrai_link("Vedi il [programma](https://x.example/p \"Titolo\") e ![logo](/l.png).")
    assert riga == "Vedi il <a1>programma</a1> e <a2>logo</a2>."
    assert tt.rimetti_link("See the <a1>schedule</a1> and <a2> logo </a2>.", link) == (
        'See the [schedule](https://x.example/p "Titolo") and ![logo](/l.png).'
    )
    # Un segnaposto perso o doppio non si accetta.
    assert tt.rimetti_link("See the schedule and <a2>logo</a2>.", link) is None
    assert tt.rimetti_link("<a1>a</a1><a1>b</a1><a2>c</a2>", link) is None


def test_indirizzi_email_e_glossario_protetti_con_numerazione_unica():
    termini = gl.parse([{"term": "PA Webinar", "translations": {"de": "PA Webinar"}}])
    testo, sostituzioni = tt.proteggi(
        "Scrivi a eventi@comune.example.it o vai su https://pa.example/x?y=1, con PA Webinar.", termini, "de"
    )
    assert testo == "Scrivi a ⟦2⟧ o vai su ⟦3⟧, con ⟦1⟧."
    assert sostituzioni == ["PA Webinar", "eventi@comune.example.it", "https://pa.example/x?y=1"]
    assert gl.restore("Schreib an ⟦2⟧ oder ⟦3⟧, mit ⟦1⟧.", sostituzioni) == (
        "Schreib an eventi@comune.example.it oder https://pa.example/x?y=1, mit PA Webinar."
    )


@pytest.mark.parametrize(
    "riga,prefisso,testo",
    [
        ("## Titolo", "## ", "Titolo"),
        ("- voce", "- ", "voce"),
        ("  * voce annidata", "  * ", "voce annidata"),
        ("12. punto", "12. ", "punto"),
        ("> - citata", "> - ", "citata"),
        ("- [x] fatto", "- [x] ", "fatto"),
        ("**Grassetto** iniziale", "", "**Grassetto** iniziale"),
        ("Testo semplice", "", "Testo semplice"),
        # Il rientro senza segni (il seguito di una voce) e' prefisso anche lui.
        ("  seguito della voce", "  ", "seguito della voce"),
        ("\tcon il tab", "\t", "con il tab"),
        (">   rientrata", ">   ", "rientrata"),
    ],
)
def test_prefisso_markdown(riga, prefisso, testo):
    assert tt.dividi_prefisso(riga) == (prefisso, testo)


def test_markdown_riga_per_riga_con_struttura_intatta(monkeypatch):
    finto = FintoMotore(monkeypatch)
    sorgente = "\n".join([
        "## Di cosa parliamo",
        "",
        "Un incontro con **esempi** e il [programma](https://x.example/programma).",
        "- Prima voce",
        "1. Primo passo",
        "> Una citazione",
        "---",
        "```",
        "codice da non tradurre",
        "```",
        "| Ora | Tema |",
        "|---|---|",
        "| 10:00 | Apertura |",
    ])
    tradotto = tt.traduci_markdown(_motore(), sorgente, "it", "de")
    assert tradotto.split("\n") == [
        "## [German] Di cosa parliamo",
        "",
        "[German] Un incontro con **esempi** e il [programma](https://x.example/programma).",
        "- [German] Prima voce",
        "1. [German] Primo passo",
        "> [German] Una citazione",
        "---",
        "```",
        "codice da non tradurre",
        "```",
        "| [German] Ora | [German] Tema |",
        "|---|---|",
        "| 10:00 | [German] Apertura |",
    ]
    # Il prefisso non arriva al modello, l'indirizzo del link nemmeno.
    inviati = [r[0] for r in finto.richieste]
    assert "Di cosa parliamo" in inviati
    assert not any("https://" in r for r in inviati)


def test_markdown_rientri_conservati_e_codice_rientrato_non_tradotto(monkeypatch):
    finto = FintoMotore(monkeypatch)
    sorgente = [
        "- Voce",
        "  seguito della voce",
        "",
        "  Secondo paragrafo della voce",
        "  - Sottovoce",
        "",
        "    Paragrafo della sottovoce",
        "",
        "        codice nella sottovoce",
        "- Voce due",
        "",
        "1. Primo passo",
        "",
        "       codice nel passo",
        "",
        "Paragrafo",
        "    che continua",
        "",
        "    codice rientrato",
        "\tcodice con il tab",
        "",
        "## Titolo",
        "    codice dopo il titolo",
    ]
    tradotto = tt.traduci_markdown(_motore(), "\n".join(sorgente), "it", "de")
    assert tradotto.split("\n") == [
        "- [German] Voce",
        "  [German] seguito della voce",
        "",
        "  [German] Secondo paragrafo della voce",
        "  - [German] Sottovoce",
        "",
        "    [German] Paragrafo della sottovoce",
        "",
        "        codice nella sottovoce",
        "- [German] Voce due",
        "",
        "1. [German] Primo passo",
        "",
        "       codice nel passo",
        "",
        "[German] Paragrafo",
        "    [German] che continua",
        "",
        "    codice rientrato",
        "\tcodice con il tab",
        "",
        "## [German] Titolo",
        "    codice dopo il titolo",
    ]
    # Il codice rientrato non arriva al modello, il rientro nemmeno.
    inviati = [r[0] for r in finto.richieste]
    assert not any("codice" in r for r in inviati)
    assert all(r == r.strip() for r in inviati)


def test_riga_di_spazi_unificatori_non_apre_il_codice(monkeypatch):
    # Per il Markdown una riga di soli spazi unificatori non e' vuota: e' testo
    # del paragrafo, e la riga rientrata che segue lo continua.
    FintoMotore(monkeypatch)
    sorgente = "Il convegno presenta i risultati.\n\u00a0\n\tLe iscrizioni chiudono il 30 novembre."
    tradotto = tt.traduci_markdown(_motore(), sorgente, "it", "de")
    assert tradotto.split("\n") == [
        "[German] Il convegno presenta i risultati.",
        "\u00a0",
        "\t[German] Le iscrizioni chiudono il 30 novembre.",
    ]


def test_riga_senza_niente_da_tradurre_non_arriva_al_modello(monkeypatch):
    # Il modello butta via i segnaposto dei link: una riga con la sola
    # immagine non deve diventare una richiesta vuota con la risposta in fondo.
    finto = FintoMotore(monkeypatch, traduci=lambda testo, dst: re.sub(r"</?a\d+>", "", testo).upper())
    sorgente = "\n".join([
        "Titolo",
        "",
        "![](https://ente.example/banner.png)",
        "",
        "[→](https://ente.example) ![](https://ente.example/a.png)",
        "",
        "10:00 – 11:30",
        "",
        "Vai al [→](https://ente.example/p) programma",
    ])
    tradotto = tt.traduci_markdown(_motore(), sorgente, "it", "de")
    assert tradotto.split("\n") == [
        "TITOLO",
        "",
        "![](https://ente.example/banner.png)",
        "",
        "[→](https://ente.example) ![](https://ente.example/a.png)",
        "",
        "10:00 – 11:30",
        "",
        "VAI AL [→](https://ente.example/p) PROGRAMMA",
    ]
    # Il testo del link fatto di soli simboli non si traduce a parte.
    assert [r[0] for r in finto.richieste] == ["Titolo", "Vai al <a1>→</a1> programma", "Vai al → programma"]


def test_testo_vuoto_non_chiama_il_motore(monkeypatch):
    finto = FintoMotore(monkeypatch)
    m = _motore()
    assert m.traduci_frase("", "it", "de") == ""
    assert m.traduci_frase("  \n", "it", "de") == ""
    assert tt._traduci_semplice(m, "", "it", "de", []) == ""
    assert tt._traduci_semplice(m, "   ", "it", "de", []) == ""
    assert tt._traduci_semplice(m, "→", "it", "de", []) == "→"
    assert tt.traduci_riga(m, "", "it", "de") == ""
    assert finto.richieste == []
    monkeypatch.setenv("WORKER_STUB", "1")
    assert tt.Motore(None, None).traduci_frase(" ", "it", "en") == ""


def test_solo_indirizzi_e_glossario_non_arrivano_al_modello(monkeypatch):
    finto = FintoMotore(monkeypatch)
    termini = gl.parse([{"term": "Agenzia Esempio", "translations": {"de": "Beispielagentur"}}])
    m = _motore()
    assert tt.traduci_riga(m, "Agenzia Esempio", "it", "de", termini) == "Beispielagentur"
    assert tt.traduci_riga(m, "info@ente.example", "it", "de", termini) == "info@ente.example"
    assert tt.traduci_riga(m, "info@ente.example, Agenzia Esempio", "it", "de", termini) == (
        "info@ente.example, Beispielagentur"
    )
    assert finto.richieste == []


def test_link_perso_si_traduce_a_parte_senza_perderlo(monkeypatch):
    # Il modello butta via i segnaposto dei link.
    FintoMotore(monkeypatch, traduci=lambda testo, dst: re.sub(r"</?a\d+>", "", testo).replace("regolamento", "Regeln"))
    tradotto = tt.traduci_riga(_motore(), "Leggi il [regolamento](https://x.example/r.pdf).", "it", "de")
    assert tradotto == "Leggi il [Regeln](https://x.example/r.pdf)."


def test_segnaposto_perso_si_ritraduce_senza(monkeypatch):
    chiamate = []

    def traduci(testo, dst):
        chiamate.append(testo)
        return testo.replace("⟦1⟧", "qualcosa") if len(chiamate) == 1 else f"Schreib an {testo.split()[-1]}"

    FintoMotore(monkeypatch, traduci=traduci)
    assert tt.traduci_riga(_motore(), "Scrivi a info@ente.example", "it", "de") == "Schreib an info@ente.example"
    assert chiamate == ["Scrivi a ⟦1⟧", "Scrivi a info@ente.example"]


def test_titolo_con_sopratitolo_due_parti_e_un_solo_separatore(monkeypatch):
    finto = FintoMotore(monkeypatch, traduci=lambda testo, dst: f"{testo.upper()} | extra")
    assert tt.traduci_titolo(_motore(), "Ciclo | Il titolo", "it", "en") == "CICLO extra | IL TITOLO extra"
    assert [r[0] for r in finto.richieste] == ["Ciclo", "Il titolo"]
    # Senza sopratitolo nessun «|» inventato.
    assert "|" not in tt.traduci_titolo(_motore(), "Solo titolo", "it", "en")


def test_riga_lunga_divisa_in_frasi(monkeypatch):
    finto = FintoMotore(monkeypatch)
    frase = "Una frase abbastanza lunga da riempire il pezzo. " * 40
    tt.traduci_riga(_motore(), frase.strip(), "it", "en")
    assert len(finto.richieste) > 1
    assert all(len(r[0]) <= tt.PEZZO_MAX for r in finto.richieste)


def test_lingue_ignote_scadenza_e_lingua_fallita(monkeypatch):
    def traduci(testo, dst):
        if dst == "French":
            raise ValueError("risposta strana")
        return f"[{dst}] {testo}"

    FintoMotore(monkeypatch, traduci=traduci)
    passi = []
    esito = tt.traduci_testi(
        {"sourceLanguage": "it", "targetLanguages": ["it", "xx", "fr", "en", "de"], "title": "Titolo", "description": ""},
        base_url="http://mt:8080/v1",
        model_id="modello",
        avanzamento=lambda p, m: passi.append(m),
        # Dopo la prima lingua tradotta il tempo non basta piu'.
        tempo_rimasto=iter([1000.0, 1000.0, 0.0]).__next__,
    )
    assert esito.title == {"en": "[English] Titolo"}
    assert esito.description == {}
    assert esito.mancanti == ["xx", "fr", "de"]
    assert passi == ["translating to xx", "translating to fr", "translating to en", "translating to de"]


def test_motore_irraggiungibile_ferma_il_lavoro(monkeypatch):
    attese = []

    def giu(**kw):
        attese.append(kw["connect_wait"])
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(llmmod, "_chat_completions", giu)
    monkeypatch.delenv("WORKER_STUB", raising=False)
    monkeypatch.setenv("MT_CONNECT_WAIT_S", "42")
    with pytest.raises(tt.MotoreIrraggiungibile):
        tt.traduci_testi(
            {"sourceLanguage": "it", "targetLanguages": ["en", "de"], "title": "Titolo", "description": "Testo"},
            base_url="http://mt:8080/v1",
            model_id="modello",
        )
    # Si aspetta l'avvio una volta sola, e non si provano le altre lingue.
    assert attese == [42.0]


def test_dopo_la_prima_risposta_l_attesa_e_breve(monkeypatch):
    finto = FintoMotore(monkeypatch)
    monkeypatch.setenv("MT_CONNECT_WAIT_S", "600")
    m = _motore()
    m.traduci_frase("uno", "it", "en")
    m.traduci_frase("due", "it", "en")
    assert [r[2] for r in finto.richieste] == [600.0, tt.ATTESA_RIAVVIO_S]


def test_stub_senza_motore(monkeypatch):
    monkeypatch.setenv("WORKER_STUB", "1")
    esito = tt.traduci_testi(
        {"sourceLanguage": "it", "targetLanguages": ["en"], "title": "A | B", "description": "- [x](https://y)"},
        base_url=None,
        model_id=None,
    )
    assert esito.title == {"en": "[en] A | [en] B"}
    assert esito.description == {"en": "- [en] [x](https://y)"}


def _lavoro(text_input=None):
    from . import client as cli

    return cli.ClaimResponse(
        jobId="j",
        recordingId=None,
        kind="TRANSLATE_TEXT",
        payload={"eventId": "e", "sourceLanguage": "it", "targetLanguages": ["en"], "sourceHash": "a" * 64},
        attempts=3,
        leaseExpiresAt="2026-01-01T00:00:00Z",
        sourceDownloadUrl="",
        uploadTargets={},
        inputs=[],
        textInput=text_input
        if text_input is not None
        else {"sourceLanguage": "it", "targetLanguages": ["en"], "title": "Titolo", "description": "Testo"},
        providerHints=cli.ProviderHints(mtBaseUrl="http://mt:8080/v1", mtModelId="modello"),
    )


def test_run_translate_text_consegna_con_il_numero_del_claim(monkeypatch):
    from . import main

    FintoMotore(monkeypatch)
    consegne = []

    class App:
        def progress(self, job_id, status, attempt=None, **_):
            assert attempt == 3
            return {"status": "RUNNING"}

        def deliver_text_translation(self, **kw):
            consegne.append(kw)
            return {"ok": True, "languages": ["en"]}

    main.run_translate_text(App(), _lavoro())
    assert consegne == [{
        "job_id": "j",
        "title": {"en": "[English] Titolo"},
        "description": {"en": "[English] Testo"},
        "model_id": "modello",
        "attempt": 3,
    }]


def test_run_translate_text_si_ferma_se_il_lavoro_e_chiuso(monkeypatch):
    from . import main

    FintoMotore(monkeypatch)

    class App:
        def progress(self, *_a, **_k):
            return {"status": "RUNNING", "superseded": True}

        def deliver_text_translation(self, **_):
            raise AssertionError("non deve consegnare")

    with pytest.raises(main.LavoroChiuso):
        main.run_translate_text(App(), _lavoro())


def test_run_translate_text_senza_nessuna_lingua_fallisce(monkeypatch):
    from . import main

    FintoMotore(monkeypatch)

    class App:
        def progress(self, *_a, **_k):
            return {"status": "RUNNING"}

    lavoro = _lavoro({"sourceLanguage": "it", "targetLanguages": ["xx"], "title": "Titolo", "description": ""})
    with pytest.raises(RuntimeError, match="no language translated"):
        main.run_translate_text(App(), lavoro)


def test_run_one_esegue_la_traduzione_dei_testi(monkeypatch):
    from . import client as cli
    from . import main

    FintoMotore(monkeypatch)
    stati = []

    class App:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def claim(self):
            return _lavoro()

        def progress(self, job_id, status, **_):
            stati.append(status)
            return {"status": "RUNNING"}

        def deliver_text_translation(self, **_):
            return {"ok": True}

    monkeypatch.setattr(cli, "AppClient", App)
    assert main.run_one() == 0
    assert stati[-1] == "DONE" and "FAILED" not in stati


def test_deliver_text_translation_manda_lingue_e_numero_del_claim():
    from . import client as cli

    app = cli.AppClient.__new__(cli.AppClient)
    app.worker_id = "w"
    inviati = []

    def risposta(request):
        inviati.append((request.url.path, json.loads(request.content)))
        return httpx.Response(200, json={"ok": False, "superseded": True})

    app._client = httpx.Client(base_url="http://portale", transport=httpx.MockTransport(risposta))
    esito = app.deliver_text_translation(job_id="j", title={"en": "T"}, description={}, model_id="m", attempt=2)
    assert esito["superseded"] is True
    assert inviati == [(
        "/api/internal/event-text-translation",
        {"jobId": "j", "title": {"en": "T"}, "description": {}, "attempt": 2, "modelId": "m"},
    )]


def test_la_traduzione_dei_testi_e_del_worker_senza_gpu():
    from . import client as cli

    assert "TRANSLATE_TEXT" not in cli.GPU_WORKER_KINDS
    assert cli.cpu_kinds_ok(["SUMMARIZE", "TRANSLATE", "SUBTITLE", "ARCHIVE", "REPORT", "TRANSLATE_TEXT"])
