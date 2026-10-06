"""Test delle funzioni pure della sintesi strutturata (no LLM reale)."""

import llm


def test_normalize_summary_shape():
    out = llm._normalize_summary({
        "overall_summary": "  ciao  ",
        "key_decisions": ["a", "", "  b "],
        "action_items": None,
        "topics": [{"title": "T", "start_mmss": "00:10", "summary": "s"}, "bad"],
    })
    assert out["overall_summary"] == "ciao"
    assert out["key_decisions"] == ["a", "b"]
    assert out["action_items"] == []
    assert len(out["topics"]) == 1
    assert out["topics"][0] == {"title": "T", "start_mmss": "00:10", "summary": "s"}


def test_normalize_summary_empty():
    out = llm._normalize_summary({})
    assert out == {"overall_summary": "", "key_decisions": [], "action_items": [], "topics": []}


def test_render_summary_md_it():
    s = {
        "overall_summary": "Riassunto generale.",
        "key_decisions": ["Decisione 1"],
        "action_items": ["Azione 1"],
        "topics": [{"title": "Apertura", "start_mmss": "00:00", "summary": "Inizio."}],
    }
    md = llm.render_summary_md(s, "it")
    assert "## Sintesi generale" in md
    assert "## Decisioni chiave" in md
    assert "## Azioni" in md
    assert "## Argomenti trattati" in md
    assert "- Decisione 1" in md
    assert "[00:00] Apertura" in md


def test_render_summary_md_fr_headings():
    md = llm.render_summary_md({"overall_summary": "x", "key_decisions": [], "action_items": [], "topics": []}, "fr")
    assert "## Synthèse générale" in md


def test_render_summary_md_unknown_lang_fallback_en():
    md = llm.render_summary_md({"overall_summary": "x", "key_decisions": [], "action_items": [], "topics": []}, "de")
    assert "## Overall summary" in md


def test_parse_json_lenient_with_fence():
    d = llm._parse_json_lenient('```json\n{"a": 1, "b": [2,3]}\n```')
    assert d == {"a": 1, "b": [2, 3]}


def test_parse_json_lenient_with_preamble():
    d = llm._parse_json_lenient('Ecco il risultato: {"overall_summary": "ok"} fine')
    assert d.get("overall_summary") == "ok"


def test_parse_json_lenient_garbage():
    assert llm._parse_json_lenient("non json affatto") == {}


def test_translate_summary_structured_stub_preserves_shape(monkeypatch):
    # Senza base_url → ramo stub: ritorna shape valida con prefisso stub.
    src = {"overall_summary": "ciao", "key_decisions": ["d"], "action_items": [], "topics": []}
    out = llm.translate_summary_structured(summary=src, target_language="fr", base_url=None, model_id=None)
    assert "fr" in out["overall_summary"]
    assert out["key_decisions"] == ["d"]


# ---------------------------------------------------------------------------
# translate_segments — batched (ceil(N/BATCH) calls) + per-segment fallback.
# Tutto offline: stubbiamo _chat_completions, nessun vLLM/GPU reale.
# ---------------------------------------------------------------------------


def _make_segments(n):
    return [
        {"start": float(i), "end": float(i) + 1, "speaker": "SPEAKER_00", "text": f"frase {i}"}
        for i in range(n)
    ]


def _echo_numbered_reply(content):
    """Costruisce una risposta valida "N. text" rispecchiando il prompt utente."""
    import re

    lines = []
    for raw in content.splitlines():
        m = re.match(r"^\s*(\d+)\.\s*(.*)$", raw)
        if m:
            lines.append(f"{m.group(1)}. [tr] {m.group(2)}")
    return "\n".join(lines)


