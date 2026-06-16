"""Postprod worker entrypoint.

Usage (inside the container):

    python -m worker.main           # claim one job, run it, exit

Environment:
    APP_INTERNAL_URL    e.g. http://pa-webinar-web:3000
    CRON_API_KEY        shared secret with the app
    WORKER_ID           pod name (auto-detected if unset)
    WORKER_STUB=1       skip real ASR + LLM, use canned outputs
    HF_TOKEN            HuggingFace access token for pyannote
    WHISPERX_VERSION    optional version label recorded on artifacts
    LLM_CONNECT_WAIT_S  attesa max per il cold-start di vLLM (default 720)

Risoluzione nomi: SUMMARIZE/TRANSLATE usano `claim.speakerNames`
(diarLabel→nome reale dai Speaker del DB) per dare all'LLM e ai sottotitoli
il NOME del parlante invece di "SPEAKER_00" (fallback ai nomi embeddati nel
transcript, poi al label). Vedi run_summarize/run_translate.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import subprocess
import sys
import tempfile
from typing import Any, Dict, List, Optional

from . import align as almod
from . import archive as arcmod
from . import client as cli
from . import llm as llmmod
from . import multitrack as mtmod
from . import transcribe as tr
from . import tts as ttsmod
from . import vtt as vttmod
from . import waveform as wfmod

log = logging.getLogger("postprod-worker")


def configure_logging() -> None:
    level = os.environ.get("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=level,
        format='{"ts":"%(asctime)s","lvl":"%(levelname)s","mod":"%(name)s","msg":"%(message)s"}',
    )


# ---------------------------------------------------------------------------
# Tiny utilities
# ---------------------------------------------------------------------------


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: str, *, chunk_size: int = 1 << 20) -> str:
    """SHA-256 di un file in streaming (per artefatti grandi, es. MKV)."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            h.update(chunk)
    return h.hexdigest()


def _write_and_upload(
    app: cli.AppClient,
    job_id: str,
    *,
    target: cli.UploadTarget,
    artifact_type: str,
    language: Optional[str],
    body_bytes: bytes,
    model_id: Optional[str] = None,
    model_version: Optional[str] = None,
    inline_max_bytes: int = 64 * 1024,
    speaker_map: Optional[List[Dict[str, Any]]] = None,
    watermark_type: Optional[str] = None,
) -> None:
    """Upload bytes via presigned PUT and register the artifact."""
    cli.upload_bytes(target.url, body_bytes, content_type=target.contentType)
    inline = None
    # Only inline small text payloads — the migration limits the
    # column to TEXT but the schema documents 64KB as the convention.
    if (
        target.contentType.startswith("text/")
        or target.contentType.startswith("application/json")
    ) and len(body_bytes) <= inline_max_bytes:
        try:
            inline = body_bytes.decode("utf-8")
        except UnicodeDecodeError:
            inline = None
    app.register_artifact(
        job_id=job_id,
        artifact_type=artifact_type,
        language=language,
        blob_key=target.blobKey,
        size_bytes=len(body_bytes),
        mime_type=target.contentType,
        content_hash=_sha256_hex(body_bytes),
        inline_body=inline,
        model_id=model_id,
        model_version=model_version,
        speaker_map=speaker_map,
        watermark_type=watermark_type,
    )


# ---------------------------------------------------------------------------
# Stage handlers
# ---------------------------------------------------------------------------


