"""Test del glossario: funzioni pure, nessun modello."""

import glossary as g

TERMS = g.parse(
    [
        {"term": "ABC", "aliases": ["a bi ci"], "reading": "spell", "note": "Agenzia di esempio"},
        {"term": "SPID", "aliases": ["spid"], "reading": "word"},
        {"term": "PagoPA", "aliases": ["pago pa", "pagopa"], "spoken": {"*": "pago P-A"}},
        {"term": "a11y", "aliases": ["a undici ipsilon"], "reading": "word", "spoken": {"*": "accessibility"}},
        {"term": "IA", "reading": "spell", "translations": {"en": "AI", "de": "KI"}},
        {"term": "GDPR", "reading": "spell", "translations": {"fr": "RGPD"}},
        {"term": "", "aliases": ["vuoto"]},
        "non una voce",
    ]
)


def test_parse_scarta_voci_senza_termine():
    assert [t.term for t in TERMS] == ["ABC", "SPID", "PagoPA", "a11y", "IA", "GDPR"]
    assert g.parse(None) == []
    assert g.parse([{"term": "X", "reading": "boh"}])[0].reading == "auto"


def test_normalize_forme_dette_e_sigle_compitate():
    assert g.normalize_text("Il sito a undici ipsilon e' pronto", TERMS) == "Il sito a11y e' pronto"
    assert g.normalize_text("A, undici, ipsilon.", TERMS) == "a11y."
    assert g.normalize_text("accedi con spid o con Pago PA", TERMS) == "accedi con SPID o con PagoPA"
    assert g.normalize_text("la A.B.C. ha scritto", TERMS) == "la ABC. ha scritto"
    assert g.normalize_text("secondo A B C", TERMS) == "secondo ABC"
    # Non dentro altre parole, e le lettere minuscole compitate restano.
    assert g.normalize_text("spiderman e a b c", TERMS) == "spiderman e a b c"


def test_realign_words_gruppo_sostituito():
    words = [
        {"word": "il", "start": 0.0, "end": 0.2},
        {"word": "a", "start": 0.3, "end": 0.6},
        {"word": "undici", "start": 0.6, "end": 0.9},
        {"word": "ipsilon", "start": 0.9, "end": 1.2, "score": 0.8},
        {"word": "regge", "start": 1.3, "end": 1.6},
    ]
    out = g.realign_words(words, "il a11y regge")
    assert [w["word"] for w in out] == ["il", "a11y", "regge"]
    assert out[1]["start"] == 0.3 and out[1]["end"] == 1.2
    assert out[2] == {"word": "regge", "start": 1.3, "end": 1.6}


def test_realign_words_parola_aggiunta_e_niente_parole():
    words = [{"word": "ciao", "start": 1.0, "end": 1.4}, {"word": "a", "start": 1.5, "end": 1.6}]
    out = g.realign_words(words, "ciao a tutti")
    assert out[2]["word"] == "tutti" and out[2]["start"] == 1.6
    assert g.realign_words(None, "x") is None
    assert g.realign_words([], "x") is None


def test_apply_text_aggiorna_testo_e_parole():
    segs = [
        {"text": "uno a undici ipsilon", "words": [
            {"word": "uno", "start": 0, "end": 1}, {"word": "a", "start": 1, "end": 2},
            {"word": "undici", "start": 2, "end": 3}, {"word": "ipsilon", "start": 3, "end": 4}]},
        {"text": "senza parole"},
        {"text": "uguale"},
    ]
    n = g.apply_text(segs, ["uno a11y", "senza parole!", "uguale"])
    assert n == 2
    assert segs[0]["words"][1] == {"word": "a11y", "start": 1.0, "end": 4.0}
    assert "words" not in segs[1]


