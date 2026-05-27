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
) -> str:
    """OpenAI-compatible /chat/completions call. Returns the content
    string from the first choice."""
    r = httpx.post(
        base_url.rstrip("/") + "/chat/completions",
        json={
            "model": model_id,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        },
        timeout=timeout,
    )
    r.raise_for_status()
    data = r.json()
    return data["choices"][0]["message"]["content"]


def summarize_transcript(
    *,
    transcript_text: str,
    source_language: str,
    base_url: Optional[str],
    model_id: Optional[str],
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
                + ".\n\nTranscript:\n"
                + transcript_text
            ),
        },
    ]
    return _chat_completions(
        base_url=base_url, model_id=model_id, messages=messages
    )


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