def run_transcribe(app: cli.AppClient, job: cli.ClaimResponse) -> None:
    src_lang = job.payload.get("sourceLanguage") or "it"

    with tempfile.TemporaryDirectory(prefix="postprod-") as workdir:
        mp4_path = os.path.join(workdir, "source.mp4")
        log.info("downloading source MP4")
        cli.download_to_file(job.sourceDownloadUrl, mp4_path)

        app.progress(job.jobId, "RUNNING", percent=20.0, message="downloaded")

        if os.environ.get("WORKER_STUB") == "1":
            result = tr.transcribe_stub(language_hint=src_lang)
        else:
            asr_model = (
                job.providerHints.asrModelId or "large-v3"
            )
            result = tr.transcribe_with_whisperx(
                mp4_path,
                language_hint=src_lang,
                asr_model_id=asr_model,
                hf_token=os.environ.get("HF_TOKEN"),
                initial_prompt=job.providerHints.asrInitialPrompt,
                expected_speakers=job.providerHints.expectedSpeakers,
            )

        app.progress(job.jobId, "RUNNING", percent=80.0, message="asr+diar done")

        # TRANSCRIPT_JSON (full raw output, no language).
        raw_bytes = json.dumps(result.raw_json, ensure_ascii=False).encode("utf-8")
        _write_and_upload(
            app,
            job.jobId,
            target=job.uploadTargets["transcriptJson"],
            artifact_type="TRANSCRIPT_JSON",
            language=None,
            body_bytes=raw_bytes,
            model_id=result.model_id,
            model_version=result.model_version,
            speaker_map=result.speakers,
        )

        # TRANSCRIPT_VTT (subtitles in source language).
        vtt_bytes = vttmod.segments_to_vtt(result.segments).encode("utf-8")
        _write_and_upload(
            app,
            job.jobId,
            target=job.uploadTargets["transcriptVtt"],
            artifact_type="TRANSCRIPT_VTT",
            language=result.language,
            body_bytes=vtt_bytes,
            model_id=result.model_id,
            model_version=result.model_version,
        )

        # TRANSCRIPT_TXT (plain text with speaker prefixes).
        txt_bytes = vttmod.segments_to_plain_text(result.segments).encode("utf-8")
        _write_and_upload(
            app,
            job.jobId,
            target=job.uploadTargets["transcriptTxt"],
            artifact_type="TRANSCRIPT_TXT",
            language=result.language,
            body_bytes=txt_bytes,
            model_id=result.model_id,
            model_version=result.model_version,
        )

        # WAVEFORM_JSON (optional). Best-effort: a failure here must NOT
        # fail the job — the editor degrades to a segment-only timeline.
        # The target is absent when claimed by/for an older app version.
        wf_target = job.uploadTargets.get("waveform")
        if wf_target is not None:
            try:
                wf = wfmod.compute_waveform(mp4_path)
                wf_bytes = json.dumps(wf).encode("utf-8")
                _write_and_upload(
                    app,
                    job.jobId,
                    target=wf_target,
                    artifact_type="WAVEFORM_JSON",
                    language=None,
                    body_bytes=wf_bytes,
                )
            except Exception:  # noqa: BLE001 — waveform is non-critical
                log.exception("waveform extraction failed; skipping")