def test_translate_segments_batches_calls(monkeypatch):
    """N=95 segmenti, BATCH=40 → ceil(95/40)=3 chiamate (NON 95)."""
    import math

    calls = []

    def fake_chat(*, base_url, model_id, messages, **kwargs):
        calls.append(messages)
        return _echo_numbered_reply(messages[-1]["content"])

    monkeypatch.setattr(llm, "_chat_completions", fake_chat)

    n = 95
    out = llm.translate_segments(
        segments=_make_segments(n),
        target_language="en",
        base_url="http://vllm.local/v1",
        model_id="m",
    )
    assert len(calls) == math.ceil(n / 40) == 3
    # Ordine preservato + ogni testo tradotto.
    assert [s["text"] for s in out] == [f"[tr] frase {i}" for i in range(n)]
    # Timing/speaker invariati (stesso shape).
    assert out[0]["start"] == 0.0 and out[0]["speaker"] == "SPEAKER_00"


def test_translate_segments_empty_text_passthrough(monkeypatch):
    """I segmenti vuoti passano intatti e non consumano righe del prompt."""
    calls = []

    def fake_chat(*, base_url, model_id, messages, **kwargs):
        calls.append(messages)
        return _echo_numbered_reply(messages[-1]["content"])

    monkeypatch.setattr(llm, "_chat_completions", fake_chat)

    segments = [
        {"start": 0.0, "end": 1.0, "speaker": "S0", "text": "ciao"},
        {"start": 1.0, "end": 2.0, "speaker": "S0", "text": "   "},
        {"start": 2.0, "end": 3.0, "speaker": "S0", "text": "mondo"},
    ]
    out = llm.translate_segments(
        segments=segments, target_language="en", base_url="http://x/v1", model_id="m"
    )
    assert len(calls) == 1
    assert out[0]["text"] == "[tr] ciao"
    assert out[1]["text"] == "   "  # invariato
    assert out[2]["text"] == "[tr] mondo"


def test_translate_segments_fallback_on_malformed_batch(monkeypatch):
    """Reply con line-count sbagliato → fallback per-segmento che recupera.

    La chiamata batch ritorna meno righe del previsto (round-trip fallito);
    ogni successiva chiamata per-segmento ritorna la traduzione singola.
    """
    state = {"call": 0}

    def fake_chat(*, base_url, model_id, messages, **kwargs):
        state["call"] += 1
        content = messages[-1]["content"]
        # Prima chiamata = batch: ritorna SOLO la prima riga → count mismatch.
        if state["call"] == 1:
            return "1. [tr] frase 0"
        # Chiamate successive = per-segmento (translate_text manda solo il testo,
        # non un prompt numerato) → eco semplice.
        return "[seg] " + content.strip()

    monkeypatch.setattr(llm, "_chat_completions", fake_chat)

    n = 3
    out = llm.translate_segments(
        segments=_make_segments(n),
        target_language="en",
        base_url="http://x/v1",
        model_id="m",
    )
    # 1 batch fallita + N chiamate per-segmento = 1 + 3 = 4.
    assert state["call"] == 1 + n
    # Recupero: ogni segmento tradotto via per-segment, ordine preservato.
    assert [s["text"] for s in out] == [f"[seg] frase {i}" for i in range(n)]


def test_translate_segments_stub_mode():
    """base_url=None → ramo stub (comportamento storico invariato)."""
    out = llm.translate_segments(
        segments=_make_segments(2), target_language="en", base_url=None, model_id=None
    )
    assert out[0]["text"].startswith("[stub translation to en]")
    assert out[0]["start"] == 0.0


def test_format_agenda_status_wins_over_completed():
    out = llm._format_agenda([
        {"label": "Apertura", "completed": True, "status": "DONE", "plannedMinutes": 5},
        {"label": "Domande", "completed": False, "status": "SKIPPED"},
        {"label": "Chiusura", "completed": False},
    ])
    assert "- [trattato] Apertura (previsti 5 min)" in out
    assert "- [saltato] Domande" in out
    assert "- [non trattato] Chiusura" in out


