"""LLM client used for SUMMARIZE and TRANSLATE.

We hit a cluster-internal vLLM endpoint that speaks the OpenAI
Chat Completions wire protocol. ``providerHints.llmBaseUrl`` from the
claim response gives us the endpoint; we never call out to external
APIs (sovereignty constraint).

Two functions:
  * ``summarize_transcript`` — produces a Markdown "verbale PA" with
    a fixed section structure that the admin UI knows how to render.
  * ``translate_transcript_and_summary`` — produces a translated
    VTT-as-segments structure + (optionally) a translated summary.

For testing without a live LLM, ``WORKER_STUB=1`` switches to canned
output that exercises the downstream uploader/registrar paths.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, List, Optional

import httpx

log = logging.getLogger(__name__)


SUMMARIZE_SYSTEM_IT = """\
Sei un assistente che redige verbali ufficiali per la Pubblica
Amministrazione italiana. Lo stile è formale, neutro, sintetico,
fedele al contenuto trascritto. NON inventare fatti, persone, decisioni
o date non presenti nel transcript. Per ogni decisione o azione cita
almeno un timestamp del transcript come prova.

Produci sempre il documento in formato Markdown con questa struttura
esatta (ometti una sezione solo se davvero priva di contenuto):

# Verbale
## Argomenti trattati
- ...
## Quesiti emersi
- ...
## Decisioni
- ... (cita [HH:MM:SS])
## Action items
- ... (cita [HH:MM:SS])
## Punti aperti
- ...
"""

TRANSLATE_SYSTEM_PROMPT = """\
You are a professional translator for public administration documents.
Translate the user message preserving meaning, tone, named entities
and formatting (markdown structure, list bullets, timestamps in
brackets). Do not add commentary; output only the translation.
Target language: {target}.
"""


def _stub_enabled() -> bool:
    return os.environ.get("WORKER_STUB") == "1"


def _chat_completions(
    *,
    base_url: str,
    model_id: str,
    messages: List[Dict[str, str]],
    temperature: float = 0.2,
    max_tokens: int = 2048,
    timeout: float = 300.0,
    json_mode: bool = False,
) -> str:
    """OpenAI-compatible /chat/completions call. Returns the content
    string from the first choice. ``json_mode`` sets response_format to
    json_object (vLLM + OpenAI compatible) so the model returns parseable
    JSON — used for the structured summary (SUMMARY_JSON)."""
    body: Dict[str, Any] = {
        "model": model_id,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    url = base_url.rstrip("/") + "/chat/completions"

    # vLLM è scalato a 0 quando la coda è vuota e impiega ~6 min a caricare
    # i pesi di Mistral-Small-24B + compilazione CUDA-graph. Se il worker
    # fallisse subito su ConnectError/503 (backend in cold-start), il job
    # andrebbe in backoff: l'orchestrator vedrebbe runnable=0 e riscalerebbe
    # vLLM a 0, buttando via il warmup → ciclo infinito (cold-start race).
    # Restando invece in attesa qui, il job resta RUNNING, l'orchestrator
    # mantiene running>0 e vLLM finisce di caricare → la chiamata va a buon
    # fine. Atteso fino a LLM_CONNECT_WAIT_S (default 12 min); poi propaga.
    connect_wait = float(os.environ.get("LLM_CONNECT_WAIT_S", "720"))
    deadline = time.monotonic() + connect_wait
    attempt = 0
    while True:
        attempt += 1
        try:
            r = httpx.post(url, json=body, timeout=timeout)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.RemoteProtocolError) as e:
            # Backend irraggiungibile: vLLM in cold-start → attendi e ritenta.
            if time.monotonic() >= deadline:
                raise
            wait = min(15.0, 2.0 * attempt)
            log.info(
                "LLM backend non raggiungibile (%s) — attendo cold-start vLLM, retry in %.0fs",
                type(e).__name__,
                wait,
            )
            time.sleep(wait)
            continue
        # 503 = vLLM in piedi ma modello non ancora caricato → ritenta.
        # Ogni altro non-2xx è un errore reale (400/422/500) → propaga subito.
        if r.status_code == 503 and time.monotonic() < deadline:
            wait = min(15.0, 2.0 * attempt)
            log.info("vLLM 503 (modello in caricamento) — retry in %.0fs", wait)
            time.sleep(wait)
            continue
        r.raise_for_status()
        data = r.json()
        return data["choices"][0]["message"]["content"]


def _parse_json_lenient(raw: str) -> Dict[str, Any]:
    """Parse JSON from an LLM reply, tolerating code fences / preamble."""
    import json
    import re

    s = re.sub(r"^```(?:json)?\n|\n```$", "", raw.strip())
    try:
        return json.loads(s)
    except Exception:
        m = re.search(r"\{.*\}", s, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                pass
    return {}


def _format_agenda(agenda_items: Optional[list]) -> str:
    """Rende l'agenda (punti + spunte) come blocco testuale per il prompt.

    `agenda_items` è la lista opzionale dal payload del job: ogni elemento
    ``{"label": str, "completed": bool}``. Vuota/assente → stringa vuota
    (funzione opzionale: se l'agenda non è usata, il prompt resta invariato).
    """
    if not agenda_items:
        return ""
    lines = []
    for it in agenda_items:
        if not isinstance(it, dict):
            continue
        label = str(it.get("label", "")).strip()
        if not label:
            continue
        mark = "[trattato]" if it.get("completed") else "[non trattato]"
        lines.append(f"- {mark} {label}")
    if not lines:
        return ""
    return (
        "\n\nAgenda dei punti previsti (con stato dichiarato dal moderatore "
        "durante la riunione). Usala per strutturare il verbale e segnala "
        "esplicitamente i punti NON trattati:\n" + "\n".join(lines)
    )


def summarize_transcript(
    *,
    transcript_text: str,
    source_language: str,
    base_url: Optional[str],
    model_id: Optional[str],
    agenda_items: Optional[list] = None,
) -> str:
    if _stub_enabled() or not base_url or not model_id:
        log.info("LLM stub mode for summarise")
        return _stub_summary(source_language)

    # Source language is "it" for now; future locales would swap the
    # system prompt. For non-IT inputs, we still write a verbale IT
    # by default (the admin UI surfaces a "summary language" override
    # if needed — out of scope for MVP).
    messages = [
        {"role": "system", "content": SUMMARIZE_SYSTEM_IT},
        {
            "role": "user",
            "content": (
                "Lingua sorgente: "
                + source_language
                + _format_agenda(agenda_items)
                + ".\n\nTranscript:\n"
                + transcript_text
            ),
        },
    ]
    return _chat_completions(
        base_url=base_url, model_id=model_id, messages=messages
    )


CORRECT_SYSTEM_IT = (
    "Sei un editor che corregge una trascrizione automatica di una riunione "
    "della Pubblica Amministrazione italiana. Riceverai la trascrizione "
    "originale e un elenco di nomi propri, sigle e termini tecnici noti. "
    "Il tuo compito è correggere SOLO ortografia, nomi propri e sigle, "
    "senza inventare o aggiungere contenuto, senza modificare il senso, "
    "senza accorpare o splittare frasi. Mantieni esattamente la stessa "
    "struttura di righe. Se una riga è incomprensibile, lasciala invariata. "
    "Output: una riga per ogni riga di input, nello stesso ordine, niente "
    "preamboli, niente numerazione aggiuntiva."
)


def correct_transcript_segments(
    *,
    segments_text: list[str],
    glossary_terms: list[str],
    source_language: str,
    base_url: Optional[str],
    model_id: Optional[str],
) -> list[str]:
    """Passa N righe di trascrizione a Mistral per correggere nomi
    propri, sigle e termini tecnici. Ritorna N righe corrette nello
    stesso ordine. In stub mode o senza LLM, ritorna l'input invariato.

    `glossary_terms`: lista di nomi propri / sigle dell'evento
    (`speakersInfo`, organizzazione, etc.) che Mistral deve preservare
    e correggere se Whisper li ha approssimati. Es. ["Raffaele",
    "PCM", "OVH", "Azure", "Kubernetes"].
    """
    if not segments_text:
        return []
    if _stub_enabled() or not base_url or not model_id:
        log.info("LLM stub mode for correct_transcript_segments")
        return list(segments_text)

    # Batch: ogni richiesta corregge N=40 righe per stare sotto i
    # limiti di token e per ridurre il rischio di "drift" su prompt
    # troppo lunghi.
    BATCH = 40
    corrected: list[str] = []
    glossary_block = (
        "Glossario evento: " + ", ".join(glossary_terms[:60]) + "."
        if glossary_terms
        else ""
    )
    for i in range(0, len(segments_text), BATCH):
        batch = segments_text[i : i + BATCH]
        numbered = "\n".join(f"{j + 1}. {line}" for j, line in enumerate(batch))
        try:
            resp = _chat_completions(
                base_url=base_url,
                model_id=model_id,
                messages=[
                    {"role": "system", "content": CORRECT_SYSTEM_IT},
                    {
                        "role": "user",
                        "content": (
                            f"Lingua sorgente: {source_language}.\n"
                            + (glossary_block + "\n\n" if glossary_block else "\n")
                            + "Trascrizione (una frase per riga, numerata):\n"
                            + numbered
                        ),
                    },
                ],
            )
        except Exception as e:
            log.warning("correction batch %d failed: %s — keeping originals", i, e)
            corrected.extend(batch)
            continue
        # Parsing: estrai N righe nel formato "N. testo"
        parsed: dict[int, str] = {}
        for raw in resp.splitlines():
            import re

            m = re.match(r"^\s*(\d+)\.\s*(.*)$", raw)
            if m:
                idx = int(m.group(1)) - 1
                parsed[idx] = m.group(2).strip()
        for j, original in enumerate(batch):
            corrected.append(parsed.get(j, original))
    return corrected


def translate_text(
    *,
    text: str,
    target_language: str,
    base_url: Optional[str],
    model_id: Optional[str],
) -> str:
    if _stub_enabled() or not base_url or not model_id:
        log.info("LLM stub mode for translate to %s", target_language)
        return f"[stub translation to {target_language}]\n\n{text}"

    messages = [
        {
            "role": "system",
            "content": TRANSLATE_SYSTEM_PROMPT.format(target=target_language),
        },
        {"role": "user", "content": text},
    ]
    return _chat_completions(
        base_url=base_url,
        model_id=model_id,
        messages=messages,
        # Translations should be deterministic.
        temperature=0.0,
    )


def translate_segments(
    *,
    segments: List[Dict[str, Any]],
    target_language: str,
    base_url: Optional[str],
    model_id: Optional[str],
) -> List[Dict[str, Any]]:
    """Translate each segment's text in-place, preserving timing and
    speaker labels. Done one segment at a time (simple, predictable;
    optimise to batched calls when latency becomes a concern)."""
    out: List[Dict[str, Any]] = []
    for seg in segments:
        src = (seg.get("text") or "").strip()
        if not src:
            out.append(seg)
            continue
        translated = translate_text(
            text=src,
            target_language=target_language,
            base_url=base_url,
            model_id=model_id,
        )
        out.append({**seg, "text": translated.strip()})
    return out


def _stub_summary(source_language: str) -> str:
    return (
        "# Verbale\n"
        "## Argomenti trattati\n"
        "- Apertura della riunione (stub)\n"
        "- Discussione di esempio (stub)\n\n"
        "## Decisioni\n"
        "- Nessuna decisione, sessione di test [00:00:01]\n\n"
        "_NB: questo verbale è generato in modalità stub "
        f"({source_language})._\n"
    )


# ---------------------------------------------------------------------------
# Structured summary (SUMMARY_JSON) — overall + decisioni + azioni + topics
# con timestamp. UNA chiamata LLM JSON-mode; il Markdown è renderizzato
# deterministicamente dal JSON (niente seconda chiamata). Le traduzioni
# riusano lo stesso shape (SUMMARY_JSON per lingua + TRANSLATION_MD renderizzato).
# ---------------------------------------------------------------------------

SUMMARIZE_JSON_SYSTEM_IT = """\
Sei un assistente che analizza la trascrizione di una riunione della
Pubblica Amministrazione italiana. Stile formale, neutro, fedele: NON
inventare fatti, persone, decisioni o date non presenti nel transcript.
Rispondi SOLO con un oggetto JSON valido (nessun preambolo, nessun
markdown), con questa struttura ESATTA:
{
  "overall_summary": "sintesi di 3-5 frasi dell'intera riunione",
  "key_decisions": ["decisioni concrete, max 6, [] se nessuna"],
  "action_items": ["azioni con eventuale owner/scadenza, max 6, [] se nessuna"],
  "topics": [
    {"title": "titolo conciso", "start_mmss": "MM:SS di inizio approssimato (dai timestamp del transcript)", "summary": "sintesi di 2-3 frasi del topic"}
  ]
}
"""

_SUMMARY_HEADINGS = {
    "it": {"overall": "Sintesi generale", "dec": "Decisioni chiave", "act": "Azioni", "top": "Argomenti trattati"},
    "en": {"overall": "Overall summary", "dec": "Key decisions", "act": "Action items", "top": "Topics covered"},
    "fr": {"overall": "Synthèse générale", "dec": "Décisions clés", "act": "Actions", "top": "Sujets traités"},
}


def _normalize_summary(data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "overall_summary": str(data.get("overall_summary") or "").strip(),
        "key_decisions": [str(x).strip() for x in (data.get("key_decisions") or []) if str(x).strip()],
        "action_items": [str(x).strip() for x in (data.get("action_items") or []) if str(x).strip()],
        "topics": [
            {
                "title": str(t.get("title") or "").strip(),
                "start_mmss": str(t.get("start_mmss") or "").strip(),
                "summary": str(t.get("summary") or "").strip(),
            }
            for t in (data.get("topics") or []) if isinstance(t, dict)
        ],
    }


def summarize_transcript_structured(
    *,
    transcript_text: str,
    source_language: str,
    base_url: Optional[str],
    model_id: Optional[str],
    agenda_items: Optional[list] = None,
) -> Dict[str, Any]:
    """SUMMARY_JSON: sintesi strutturata via LLM JSON-mode."""
    if _stub_enabled() or not base_url or not model_id:
        log.info("LLM stub mode for structured summary")
        return _stub_summary_structured(source_language)
    messages = [
        {"role": "system", "content": SUMMARIZE_JSON_SYSTEM_IT},
        {
            "role": "user",
            "content": (
                "Lingua sorgente: " + source_language
                + _format_agenda(agenda_items)
                + ".\n\nTranscript:\n" + transcript_text
            ),
        },
    ]
    raw = _chat_completions(
        base_url=base_url, model_id=model_id, messages=messages,
        temperature=0.2, max_tokens=2500, json_mode=True,
    )
    return _normalize_summary(_parse_json_lenient(raw))


def render_summary_md(summary: Dict[str, Any], lang: str = "it") -> str:
    """Render deterministico Markdown dalla sintesi strutturata (no LLM)."""
    h = _SUMMARY_HEADINGS.get(lang, _SUMMARY_HEADINGS["en"])
    lines = [f"## {h['overall']}\n", (summary.get("overall_summary") or "").strip() + "\n"]
    if summary.get("key_decisions"):
        lines.append(f"\n## {h['dec']}\n")
        lines += [f"- {k}" for k in summary["key_decisions"]]
    if summary.get("action_items"):
        lines.append(f"\n## {h['act']}\n")
        lines += [f"- {k}" for k in summary["action_items"]]
    if summary.get("topics"):
        lines.append(f"\n## {h['top']}\n")
        for t in summary["topics"]:
            ts = t.get("start_mmss") or ""
            lines.append(f"\n### [{ts}] {t.get('title', '')}\n")
            lines.append((t.get("summary") or "").strip())
    return "\n".join(lines)


def translate_summary_structured(
    *,
    summary: Dict[str, Any],
    target_language: str,
    base_url: Optional[str],
    model_id: Optional[str],
) -> Dict[str, Any]:
    """Traduce la sintesi strutturata mantenendo lo shape; i `start_mmss`
    dei topic restano invariati (timestamp). Fallback alla sorgente se
    la traduzione viene vuota."""
    import json
    if _stub_enabled() or not base_url or not model_id:
        return {**summary, "overall_summary": f"[stub {target_language}] " + (summary.get("overall_summary") or "")}
    raw = _chat_completions(
        base_url=base_url, model_id=model_id,
        messages=[
            {"role": "system", "content": (
                f"You translate Italian PA meeting summaries to {target_language}. "
                "Keep the SAME JSON keys and the topics' start_mmss values UNCHANGED. "
                "Translate only human-readable text. Output JSON only."
            )},
            {"role": "user", "content": json.dumps(summary, ensure_ascii=False)},
        ],
        temperature=0.0, max_tokens=2500, json_mode=True,
    )
    data = _parse_json_lenient(raw)
    if not data.get("overall_summary") and not data.get("topics"):
        return summary
    out = _normalize_summary(data)
    # robustezza: preserva start_mmss per indice dalla sintesi sorgente
    src_topics = summary.get("topics") or []
    for i, t in enumerate(out["topics"]):
        if not t.get("start_mmss") and i < len(src_topics):
            t["start_mmss"] = src_topics[i].get("start_mmss") or ""
    return out


def _stub_summary_structured(source_language: str) -> Dict[str, Any]:
    return {
        "overall_summary": f"Sintesi di prova (stub, {source_language}).",
        "key_decisions": ["Nessuna decisione, sessione di test"],
        "action_items": [],
        "topics": [{"title": "Apertura", "start_mmss": "00:00", "summary": "Apertura della riunione (stub)."}],
    }