def run_transcribe_multitrack(app: cli.AppClient, job: cli.ClaimResponse) -> None:
    """ADR-013: trascrizione multi-traccia (una traccia per partecipante).

    Ogni traccia ha UN solo parlante noto → niente diarization. Trascriviamo
    ogni traccia (single-speaker), poi fondiamo i segmenti su timeline globale
    con attribuzione certa (multitrack.merge_tracks). Produce gli stessi
    artifact di TRANSCRIBE (JSON/VTT/TXT), ma con nomi reali e overlap.
    """
    src_lang = job.payload.get("sourceLanguage") or "it"
    track_inputs = [i for i in job.inputs if i.role == "track"]
    if not track_inputs:
        raise RuntimeError("TRANSCRIBE_MULTITRACK without track inputs")
    stub = os.environ.get("WORKER_STUB") == "1"

    with tempfile.TemporaryDirectory(prefix="postprod-mt-") as workdir:
        track_results: List[Dict[str, Any]] = []
        detected_lang = src_lang
        total = len(track_inputs)

        # Opzione C — allineamento preciso al mix Jibri. Best-effort: se il
        # mix (sourceDownloadUrl = recording.blobKey) è disponibile, lo
        # scarichiamo una volta per raffinare gli offset via cross-correlazione;
        # altrimenti restiamo sugli offset wall-clock del manifest.
        mix_path: Optional[str] = None
        if not stub and getattr(job, "sourceDownloadUrl", None):
            try:
                cand = os.path.join(workdir, "mix.media")
                cli.download_to_file(job.sourceDownloadUrl, cand)
                if os.path.getsize(cand) > 0:
                    mix_path = cand
            except Exception:  # noqa: BLE001 — mix opzionale (Jibri assente)
                log.info("mix Jibri non disponibile: uso gli offset del manifest")

        # Riuso modelli tra tracce: l'ASR (~3GB) è indipendente dalla lingua
        # → caricato UNA volta prima del loop (non N volte, una per traccia).
        # Il modello di allineamento dipende dalla lingua → memoizzato per
        # lingua (le tracce condividono tipicamente la stessa lingua).
        asr_model = None
        align_cache: Dict[str, Any] = {}
        if not stub:
            asr_model = tr.load_asr_model(
                job.providerHints.asrModelId or "large-v3",
                initial_prompt=job.providerHints.asrInitialPrompt,
            )

        def _get_align(language: str):
            if language not in align_cache:
                align_cache[language] = tr.load_align_model(language)
            return align_cache[language]

        for idx, ti in enumerate(track_inputs):
            audio_path = os.path.join(workdir, f"track-{idx}.audio")
            cli.download_to_file(ti.downloadUrl, audio_path)
            app.progress(
                job.jobId, "RUNNING",
                percent=10.0 + 70.0 * idx / max(1, total),
                message=f"track {idx + 1}/{total}",
            )
            if stub:
                tres = tr.transcribe_single_speaker_stub(language_hint=src_lang)
            else:
                tres = tr.transcribe_single_speaker_with_models(
                    audio_path,
                    asr=asr_model,
                    get_align_model=_get_align,
                    language_hint=src_lang,
                )
            detected_lang = tres.get("language") or detected_lang

            # Offset: parti dal manifest, poi raffina col mix se disponibile.
            offset_ms = ti.startOffsetMs or 0
            if mix_path is not None:
                refined = almod.estimate_track_offset_ms(
                    audio_path, mix_path, prior_ms=offset_ms,
                )
                if refined is not None:
                    new_off, conf = refined
                    log.info(
                        "track %d offset raffinato: %d→%d ms (conf=%.2f)",
                        idx, offset_ms, new_off, conf,
                    )
                    offset_ms = new_off

            track_results.append(
                {
                    "participant_id": ti.participantId or f"track-{idx}",
                    "display_name": ti.displayName,
                    "start_offset_ms": offset_ms,
                    "segments": tres.get("segments") or [],
                }
            )

        merged = mtmod.merge_tracks(track_results, language=detected_lang)
        app.progress(job.jobId, "RUNNING", percent=85.0, message="merged tracks")

        # Nomi reali per la VTT + speakerMap (con displayName → il portale
        # popola Speaker.displayName senza mapping manuale).
        names = {
            t["participant_id"]: t["display_name"]
            for t in track_results
            if t.get("display_name")
        }
        speaker_map = [
            {
                "diarLabel": s["diarLabel"],
                "displayName": s.get("displayName"),
                "totalSpeechSec": s["totalSpeechSec"],
            }
            for s in merged["speakers"]
        ]
        model_version = os.environ.get("WHISPERX_VERSION", "whisperx-3.1") + "+multitrack"

        raw_bytes = json.dumps(merged, ensure_ascii=False).encode("utf-8")
        _write_and_upload(
            app, job.jobId, target=job.uploadTargets["transcriptJson"],
            artifact_type="TRANSCRIPT_JSON", language=None, body_bytes=raw_bytes,
            model_id="multitrack", model_version=model_version, speaker_map=speaker_map,
        )
        vtt_bytes = vttmod.segments_to_vtt(merged["segments"], speaker_names=names).encode("utf-8")
        _write_and_upload(
            app, job.jobId, target=job.uploadTargets["transcriptVtt"],
            artifact_type="TRANSCRIPT_VTT", language=detected_lang, body_bytes=vtt_bytes,
            model_id="multitrack", model_version=model_version,
        )
        txt_bytes = vttmod.segments_to_plain_text(merged["segments"], speaker_names=names).encode("utf-8")
        _write_and_upload(
            app, job.jobId, target=job.uploadTargets["transcriptTxt"],
            artifact_type="TRANSCRIPT_TXT", language=detected_lang, body_bytes=txt_bytes,
            model_id="multitrack", model_version=model_version,
        )
        # Niente waveform qui: il multitrack non ha un MP4 misto unico
        # (l'editor gestisce waveform assente). Se esiste il mix Jibri,
        # la waveform è prodotta dal flusso TRANSCRIBE classico.