def test_correction_is_safe():
    assert g.correction_is_safe("la a bi ci ha detto", "la ABC ha detto")
    assert g.correction_is_safe("parliamo di spid oggi", "parliamo di SPID oggi")
    assert g.correction_is_safe("ha parlato Rosi", "ha parlato Rossi")
    # Righe corte riscritte: restano quelle originali.
    assert not g.correction_is_safe("Sì, grazie.", "Grazie a tutti.")
    assert not g.correction_is_safe("ok si", "tutt altro testo qui")
    assert not g.correction_is_safe("ok", "Buongiorno")
    # Un termine noto si accetta anche se non somiglia a cio' che c'era.
    assert g.correction_is_safe("ne parla la agenzia", "ne parla la ABC", {"abc"})
    assert not g.correction_is_safe("ne parla la agenzia", "ne parla la ABC")
    # Parole tolte senza sostituto: no.
    assert not g.correction_is_safe("allora diciamo che va bene", "allora va bene")
    assert not g.correction_is_safe("buongiorno a tutti", "")
    assert not g.correction_is_safe(
        "allora vediamo un attimo come procedere con il punto due",
        "Il relatore propone di rinviare la discussione alla prossima riunione",
    )


def test_protect_restore():
    text, rep = g.protect("La ABC e il GDPR, poi IA e ancora ABC", TERMS, "fr")
    assert "ABC" not in text and text.count("⟦") == 4
    assert rep == ["ABC", "RGPD", "IA", "ABC"]
    tradotto = text.replace("La ", "L'").replace(" e il ", " et le ")
    assert g.restore(tradotto, rep) == "L'ABC et le RGPD, poi IA e ancora ABC"
    # Segnaposto perso o duplicato: None.
    assert g.restore("⟦1⟧ ⟦2⟧", rep) is None
    assert g.restore("⟦ 1 ⟧", ["X"]) == "X"
    assert g.protect("niente", TERMS, "en") == ("niente", [])


def test_terms_in_e_regole():
    presenti = g.terms_in("Con IA e SPID", TERMS)
    assert [t.term for t in presenti] == ["SPID", "IA"]
    regole = g.translation_rules(presenti, "en")
    assert '"SPID": keep it as "SPID"' in regole and '"IA": always "AI"' in regole


def test_speakable_per_lingua():
    assert g.speakable("La ABC e SPID", TERMS, "it") == "La A-B-C e Spid"
    assert g.speakable("Use AI with a11y and PagoPA", TERMS, "en") == "Use A-I with accessibility and pago P-A"
    assert g.speakable("Die KI", TERMS, "de") == "Die K-I"
    # La traduzione di un'altra lingua non si tocca.
    assert g.speakable("AI", TERMS, "de") == "AI"
    assert g.spell("a11y") == "a-1-1-y"


def test_correction_terms():
    out = g.correction_terms(TERMS[:2], ["Relatore 1", ""])
    assert out == ["Relatore 1", "ABC (Agenzia di esempio)", "SPID"]


def test_normalize_non_raddoppia_un_alias_dentro_il_termine():
    t = g.parse([{"term": "Nome Cognome", "aliases": ["cognome"]}])
    assert g.normalize_text("Ha parlato Nome Cognome", t) == "Ha parlato Nome Cognome"
    assert g.normalize_text("Cognome ha detto", t) == "Nome Cognome ha detto"
    assert g.normalize_text("nome cognome ha detto", t) == "Nome Cognome ha detto"
    assert g.normalize_text("Nome-Cognome ha detto", t) == "Nome Cognome ha detto"
    once = g.normalize_text("Nome Cognome e poi cognome", t)
    assert once == "Nome Cognome e poi Nome Cognome"
    assert g.normalize_text(once, t) == once


def test_normalize_termini_con_simboli_e_frasi_separate():
    t = g.parse([{"term": "A\\B", "aliases": ["a b"]}, {"term": "C#", "aliases": ["c#"]},
                 {"term": "PagoPA", "aliases": ["pago pa"]}])
    assert g.normalize_text("scrivi a b qui", t) == "scrivi A\\B qui"
    assert g.normalize_text("c'è il c# qui", t) == "c'è il C# qui"
    assert g.normalize_text("ho pago. Pa dopo", t) == "ho pago. Pa dopo"


def test_speakable_traduzione_di_piu_parole_si_legge_com_e():
    t = g.parse([{"term": "ABC", "reading": "spell", "translations": {"en": "Example Agency"}}])
    assert g.speakable("The Example Agency said", t, "en") == "The Example Agency said"
    assert g.speakable("La ABC", t, "it") == "La A-B-C"
