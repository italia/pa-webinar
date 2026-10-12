"""Test delle funzioni pure di glossary_check.py."""

from glossary_check import occurrences, proper_nouns, score


def test_proper_nouns_skips_sentence_and_quote_starts():
    text = '"Il presidente Mario Rossi ha parlato. Anche AgID era lì: Il resto no.'
    assert proper_nouns(text) == ["Mario Rossi", "AgID"]


def test_proper_nouns_keeps_acronyms_at_sentence_start():
    assert proper_nouns("FBI e CIA collaborano con la Francia.") == ["FBI", "CIA", "Francia"]


def test_occurrences_counts_phrases():
    assert occurrences(["a", "b", "a", "b"], ["a", "b"]) == 2
    assert occurrences(["a"], []) == 0


def test_score_separates_recall_from_collateral_damage():
    refs = {"x": "Ha parlato Mario Rossi.", "y": "Una frase qualunque."}
    hyps = {"x": "ha parlato mario rosi", "y": "una frase mario rossi qualunque"}
    result = score(refs, hyps, ["Mario Rossi"])
    assert result["term_recall"] == 0.0
    assert result["term_occurrences"] == 1
    assert result["false_term_insertions"] == 1
    assert result["wer_without_terms"] == 2 / 3