def run_summarize(app: cli.AppClient, job: cli.ClaimResponse) -> None:
    src_lang = job.payload.get("sourceLanguage") or "it"
    transcript_input = next(
        (i for i in job.inputs if i.role == "transcript"), None
    )
    if not transcript_input:
        raise RuntimeError("SUMMARIZE without transcript input")

    with tempfile.TemporaryDirectory(prefix="postprod-") as workdir:
        transcript_path = os.path.join(workdir, "transcript.json")
        cli.download_to_file(transcript_input.downloadUrl, transcript_path)
        with open(transcript_path, "r", encoding="utf-8") as f:
            transcript = json.load(f)

        # Nomi reali per l'LLM: priorità ai Speaker del DB (job.speakerNames,
        # mapping admin/multitrack), fallback ai nomi embeddati nel transcript
        # (multitrack: dal JWT). Così la sintesi cita "Raffaele" non "SPEAKER_00".
        names = dict(getattr(job, "speakerNames", {}) or {})
        for sp in transcript.get("speakers", []) or []:
            dl, dn = sp.get("diarLabel"), sp.get("displayName")
            if dl and dn and dl not in names:
                names[dl] = dn
        text = vttmod.segments_to_plain_text(transcript.get("segments", []), speaker_names=names)
        app.progress(job.jobId, "RUNNING", percent=30.0, message="calling LLM")

        # Agenda/note (opzionale): se l'evento la usa, il claim la mette nel
        # payload come lista {label, completed}. Confluisce nel prompt LLM.
        agenda_items = job.payload.get("agenda") if isinstance(job.payload, dict) else None

        # Sintesi STRUTTURATA (una chiamata vLLM JSON-mode): overall +
        # decisioni + azioni + topics con start_mmss. È la sorgente di
        # verità; il Markdown è renderizzato deterministicamente da qui.
        summary_obj = llmmod.summarize_transcript_structured(
            transcript_text=text,
            source_language=src_lang,
            base_url=job.providerHints.llmBaseUrl,
            model_id=job.providerHints.llmModelId,
            agenda_items=agenda_items,
        )

        # SUMMARY_JSON (strutturato) — usato da hero card + topic-chips.
        json_bytes = json.dumps(summary_obj, ensure_ascii=False).encode("utf-8")
        _write_and_upload(
            app, job.jobId,
            target=job.uploadTargets["summaryJson"],
            artifact_type="SUMMARY_JSON",
            language=src_lang,
            body_bytes=json_bytes,
            model_id=job.providerHints.llmModelId,
        )

        # SUMMARY_MD (render deterministico dal JSON, niente seconda LLM).
        summary_md = llmmod.render_summary_md(summary_obj, lang=src_lang)
        _write_and_upload(
            app, job.jobId,
            target=job.uploadTargets["summary"],
            artifact_type="SUMMARY_MD",
            language=src_lang,
            body_bytes=summary_md.encode("utf-8"),
            model_id=job.providerHints.llmModelId,
        )


