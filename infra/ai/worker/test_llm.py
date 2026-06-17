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
