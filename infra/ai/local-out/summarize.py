#!/usr/bin/env python3
"""
Sintesi + topic segmentation + traduzione EN.

Input:  transcript_diarized.json
Output: summary.json
        - speakers_named      → mapping SPEAKER_xx -> name guess (LLM-based)
        - topics              → segmenti raggruppati per topic con titolo + sintesi
        - overall_summary_it  → sintesi globale italiana
        - overall_summary_en  → sintesi globale inglese
        - transcript_en       → traduzione segment-by-segment

Modello: configurabile via env LLM_MODEL (default: qwen3.5:27b).
Endpoint: OLLAMA_URL (default http://localhost:11434/v1).
"""
from __future__ import annotations
import json
import os
import re
import time
import requests

LLM_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "qwen3.5:27b")
TX_IN = "transcript_diarized.json"
OUT = "summary.json"


def llm(messages, *, temperature=0.2, max_tokens=2048, json_mode=False):
    body = {
        "model": LLM_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    r = requests.post(f"{LLM_URL}/chat/completions", json=body, timeout=600)
    r.raise_for_status()
    data = r.json()
    msg = data["choices"][0]["message"]
    txt = msg.get("content") or ""
    # qwen3.5 mette il reasoning in "reasoning" — strippiamo
    if not txt and msg.get("reasoning"):
        # provo a estrarre dopo "Final Answer:" pattern, altrimenti fallback
        txt = msg["reasoning"]
    return txt


def mmss(sec: float) -> str:
    m, s = divmod(int(sec), 60)
    return f"{m:02d}:{s:02d}"


def main():
    with open(TX_IN) as f:
        tx = json.load(f)
    segs = tx["segments"]
    duration = tx["duration"]
    print(f"Loaded {len(segs)} segments, duration {mmss(duration)}")

    # 1) Formatto la trascrizione "leggibile" (compatta segmenti consecutivi
    #    stessa speaker)
    lines = []
    cur_sp = None
    cur_start = 0.0
    cur_text = []
    for s in segs:
        if s["speaker"] != cur_sp:
            if cur_sp is not None:
                lines.append((cur_start, cur_sp, " ".join(cur_text).strip()))
            cur_sp = s["speaker"]
            cur_start = s["start"]
            cur_text = [s["text"]]
        else:
            cur_text.append(s["text"])
    if cur_sp is not None:
        lines.append((cur_start, cur_sp, " ".join(cur_text).strip()))
    print(f"Compacted to {len(lines)} speaker turns")

    transcript_compact = "\n".join(
        f"[{mmss(t)}] {sp}: {tx}" for t, sp, tx in lines
    )

    # 2) Topic segmentation + overall summary in italiano (LLM)
    print("LLM: topic segmentation + summary IT…")
    t0 = time.time()
    out_it = llm(
        [
            {
                "role": "system",
                "content": (
                    "Sei un assistente che analizza trascrizioni di riunioni della Pubblica "
                    "Amministrazione italiana (Dipartimento per la Trasformazione Digitale). "
                    "Lavori con un formato strutturato JSON. Niente preamboli."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Analizza la seguente trascrizione di una riunione interna. "
                    "Produci un JSON con questa struttura ESATTA (niente altro):\n"
                    "{\n"
                    '  "overall_summary": "sintesi 3-5 frasi dell\'intera riunione",\n'
                    '  "key_decisions": ["lista decisioni concrete, max 5, vuota se nessuna"],\n'
                    '  "action_items": ["lista azioni con eventuale owner/scadenza, max 5"],\n'
                    '  "topics": [\n'
                    '    {"title": "titolo conciso", "start_mmss": "MM:SS inizio approssimato", "summary": "sintesi 2-3 frasi del topic"}\n'
                    "  ]\n"
                    "}\n"
                    f"Durata totale: {mmss(duration)}. Numero di speaker rilevati: {len(tx.get('speakers',[]))}.\n\n"
                    "Trascrizione:\n" + transcript_compact[:30000]
                ),
            },
        ],
        temperature=0.2,
        max_tokens=2500,
        json_mode=True,
    )
    print(f"  done in {time.time()-t0:.1f}s, {len(out_it)} chars")
    # Strippa code fence se presenti
    out_it = re.sub(r"^```(?:json)?\n|\n```$", "", out_it.strip())
    try:
        summary_it = json.loads(out_it)
    except json.JSONDecodeError as e:
        print(f"  WARN: JSON parse fallita: {e}")
        # tentativo: prima { e ultimo }
        m = re.search(r"\{.*\}", out_it, re.S)
        summary_it = json.loads(m.group(0)) if m else {"overall_summary": out_it}
    print(f"  -> {len(summary_it.get('topics', []))} topics")

    # 3) Speaker naming guess (LLM): leggere nomi se menzionati
    print("LLM: guess speaker names…")
    t0 = time.time()
    name_resp = llm(
        [
            {
                "role": "system",
                "content": "Sei un assistente che identifica i partecipanti di una riunione da una trascrizione diarizzata. Rispondi SOLO con JSON.",
            },
            {
                "role": "user",
                "content": (
                    "Dato il seguente estratto di trascrizione con speaker diarizzati come SPEAKER_00, SPEAKER_01, ecc., "
                    "indovina il nome reale di ciascuno usando i nomi propri menzionati nel testo (saluti, presentazioni, "
                    "auto-citazioni). Se non riesci a indovinare con sufficiente confidenza, lascia null.\n"
                    "Output JSON ESATTO:\n"
                    '{ "SPEAKER_00": null o "Nome Cognome", "SPEAKER_01": null o "Nome Cognome", ... }\n\n'
                    "Estratto:\n" + transcript_compact[:15000]
                ),
            },
        ],
        temperature=0.0,
        max_tokens=400,
        json_mode=True,
    )
    print(f"  done in {time.time()-t0:.1f}s")
    name_resp = re.sub(r"^```(?:json)?\n|\n```$", "", name_resp.strip())
    try:
        speakers_named = json.loads(name_resp)
    except Exception:
        m = re.search(r"\{[^}]*\}", name_resp, re.S)
        speakers_named = json.loads(m.group(0)) if m else {}
    print("  guesses:", speakers_named)

    # 4+5) Per ogni lingua target: traduci la sintesi strutturata + i
    # segmenti. Output FLAT: summary_<lang> + transcript_<lang> (segmenti
    # con campo text_<lang>). EN resta identico (backward-compat con
    # build_vtt/dub); FR si aggiunge in parallelo. Lingue via env
    # TARGET_LANGS (default "en,fr").
    target_langs = [t.strip() for t in os.environ.get("TARGET_LANGS", "en,fr").split(",") if t.strip()]
    LANG_NAMES = {"en": "English", "fr": "French", "de": "German", "es": "Spanish"}
    out = {
        "summary_it": summary_it,
        "speakers_named": speakers_named,
        "model": LLM_MODEL,
        "target_langs": target_langs,
    }
    BATCH = 20
    for lang in target_langs:
        lname = LANG_NAMES.get(lang, lang)
        print(f"LLM: translate summary -> {lname}…")
        t0 = time.time()
        tr_resp = llm(
            [
                {"role": "system", "content": f"You translate Italian PA meeting summaries to {lname}. Output JSON only."},
                {"role": "user", "content": (
                    f"Translate the following structured Italian summary to {lname}. Output JSON with the same keys "
                    "(overall_summary, key_decisions, action_items, topics each with title and summary), "
                    f"but {lname} values:\n\n" + json.dumps(summary_it, ensure_ascii=False)
                )},
            ],
            temperature=0.0, max_tokens=2500, json_mode=True,
        )
        print(f"  done in {time.time()-t0:.1f}s")
        tr_resp = re.sub(r"^```(?:json)?\n|\n```$", "", tr_resp.strip())
        try:
            summary_tr = json.loads(tr_resp)
        except Exception:
            m = re.search(r"\{.*\}", tr_resp, re.S)
            summary_tr = json.loads(m.group(0)) if m else {"overall_summary": tr_resp}
        out[f"summary_{lang}"] = summary_tr

        print(f"LLM: translate transcript -> {lname} (segment-by-segment)…")
        tr_segments = []
        t0 = time.time()
        for i in range(0, len(segs), BATCH):
            batch = segs[i : i + BATCH]
            prompt_lines = [f"{j}. {s['text']}" for j, s in enumerate(batch)]
            resp = llm(
                [
                    {"role": "system", "content": f"Translate Italian transcript lines to {lname}, preserving the numbering. Output one translated line per input. Nothing else."},
                    {"role": "user", "content": "\n".join(prompt_lines)},
                ],
                temperature=0.0, max_tokens=1500,
            )
            translations = {}
            for ln in resp.splitlines():
                mm = re.match(r"^\s*(\d+)\.\s*(.*)$", ln)
                if mm:
                    translations[int(mm.group(1))] = mm.group(2).strip()
            for j, s in enumerate(batch):
                tr_segments.append({**s, f"text_{lang}": translations.get(j, "")})
            print(f"  {lang} batch {i // BATCH + 1}/{(len(segs) + BATCH - 1) // BATCH} ({len(translations)}/{len(batch)})")
        print(f"  {lang} total {time.time()-t0:.1f}s")
        out[f"transcript_{lang}"] = tr_segments

    with open(OUT, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"Saved {OUT} (langs: it + {', '.join(target_langs)})")


if __name__ == "__main__":
    main()