def run_translate(app: cli.AppClient, job: cli.ClaimResponse) -> None:
    target_lang = job.payload.get("targetLanguage")
    if not target_lang:
        raise RuntimeError("TRANSLATE missing targetLanguage")

    transcript_input = next(
        (i for i in job.inputs if i.role == "transcript"), None
    )
    if not transcript_input:
        raise RuntimeError("TRANSLATE without transcript input")

    with tempfile.TemporaryDirectory(prefix="postprod-") as workdir:
        transcript_path = os.path.join(workdir, "transcript.json")
        cli.download_to_file(transcript_input.downloadUrl, transcript_path)
        with open(transcript_path, "r", encoding="utf-8") as f:
            transcript = json.load(f)

        # Nomi reali (DB Speaker + fallback transcript) per i sottotitoli
        # tradotti: la label nel VTT diventa "Raffaele" non "SPEAKER_00".
        names = dict(getattr(job, "speakerNames", {}) or {})
        for sp in transcript.get("speakers", []) or []:
            dl, dn = sp.get("diarLabel"), sp.get("displayName")
            if dl and dn and dl not in names:
                names[dl] = dn

        app.progress(job.jobId, "RUNNING", percent=20.0, message="translating segments")
        translated_segments = llmmod.translate_segments(
            segments=transcript.get("segments", []),
            target_language=target_lang,
            base_url=job.providerHints.llmBaseUrl,
            model_id=job.providerHints.llmModelId,
        )

        # TRANSLATION_VTT (subtitle track in the target language).
        vtt_bytes = vttmod.segments_to_vtt(translated_segments, speaker_names=names).encode("utf-8")
        _write_and_upload(
            app,
            job.jobId,
            target=job.uploadTargets["transcriptVtt"],
            artifact_type="TRANSLATION_VTT",
            language=target_lang,
            body_bytes=vtt_bytes,
            model_id=job.providerHints.llmModelId,
        )

        # Sintesi tradotta. Il claim fornisce la sintesi STRUTTURATA
        # sorgente come input role 'summary' (SUMMARY_JSON nella lingua
        # sorgente). La traduciamo mantenendo lo shape → SUMMARY_JSON
        # [target] + TRANSLATION_MD[target] (render deterministico).
        # FIX del bug storico: prima leggeva transcript.get("summary")
        # (campo inesistente nel TRANSCRIPT_JSON) → placeholder vuoto.
        # Se l'evento non ha aiSummaryEnabled, l'input manca: produciamo
        # comunque artifact vuoti (richiesti da expectedArtifactsForJob).
        summary_obj = {"overall_summary": "", "key_decisions": [], "action_items": [], "topics": []}
        summary_input = next((i for i in job.inputs if i.role == "summary"), None)
        if summary_input:
            summary_path = os.path.join(workdir, "summary.json")
            cli.download_to_file(summary_input.downloadUrl, summary_path)
            try:
                with open(summary_path, "r", encoding="utf-8") as f:
                    src_summary = json.load(f)
                summary_obj = llmmod.translate_summary_structured(
                    summary=src_summary,
                    target_language=target_lang,
                    base_url=job.providerHints.llmBaseUrl,
                    model_id=job.providerHints.llmModelId,
                )
            except Exception:  # noqa: BLE001 — sintesi tradotta best-effort
                log.exception("translate summary failed — emit empty summary for %s", target_lang)

        # SUMMARY_JSON[target] (strutturato, lingua target).
        _write_and_upload(
            app, job.jobId,
            target=job.uploadTargets["summaryJson"],
            artifact_type="SUMMARY_JSON",
            language=target_lang,
            body_bytes=json.dumps(summary_obj, ensure_ascii=False).encode("utf-8"),
            model_id=job.providerHints.llmModelId,
        )
        # TRANSLATION_MD[target] (render Markdown dalla sintesi tradotta).
        translated_md = llmmod.render_summary_md(summary_obj, lang=target_lang)
        _write_and_upload(
            app, job.jobId,
            target=job.uploadTargets["summary"],
            artifact_type="TRANSLATION_MD",
            language=target_lang,
            body_bytes=translated_md.encode("utf-8"),
            model_id=job.providerHints.llmModelId,
        )


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------


