import pytest

nltk_data = pytest.importorskip("nltk.data")

import punkt_params


def test_written_params_split_sentences_like_untrained_punkt(tmp_path, monkeypatch):
    punkt_params.write_params(str(tmp_path), ["italian", "english"])
    monkeypatch.setattr(nltk_data, "path", [str(tmp_path)])
    # Lo stesso percorso che chiede l'allineamento di WhisperX.
    splitter = nltk_data.load("tokenizers/punkt_tab/italian.pickle")
    assert splitter.tokenize(
        "Buongiorno a tutti. Parla il dott. Rossi, poi il sen. Bianchi. Iniziamo."
    ) == [
        "Buongiorno a tutti.",
        "Parla il dott. Rossi, poi il sen. Bianchi.",
        "Iniziamo.",
    ]
