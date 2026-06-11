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