def run_dub(app: cli.AppClient, job: cli.ClaimResponse) -> None:
    """Generate TTS dubbing in target language from translated transcript.

    Input: TRANSLATION_VTT (segmenti tradotti con timestamp) via
    `inputs[].role == 'translatedTranscript'`.

    Output: 1 artifact DUBBED_AUDIO (.m4a) per la lingua target.
    """
    target_lang = job.payload.get("targetLanguage")
    if not target_lang:
        raise RuntimeError("DUB job without targetLanguage")

    translated = next(
        (i for i in job.inputs if i.role == "translatedTranscript"), None
    )
    if not translated:
        raise RuntimeError("DUB without translatedTranscript input")

    with tempfile.TemporaryDirectory(prefix="dub-") as workdir:
        # WebVTT non è ideale per re-parsare segmenti — preferiamo il
        # TRANSCRIPT_JSON del worker TRANSLATE, ma per ora il
        # TRANSLATION_VTT è ciò che abbiamo. Parse minimalista:
        vtt_path = os.path.join(workdir, "translated.vtt")
        cli.download_to_file(translated.downloadUrl, vtt_path)
        with open(vtt_path, "r", encoding="utf-8") as f:
            vtt_text = f.read()

        # Parse WebVTT tradotto → segmenti TTS (helper puro in vtt.py,
        # testato: rimuove tag <v> + prefisso "LABEL: " duplicato così
        # il TTS non pronuncia l'etichetta speaker).
        segments, total_duration = vttmod.parse_translated_vtt(vtt_text)

        app.progress(job.jobId, "RUNNING", percent=20.0, message="parsed transcript")

        if os.environ.get("WORKER_STUB") == "1":
            result = ttsmod.dub_stub(
                target_language=target_lang,
                total_duration_sec=total_duration,
                workdir=workdir,
            )
        else:
            voices_path = (
                job.providerHints.ttsVoicesPath or "/models/piper"
            )
            result = ttsmod.dub_with_piper(
                segments=segments,
                target_language=target_lang,
                voices_path=voices_path,
                total_duration_sec=total_duration,
            )

        app.progress(job.jobId, "RUNNING", percent=80.0, message="tts done")

        # Watermark AudioSeal (AI Act Art.50) sull'audio doppiato —
        # best-effort: se fallisce, pubblichiamo l'audio non watermarkato.
        # Disattivabile con AI_WATERMARK=0.
        watermark_type: Optional[str] = None
        if os.environ.get("AI_WATERMARK", "1") != "0":
            try:
                if ttsmod.watermark_m4a_inplace(result.audio_path):
                    watermark_type = "audioseal"
                    app.progress(job.jobId, "RUNNING", percent=85.0, message="watermarked")
            except Exception:  # noqa: BLE001 — watermark best-effort
                log.exception("audioseal watermark fallito — pubblico audio non watermarkato")

        # Upload + register DUBBED_AUDIO. Niente inline body (binary).
        with open(result.audio_path, "rb") as f:
            audio_bytes = f.read()
        target = job.uploadTargets["dubbedAudio"]
        _write_and_upload(
            app,
            job.jobId,
            target=target,
            artifact_type="DUBBED_AUDIO",
            language=target_lang,
            body_bytes=audio_bytes,
            model_id=f"{result.engine}:{result.voice_id}",
            model_version=result.model_version,
            inline_max_bytes=0,  # binario, niente inline
            watermark_type=watermark_type,
        )

        # DUBBED_VIDEO (best-effort, bonus): muxa il video sorgente con
        # l'audio doppiato → MP4 riproducibile/scaricabile offline. Un
        # fallimento qui NON fa fallire il job (l'audio è il deliverable
        # primario). Target presente solo se il claim l'ha generato.
        dv_target = job.uploadTargets.get("dubbedVideo")
        if dv_target is not None and getattr(job, "sourceDownloadUrl", None):
            try:
                src_mp4 = os.path.join(workdir, "source.mp4")
                cli.download_to_file(job.sourceDownloadUrl, src_mp4)
                dubbed_mp4 = os.path.join(workdir, f"dubbed.{target_lang}.mp4")
                subprocess.check_call(
                    [
                        "ffmpeg", "-y", "-loglevel", "error",
                        "-i", src_mp4, "-i", result.audio_path,
                        "-map", "0:v:0", "-map", "1:a:0",
                        "-c:v", "copy", "-c:a", "aac", "-b:a", "96k",
                        "-shortest", "-movflags", "+faststart", dubbed_mp4,
                    ]
                )
                cli.upload_from_file(dv_target.url, dubbed_mp4, content_type=dv_target.contentType)
                app.register_artifact(
                    job_id=job.jobId,
                    artifact_type="DUBBED_VIDEO",
                    language=target_lang,
                    blob_key=dv_target.blobKey,
                    size_bytes=os.path.getsize(dubbed_mp4),
                    mime_type=dv_target.contentType,
                    content_hash=_sha256_file(dubbed_mp4),
                    model_id=f"{result.engine}:{result.voice_id}",
                    model_version=result.model_version,
                    watermark_type=watermark_type,
                )
                app.progress(job.jobId, "RUNNING", percent=92.0, message="dubbed video muxed")
            except Exception:  # noqa: BLE001 — dubbed video best-effort
                log.exception("DUBBED_VIDEO mux failed — skip (audio già pubblicato)")


