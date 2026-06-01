#!/usr/bin/env python3
"""LLM post-correction sulla trascrizione.

Passa la trascrizione a Mistral con un glossario di nomi propri e
sigle dell'evento (DTD, Raffaele, PCM, OVH, ...). Mistral corregge
SOLO ortografia/nomi/sigle, mantiene il senso, una riga per segmento
in input → una per ognuno in output.

Input:  transcript_diarized.json
Output: transcript_diarized.json (sovrascrive — aggiorna `text` su
        ogni segmento e tiene un campo `text_raw` con l'originale).
"""
from __future__ import annotations
import json
import os
import re
import sys
import time
from pathlib import Path

import requests

LLM_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "mistral-small3.2:24b")
TX_FILE = "transcript_diarized.json"
GLOSSARY = [
    "DTD", "Dipartimento per la Trasformazione Digitale",
    "Raffaele", "Raffaele Vitiello", "Alex", "Paolo", "Marco",
    "Jitsi", "Jitsi Meet", "eventi-dtd",
    "PCM", "Microsoft", "Azure", "OVH", "Teams",
    "Kubernetes", "container", "cluster", "endpoint",
    "moderatore", "webinar", "codec",
    "accessibilità", "certificazione",
]
BATCH = 40
SYSTEM = (
    "Sei un editor che corregge una trascrizione automatica di una riunione "
    "della Pubblica Amministrazione italiana. Correggi SOLO ortografia, nomi "
    "propri e sigle riportate nel glossario. NON inventare contenuto, NON "
    "modificare il senso, NON accorpare o splittare frasi. Mantieni esattamente "
    "la stessa struttura di righe: una riga per ogni riga di input, nello "
    "stesso ordine, niente preamboli, niente numerazione aggiuntiva. Se una "
    "riga è incomprensibile lasciala invariata."
)


def chat(messages: list, *, max_tokens: int = 1500) -> str:
    r = requests.post(
        f"{LLM_URL}/chat/completions",
        json={
            "model": LLM_MODEL,
            "messages": messages,
            "temperature": 0.0,
            "max_tokens": max_tokens,
            "stream": False,
        },
        timeout=600,
    )
    r.raise_for_status()
    msg = r.json()["choices"][0]["message"]
    return msg.get("content") or msg.get("reasoning") or ""


def main() -> None:
    p = Path(TX_FILE)
    d = json.loads(p.read_text())
    segs = d["segments"]
    print(f"Correcting {len(segs)} segments with {LLM_MODEL}…")

    glossary_block = "Glossario evento (preserva e correggi quando approssimato): " + ", ".join(GLOSSARY) + "."

    corrected: list[str] = []
    t0 = time.time()
    for i in range(0, len(segs), BATCH):
        batch = segs[i : i + BATCH]
        numbered = "\n".join(f"{j + 1}. {s['text']}" for j, s in enumerate(batch))
        try:
            resp = chat([
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": glossary_block + "\n\nTrascrizione:\n" + numbered},
            ])
        except Exception as e:
            print(f"  batch {i // BATCH + 1} FAILED ({e}); keeping originals")
            corrected.extend(s["text"] for s in batch)
            continue
        parsed: dict[int, str] = {}
        for raw in resp.splitlines():
            m = re.match(r"^\s*(\d+)\.\s*(.*)$", raw)
            if m:
                parsed[int(m.group(1)) - 1] = m.group(2).strip()
        for j, s in enumerate(batch):
            corrected.append(parsed.get(j, s["text"]))
        print(f"  batch {i // BATCH + 1}/{(len(segs) + BATCH - 1) // BATCH}: {len(parsed)}/{len(batch)}")

    print(f"Done in {time.time() - t0:.1f}s")

    # Conta quante linee sono state effettivamente cambiate
    changed = sum(1 for s, c in zip(segs, corrected) if s["text"] != c)
    print(f"Changed {changed}/{len(segs)} segments")

    for s, c in zip(segs, corrected):
        if c != s["text"]:
            s["text_raw"] = s["text"]
            s["text"] = c

    p.write_text(json.dumps(d, indent=2, ensure_ascii=False))
    print(f"Saved {TX_FILE}")


if __name__ == "__main__":
    main()