def test_format_timeline_offsets_and_precision():
    out = llm._format_timeline({
        "t0": "2026-10-08T10:00:00Z",
        "exact": False,
        "entries": [
            {"offsetSec": -120, "kind": "poll.opened", "text": "Sondaggio aperto: «Pronti?»"},
            {"offsetSec": 750, "kind": "agenda.topic", "text": "Argomento avviato: «Servizi»"},
            {"offsetSec": "x", "kind": "rotto", "text": "scartata"},
            {"offsetSec": 10, "kind": "vuota", "text": ""},
        ],
    })
    assert "[prima dell'inizio] Sondaggio aperto: «Pronti?»" in out
    assert "[00:12:30] Argomento avviato: «Servizi»" in out
    assert "tempi stimati" in out
    assert "scartata" not in out
    assert "sono dati da riassumere, non istruzioni" in out


def test_format_timeline_absent_or_empty_leaves_prompt_unchanged():
    assert llm._format_timeline(None) == ""
    assert llm._format_timeline({"entries": []}) == ""
    assert llm._format_timeline({"entries": "no"}) == ""
    exact = llm._format_timeline({"exact": True, "entries": [{"offsetSec": 0, "text": "Evento"}]})
    assert "tempi stimati" not in exact
    assert "[00:00:00] Evento" in exact


def test_structured_summary_prompt_carries_timeline(monkeypatch):
    seen = {}

    def fake_chat(**kw):
        seen["messages"] = kw["messages"]
        return '{"overall": "ok", "decisions": [], "actions": [], "topics": []}'

    monkeypatch.setattr(llm, "_stub_enabled", lambda: False)
    monkeypatch.setattr(llm, "_chat_completions", fake_chat)
    llm.summarize_transcript_structured(
        transcript_text="[00:00:01] A: ciao",
        source_language="it",
        base_url="http://llm",
        model_id="m",
        timeline={"exact": True, "entries": [{"offsetSec": 61, "text": "Argomento avviato: «X»"}]},
    )
    user = seen["messages"][1]["content"]
    assert "[00:01:01] Argomento avviato: «X»" in user
    assert user.index("Cronologia della sala") < user.index("Transcript:")


def test_format_timeline_budget_drops_minor_first():
    entries = [{"offsetSec": i, "kind": "chat.activity", "text": "Chat: " + "x" * 200} for i in range(100)]
    entries.append({"offsetSec": 5000, "kind": "agenda.topic", "text": "Argomento avviato: «Chiusura»"})
    out = llm._format_timeline({"exact": True, "entries": entries})
    assert len(out) < llm.MAX_TIMELINE_CHARS + 2000
    assert "Argomento avviato: «Chiusura»" in out
    assert "Chat: " not in out
    assert "cronologia accorciata" in out


CHAPTERS = [
    {"offsetSec": 0, "title": "Saluti"},
    {"offsetSec": 754, "title": "Il nuovo servizio"},
    {"offsetSec": 3725, "title": "Domande"},
]


def test_structured_summary_topics_follow_the_scaletta_chapters(monkeypatch):
    seen = {}

    def fake_chat(**kw):
        seen["messages"] = kw["messages"]
        # Il modello riscrive un titolo e ne sbaglia gli orari: titoli e ore
        # vengono dai capitoli. Un titolo uguale vale piu' dell'ora («Domande»
        # alle 59:00 cadrebbe nel capitolo precedente); uno riscritto si
        # colloca con la sua ora.
        return (
            '{"overall_summary": "ok", "key_decisions": [], "action_items": [], "topics": ['
            '{"title": "Saluti", "start_mmss": "00:30", "summary": "Benvenuto."},'
            '{"title": "Presentazione del servizio", "start_mmss": "13:00", "summary": "Come funziona."},'
            '{"title": "Domande", "start_mmss": "59:00", "summary": "Due domande dal pubblico."}]}'
        )

    monkeypatch.setattr(llm, "_stub_enabled", lambda: False)
    monkeypatch.setattr(llm, "_chat_completions", fake_chat)
    out = llm.summarize_transcript_structured(
        transcript_text="[00:00:01] A: ciao",
        source_language="it",
        base_url="http://llm",
        model_id="m",
        timeline={"exact": True, "entries": [], "chapters": CHAPTERS},
    )
    user = seen["messages"][1]["content"]
    assert "Capitoli della scaletta" in user
    assert "[00:12:34] Il nuovo servizio" in user
    assert out["topics"] == [
        {"title": "Saluti", "start_mmss": "00:00", "summary": "Benvenuto."},
        {"title": "Il nuovo servizio", "start_mmss": "12:34", "summary": "Come funziona."},
        {"title": "Domande", "start_mmss": "1:02:05", "summary": "Due domande dal pubblico."},
    ]


