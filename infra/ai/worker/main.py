"""Postprod worker entrypoint.

Usage (inside the container):

    python -m worker.main           # claim one job, run it, exit

Environment:
    APP_INTERNAL_URL    e.g. http://eventi-dtd-web:3000
    CRON_API_KEY        shared secret with the app
    WORKER_ID           pod name (auto-detected if unset)
    WORKER_STUB=1       skip real ASR + LLM, use canned outputs
    HF_TOKEN            HuggingFace access token for pyannote
    WHISPERX_VERSION    optional version label recorded on artifacts
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sys
import tempfile
from typing import Any, Dict, List, Optional

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
                tres = tr.transcribe_single_speaker(
                    audio_path,
                    language_hint=src_lang,
                    asr_model_id=(job.providerHints.asrModelId or "large-v3"),
                    initial_prompt=job.providerHints.asrInitialPrompt,
                )
            detected_lang = tres.get("language") or detected_lang
            track_results.append(
                {
                    "participant_id": ti.participantId or f"track-{idx}",
                    "display_name": ti.displayName,
                    "start_offset_ms": ti.startOffsetMs or 0,
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
        txt_bytes = vttmod.segments_to_plain_text(merged["segments"]).encode("utf-8")
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

        text = vttmod.segments_to_plain_text(transcript.get("segments", []))
        app.progress(job.jobId, "RUNNING", percent=30.0, message="calling LLM")

        summary_md = llmmod.summarize_transcript(
            transcript_text=text,
            source_language=src_lang,
            base_url=job.providerHints.llmBaseUrl,
            model_id=job.providerHints.llmModelId,
        )
        body = summary_md.encode("utf-8")
        _write_and_upload(
            app,
            job.jobId,
            target=job.uploadTargets["summary"],
            artifact_type="SUMMARY_MD",
            language=src_lang,
            body_bytes=body,
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

        app.progress(job.jobId, "RUNNING", percent=20.0, message="translating segments")
        translated_segments = llmmod.translate_segments(
            segments=transcript.get("segments", []),
            target_language=target_lang,
            base_url=job.providerHints.llmBaseUrl,
            model_id=job.providerHints.llmModelId,
        )

        # TRANSLATION_VTT (subtitle track in the target language).
        vtt_bytes = vttmod.segments_to_vtt(translated_segments).encode("utf-8")
        _write_and_upload(
            app,
            job.jobId,
            target=job.uploadTargets["transcriptVtt"],
            artifact_type="TRANSLATION_VTT",
            language=target_lang,
            body_bytes=vtt_bytes,
            model_id=job.providerHints.llmModelId,
        )

        # TRANSLATION_MD (translated summary, if the source summary is
        # available). We don't always have it (the orchestrator may
        # have skipped SUMMARIZE for this event), so the worker tries
        # to fetch a SUMMARY_MD via the recording's existing artifacts
        # — but the dependency graph already ensured SUMMARIZE ran
        # first if the event enabled it. If the input role is missing
        # we just emit an empty placeholder.
        summary_text = transcript.get("summary") or ""
        if summary_text:
            translated_summary = llmmod.translate_text(
                text=summary_text,
                target_language=target_lang,
                base_url=job.providerHints.llmBaseUrl,
                model_id=job.providerHints.llmModelId,
            )
        else:
            translated_summary = (
                f"<!-- no source summary to translate to {target_lang} -->\n"
            )
        body = translated_summary.encode("utf-8")
        _write_and_upload(
            app,
            job.jobId,
            target=job.uploadTargets["summary"],
            artifact_type="TRANSLATION_MD",
            language=target_lang,
            body_bytes=body,
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

        # Parse manuale WebVTT → segmenti. webvtt-py è in requirements
        # ma il parser di base è semplice e più portabile.
        segments: list[ttsmod.Segment] = []
        total_duration = 0.0
        block_lines: list[str] = []
        for line in vtt_text.split("\n"):
            if " --> " in line:
                # nuovo segmento
                if block_lines:
                    segments.append({
                        "start": parsed_start,
                        "end": parsed_end,
                        "text": " ".join(block_lines).strip(),
                    })
                    block_lines = []
                ts = line.split(" --> ")
                parsed_start = _parse_vtt_ts(ts[0].strip())
                parsed_end = _parse_vtt_ts(ts[1].strip().split()[0])
                total_duration = max(total_duration, parsed_end)
            elif line.strip() and not line.strip().isdigit() and line.strip() != "WEBVTT":
                # Drop the <v Speaker> tag if present.
                txt = line.strip()
                if txt.startswith("<v "):
                    txt = txt.split(">", 1)[-1]
                block_lines.append(txt)
        if block_lines:
            segments.append({
                "start": parsed_start,
                "end": parsed_end,
                "text": " ".join(block_lines).strip(),
            })

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
        )


def _parse_vtt_ts(ts: str) -> float:
    """Parse 'HH:MM:SS.mmm' o 'MM:SS.mmm' → float seconds."""
    parts = ts.strip().split(":")
    if len(parts) == 3:
        h, m, s = parts
        return int(h) * 3600 + int(m) * 60 + float(s)
    if len(parts) == 2:
        m, s = parts
        return int(m) * 60 + float(s)
    return float(parts[0])


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