def run_archive(app: cli.AppClient, job: cli.ClaimResponse) -> None:
    """Archivio scaricabile multi-traccia (ADR-013).

    Muxa il mix video Jibri + una traccia audio per partecipante
    (allineata al mix via cross-correlazione) + i sottotitoli VTT in un
    MKV. Per il download admin/moderatore — l'audio isolato è PII.
    """
    if not getattr(job, "sourceDownloadUrl", None):
        raise RuntimeError("ARCHIVE without source mix (sourceDownloadUrl)")
    track_inputs = [i for i in job.inputs if i.role == "track"]
    subtitle_input = next((i for i in job.inputs if i.role == "subtitle"), None)
    if not track_inputs:
        raise RuntimeError("ARCHIVE without participant tracks")

    with tempfile.TemporaryDirectory(prefix="postprod-archive-") as workdir:
        app.progress(job.jobId, "RUNNING", percent=10.0, message="download mix")
        mix_path = os.path.join(workdir, "mix.mp4")
        cli.download_to_file(job.sourceDownloadUrl, mix_path)

        sub_path: Optional[str] = None
        if subtitle_input is not None:
            sub_path = os.path.join(workdir, "subtitle.vtt")
            cli.download_to_file(subtitle_input.downloadUrl, sub_path)

        tracks: List[arcmod.ArchiveTrack] = []
        total = len(track_inputs)
        for idx, ti in enumerate(track_inputs):
            tpath = os.path.join(workdir, f"track-{idx}.audio")
            cli.download_to_file(ti.downloadUrl, tpath)
            app.progress(
                job.jobId, "RUNNING",
                percent=20.0 + 50.0 * idx / max(1, total),
                message=f"align track {idx + 1}/{total}",
            )
            # Allineamento preciso al mix (Opzione C): parti dall'offset
            # wall-clock del manifest, raffinalo via cross-correlazione.
            offset_ms = ti.startOffsetMs or 0
            refined = almod.estimate_track_offset_ms(tpath, mix_path, prior_ms=offset_ms)
            if refined is not None:
                offset_ms = refined[0]
            tracks.append(
                {
                    "path": tpath,
                    "title": ti.displayName or ti.participantId or f"Partecipante {idx + 1}",
                    "language": None,
                    "offset_ms": offset_ms,
                }
            )

        app.progress(job.jobId, "RUNNING", percent=80.0, message="mux mkv")
        out_path = os.path.join(workdir, "archive.mkv")
        arcmod.build_archive_mkv(
            mix_path=mix_path,
            tracks=tracks,
            subtitle_path=sub_path,
            out_path=out_path,
        )

        target = job.uploadTargets["archive"]
        size = os.path.getsize(out_path)
        cli.upload_from_file(target.url, out_path, content_type=target.contentType)
        app.register_artifact(
            job_id=job.jobId,
            artifact_type="ARCHIVE_MKV",
            language=None,
            blob_key=target.blobKey,
            size_bytes=size,
            mime_type=target.contentType,
            content_hash=_sha256_file(out_path),
            model_id="archive-mux",
            model_version="ffmpeg-matroska",
        )


def run_one() -> int:
    with cli.AppClient() as app:
        job = app.claim()
        if job is None:
            log.info("no runnable job — exiting cleanly")
            return 0

        log.info(
            "claimed job %s kind=%s recording=%s attempts=%d",
            job.jobId,
            job.kind,
            job.recordingId,
            job.attempts,
        )

        try:
            app.progress(job.jobId, "RUNNING", percent=5.0, message="claimed")
            if job.kind == "TRANSCRIBE":
                run_transcribe(app, job)
            elif job.kind == "TRANSCRIBE_MULTITRACK":
                run_transcribe_multitrack(app, job)
            elif job.kind == "SUMMARIZE":
                run_summarize(app, job)
            elif job.kind == "TRANSLATE":
                run_translate(app, job)
            elif job.kind == "DUB":
                run_dub(app, job)
            elif job.kind == "ARCHIVE":
                run_archive(app, job)
            elif job.kind == "SUBTITLE":
                # SUBTITLE is satisfied by TRANSCRIBE today (it emits
                # the source-lang VTT). If we ever decouple them this
                # is the place.
                log.info("SUBTITLE is a no-op alias for TRANSCRIBE today")
            else:
                raise RuntimeError(f"unknown kind: {job.kind}")

            app.progress(job.jobId, "DONE")
            log.info("job %s done", job.jobId)
            return 0
        except Exception as e:  # pylint: disable=broad-except
            log.exception("job failed: %s", e)
            try:
                app.progress(
                    job.jobId,
                    "FAILED",
                    error=f"{type(e).__name__}: {e}"[:1900],
                )
            except Exception as e2:  # pylint: disable=broad-except
                log.error("could not report FAILED: %s", e2)
            return 1


def main() -> int:
    configure_logging()
    return run_one()


if __name__ == "__main__":
    sys.exit(main())