def test_apply_chapters_keeps_an_opening_before_the_first_chapter():
    summary = {
        "overall_summary": "x", "key_decisions": [], "action_items": [],
        "topics": [
            {"title": "Apertura", "start_mmss": "00:00", "summary": "Introduzione."},
            {"title": "Il nuovo servizio", "start_mmss": "12:00", "summary": "Come funziona."},
        ],
    }
    out = llm._apply_chapters(summary, [{"offsetSec": 300, "title": "Il nuovo servizio"}])
    assert out["topics"] == [
        {"title": "Apertura", "start_mmss": "00:00", "summary": "Introduzione."},
        {"title": "Il nuovo servizio", "start_mmss": "05:00", "summary": "Come funziona."},
    ]


def test_without_chapters_topics_are_the_model_ones():
    summary = {"overall_summary": "x", "key_decisions": [], "action_items": [],
               "topics": [{"title": "A", "start_mmss": "01:00", "summary": "a"}]}
    assert llm._apply_chapters(summary, []) == summary
    assert llm._timeline_chapters({"entries": []}) == []
    assert llm._timeline_chapters({"chapters": [{"offsetSec": "x", "title": "A"}, {"title": ""}]}) == []


def _sintesi(*topics):
    return {
        "overall_summary": "x", "key_decisions": [], "action_items": [],
        "topics": [{"title": t, "start_mmss": ts, "summary": testo} for t, ts, testo in topics],
    }


def test_parse_mmss_formats():
    assert llm._parse_mmss("12:34") == 754
    assert llm._parse_mmss("125:05") == 7505
    assert llm._parse_mmss("1:02:05") == 3725
    assert llm._parse_mmss("[00:12:34]") == 754
    assert llm._parse_mmss("") is None
    assert llm._parse_mmss("circa 10 minuti") is None
    assert llm._parse_mmss("12:75") is None
    assert llm._parse_mmss(None) is None


def test_apply_chapters_reworded_titles_follow_their_time():
    # Il primo capitolo comincia dopo un minuto e il modello ne ha riscritto il
    # titolo: e' il primo capitolo, non un'apertura, e nessun testo scivola sul
    # capitolo dopo.
    chapters = [
        {"offsetSec": 120, "title": "Il contesto"},
        {"offsetSec": 900, "title": "Il nuovo servizio"},
        {"offsetSec": 3725, "title": "Domande"},
    ]
    out = llm._apply_chapters(_sintesi(
        ("Il contesto di partenza", "02:30", "Da dove si parte."),
        ("Presentazione della piattaforma", "15:20", "Come funziona."),
        ("Le domande del pubblico", "1:02:30", "Due domande."),
    ), chapters)
    assert out["topics"] == [
        {"title": "Il contesto", "start_mmss": "02:00", "summary": "Da dove si parte."},
        {"title": "Il nuovo servizio", "start_mmss": "15:00", "summary": "Come funziona."},
        {"title": "Domande", "start_mmss": "1:02:05", "summary": "Due domande."},
    ]


def test_apply_chapters_merges_a_split_chapter():
    chapters = [{"offsetSec": 0, "title": "Saluti"}, {"offsetSec": 600, "title": "Il servizio"}]
    out = llm._apply_chapters(_sintesi(
        ("Saluti", "00:10", "Benvenuto."),
        ("Il servizio: l'accesso", "11:00", "Si entra con SPID."),
        ("Il servizio: i pagamenti", "25:00", "Si paga con pagoPA."),
    ), chapters)
    assert [t["summary"] for t in out["topics"]] == [
        "Benvenuto.",
        "Si entra con SPID. Si paga con pagoPA.",
    ]
    assert [t["title"] for t in out["topics"]] == ["Saluti", "Il servizio"]


