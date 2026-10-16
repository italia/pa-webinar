"""Accuratezza dei sottotitoli su un evento vero.

Il banco misura su parlato letto (FLEURS); questo script misura sul parlato
di una riunione, con microfoni e pause veri. Il riferimento e' la
trascrizione dai sottotitoli dell'evento corretta a mano nell'editor: alla
prima correzione il portale conserva il testo della macchina, e l'editor
restituisce le due versioni riga per riga.

L'ingresso e' la risposta dell'editor della trascrizione, salvata come file
JSON da chi gestisce l'evento:

    GET /api/admin/postprod/recordings/<id>/transcript

Per ogni riga si confronta il testo della macchina (``originalText``, o il
testo stesso se la riga non e' stata toccata) con quello corretto. Le righe
sono le stesse nelle due versioni (la correzione non ne aggiunge e non ne
toglie), quindi non c'e' niente da allineare.

Il file contiene nomi e parole delle persone: si tiene il tempo della misura
e poi si cancella. Il risultato non riporta nomi, salvo con ``--names``.

    python event_wer.py trascrizione.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from common import edit_distance, normalize_words

CAPTIONS_MODEL = "live-captions"


def compare(payload: dict) -> dict:
    original = payload.get("original")
    names = {sp.get("diarLabel"): sp.get("displayName") for sp in payload.get("speakers") or []}
    people: dict[str, dict] = {}
    errors = words = changed = 0
    for seg in payload.get("segments") or []:
        corrected = seg.get("text") or ""
        machine = seg.get("originalText")
        if machine is not None:
            changed += 1
        ref = normalize_words(corrected)
        e = edit_distance(ref, normalize_words(machine if machine is not None else corrected))
        label = seg.get("speaker") or ""
        row = people.setdefault(label, {"name": names.get(label) or label or "?", "ref_words": 0, "errors": 0, "segments": 0})
        row["ref_words"] += len(ref)
        row["errors"] += e
        row["segments"] += 1
        errors += e
        words += len(ref)
    return {
        "rows": list(people.values()),
        "errors": errors,
        "ref_words": words,
        "segments": len(payload.get("segments") or []),
        "changed_segments": changed,
        "wer": errors / words if words else None,
        "revised": original is not None,
        "comparable": bool(original and original.get("comparable")),
        "model": original.get("modelId") if original else None,
        "certain_machine_origin": bool(original and original.get("certainMachineOrigin")),
    }


def problems(result: dict) -> list[str]:
    """Cio' che rende la misura inutile: meglio fermarsi che dare un numero falso."""
    if not result["revised"]:
        return ["La trascrizione non e' stata corretta a mano: non c'e' un riferimento."]
    if not result["comparable"]:
        return ["La versione della macchina non e' confrontabile riga per riga con quella corretta."]
    if result["changed_segments"] == 0:
        # Succede anche quando si sono cambiati solo i nomi delle persone: un
        # testo tutto giusto e un testo mai riletto non si distinguono.
        return ["Nessuna riga ha il testo corretto: non si distingue una trascrizione giusta da una mai riletta."]
    return []


def notes(result: dict) -> list[str]:
    out = []
    if result["model"] != CAPTIONS_MODEL:
        out.append(f"La trascrizione viene da `{result['model']}`, non dai sottotitoli: la misura e' di quel modello.")
    if not result["certain_machine_origin"]:
        out.append("Il testo conservato potrebbe includere correzioni fatte prima che il portale lo conservasse.")
    return out


def render(result: dict, show_names: bool) -> str:
    lines = [
        f"Righe: {result['segments']}, corrette: {result['changed_segments']}.",
        "",
        "| Persona | Parole | Errori | WER |",
        "|---|---:|---:|---:|",
    ]
    for i, row in enumerate(result["rows"], 1):
        label = row["name"] if show_names else f"Persona {i}"
        wer = f"{row['errors'] / row['ref_words']:.1%}" if row["ref_words"] else "-"
        lines.append(f"| {label} | {row['ref_words']} | {row['errors']} | {wer} |")
    total = f"{result['wer']:.1%}" if result["wer"] is not None else "-"
    lines.append(f"| **Totale** | {result['ref_words']} | {result['errors']} | **{total}** |")
    extra = notes(result)
    return "\n".join(lines + ([""] + [f"- {n}" for n in extra] if extra else []))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("transcript", type=Path, help="risposta dell'editor della trascrizione (JSON)")
    parser.add_argument("--names", action="store_true", help="mostra i nomi invece di Persona 1, 2, ...")
    parser.add_argument("--json", action="store_true", help="risultato in JSON, senza nomi salvo --names")
    args = parser.parse_args(argv)

    result = compare(json.loads(args.transcript.read_text(encoding="utf-8")))
    stop = problems(result)
    if stop:
        for p in stop:
            print(p, file=sys.stderr)
        return 1
    if not args.names:
        for i, row in enumerate(result["rows"], 1):
            row["name"] = f"Persona {i}"
    if args.json:
        print(json.dumps({**result, "notes": notes(result)}, ensure_ascii=False, indent=2))
    else:
        print(render(result, show_names=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