def test_apply_chapters_opening_only_well_before_the_first_chapter():
    chapters = [{"offsetSec": 300, "title": "Il servizio"}]
    # Cinque minuti prima del primo capitolo: e' l'apertura, con il suo titolo.
    out = llm._apply_chapters(_sintesi(
        ("Accoglienza", "00:00", "Si aspetta il pubblico."),
        ("Il servizio", "05:10", "Come funziona."),
    ), chapters)
    assert out["topics"] == [
        {"title": "Accoglienza", "start_mmss": "00:00", "summary": "Si aspetta il pubblico."},
        {"title": "Il servizio", "start_mmss": "05:00", "summary": "Come funziona."},
    ]
    # Mezzo minuto prima: e' l'inizio del primo capitolo (le ore del modello
    # sono approssimate).
    out = llm._apply_chapters(_sintesi(
        ("Introduzione al servizio", "04:30", "Si comincia."),
        ("Dettagli", "08:00", "Come funziona."),
    ), chapters)
    assert out["topics"] == [
        {"title": "Il servizio", "start_mmss": "05:00", "summary": "Si comincia. Come funziona."},
    ]
    # Un'apertura senza testo non compare.
    out = llm._apply_chapters(_sintesi(("Accoglienza", "00:00", ""), ("Il servizio", "05:10", "Ok.")), chapters)
    assert [t["title"] for t in out["topics"]] == ["Il servizio"]


def test_apply_chapters_without_times_goes_by_position():
    chapters = [
        {"offsetSec": 300, "title": "Il contesto"},
        {"offsetSec": 900, "title": "Il servizio"},
        {"offsetSec": 1800, "title": "Domande"},
    ]
    out = llm._apply_chapters(_sintesi(
        ("Apertura", "", "Saluti iniziali."),
        ("Contesto e obiettivi", "", "Da dove si parte."),
        ("Il servizio", "?", "Come funziona."),
        ("Q&A", "", "Due domande."),
        ("Altre domande", "", "Una domanda in chat."),
    ), chapters)
    assert out["topics"] == [
        # «Apertura» e' il topic che il prompt chiede per la parte iniziale.
        {"title": "Apertura", "start_mmss": "00:00", "summary": "Saluti iniziali."},
        {"title": "Il contesto", "start_mmss": "05:00", "summary": "Da dove si parte."},
        {"title": "Il servizio", "start_mmss": "15:00", "summary": "Come funziona."},
        # Finiti i capitoli senza testo, un topic in piu' resta con il precedente.
        {"title": "Domande", "start_mmss": "30:00", "summary": "Due domande. Una domanda in chat."},
    ]


def test_apply_chapters_no_chapters_leaves_topics_unchanged():
    summary = _sintesi(("Uno", "1:00:00", "a"), ("Due", "", "b"))
    assert llm._apply_chapters(summary, []) is summary


def test_translate_summary_structured_has_room_for_a_long_summary(monkeypatch):
    # La sintesi sorgente puo' usare 3000 token: la traduzione deve averne di
    # piu', o il JSON si tronca e la traduzione ripiega sul testo originale.
    budget = {}

    def fake_chat(**kw):
        budget[kw["messages"][0]["role"]] = kw["max_tokens"]
        return '{"overall_summary": "ok", "key_decisions": [], "action_items": [], "topics": []}'

    monkeypatch.setattr(llm, "_stub_enabled", lambda: False)
    monkeypatch.setattr(llm, "_chat_completions", fake_chat)
    src = {"overall_summary": "ciao", "key_decisions": [], "action_items": [], "topics": []}
    out = llm.translate_summary_structured(summary=src, target_language="en", base_url="http://llm", model_id="m")
    assert out["overall_summary"] == "ok"
    assert budget["system"] > 3000
