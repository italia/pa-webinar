"""HTTP client for the pa-webinar app's /api/internal/postprod-* endpoints.

The worker talks to the app over cluster-internal Service DNS
(``http://pa-webinar-web:3000`` by default). All endpoints are
authenticated with the shared ``CRON_API_KEY`` via the ``x-api-key``
header.

This module is intentionally thin: no retries, no async, no pooling
beyond what httpx does by default. The worker is a one-shot Job — if
the API is unreachable the Pod exits non-zero and Kubernetes will
schedule another tick. Retrying inside the worker would mask infra
issues that the orchestrator should surface.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import httpx
from pydantic import BaseModel, ConfigDict, Field

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic models — mirror app/src/lib/ai/schemas.ts
# ---------------------------------------------------------------------------


class UploadTarget(BaseModel):
    url: str
    blobKey: str
    contentType: str


class ClaimInput(BaseModel):
    role: str
    downloadUrl: str
    blobKey: str
    # ADR-013: presenti solo per role="track" (TRANSCRIBE_MULTITRACK).
    participantId: Optional[str] = None
    displayName: Optional[str] = None
    startOffsetMs: Optional[int] = None


class ProviderHints(BaseModel):
    llmProvider: str = "vllm"
    asrProvider: str = "whisperx"
    ttsProvider: str = "piper"
    llmBaseUrl: Optional[str] = None
    llmModelId: Optional[str] = None
    asrModelId: Optional[str] = None
    ttsVoicesPath: Optional[str] = None
    # Initial prompt per Whisper, costruito server-side dai metadata
    # dell'evento (titolo, organizzazione, speakers). Migliora la
    # trascrizione dei nomi propri e dei termini tecnici dell'evento.
    asrInitialPrompt: Optional[str] = None
    # Numero di speaker attesi (dall'Event.expectedSpeakers). Quando
    # valorizzato, il worker forza k nel clustering della diarization.
    expectedSpeakers: Optional[int] = None


class ClaimResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    claimed: bool = True
    jobId: str
    recordingId: str
    kind: str
    payload: Dict[str, Any]
    attempts: int
    leaseExpiresAt: str
    sourceDownloadUrl: str
    uploadTargets: Dict[str, UploadTarget]
    inputs: List[ClaimInput] = Field(default_factory=list)
    # Mappa diarLabel→nome reale dai Speaker (DB). Usata da SUMMARIZE/TRANSLATE
    # per dare all'LLM/VTT i nomi veri invece di "SPEAKER_00". Vuota su blind
    # pre-mapping (fallback al label).
    speakerNames: Dict[str, str] = Field(default_factory=dict)
    providerHints: ProviderHints


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class AppClient:
    """Minimal client. Methods raise on non-2xx."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        worker_id: Optional[str] = None,
        timeout_seconds: float = 30.0,
    ) -> None:
        self.base_url = (base_url or os.environ["APP_INTERNAL_URL"]).rstrip("/")
        self.api_key = api_key or os.environ["CRON_API_KEY"]
        self.worker_id = worker_id or os.environ.get(
            "WORKER_ID", os.uname().nodename
        )
        self._client = httpx.Client(
            base_url=self.base_url,
            headers={
                "x-api-key": self.api_key,
                "content-type": "application/json",
            },
            timeout=timeout_seconds,
        )

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "AppClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:  # type: ignore[no-untyped-def]
        self.close()

    # ------------------------------------------------------------------
    # Endpoints
    # ------------------------------------------------------------------

    def claim(self, lease_minutes: int = 30) -> Optional[ClaimResponse]:
        """Try to claim a job. Returns None when nothing runnable."""
        r = self._client.post(
            "/api/internal/postprod-claim",
            json={
                "workerId": self.worker_id,
                "leaseMinutes": lease_minutes,
            },
        )
        if r.status_code == 204:
            return None
        r.raise_for_status()
        return ClaimResponse.model_validate(r.json())

    def progress(
        self,
        job_id: str,
        status: str,
        *,
        percent: Optional[float] = None,
        message: Optional[str] = None,
        error: Optional[str] = None,
    ) -> None:
        payload: Dict[str, Any] = {"jobId": job_id, "status": status}
        if percent is not None:
            payload["percent"] = percent
        if message is not None:
            payload["message"] = message
        if error is not None:
            payload["error"] = error
        r = self._client.post("/api/internal/postprod-progress", json=payload)
        r.raise_for_status()

    def register_artifact(
        self,
        *,
        job_id: str,
        artifact_type: str,
        language: Optional[str],
        blob_key: str,
        size_bytes: int,
        mime_type: str,
        content_hash: str,
        inline_body: Optional[str] = None,
        model_id: Optional[str] = None,
        model_version: Optional[str] = None,
        speaker_map: Optional[List[Dict[str, Any]]] = None,
        watermark_type: Optional[str] = None,
    ) -> None:
        payload: Dict[str, Any] = {
            "jobId": job_id,
            "type": artifact_type,
            "language": language,
            "blobKey": blob_key,
            "sizeBytes": size_bytes,
            "mimeType": mime_type,
            "contentHash": content_hash,
        }
        if inline_body is not None:
            payload["inlineBody"] = inline_body
        if model_id is not None:
            payload["modelId"] = model_id
        if model_version is not None:
            payload["modelVersion"] = model_version
        if speaker_map is not None:
            payload["speakerMap"] = speaker_map
        if watermark_type is not None:
            payload["watermarkType"] = watermark_type
        r = self._client.post("/api/internal/postprod-artifact", json=payload)
        r.raise_for_status()


# ---------------------------------------------------------------------------
# Storage IO via presigned URLs
# ---------------------------------------------------------------------------


def download_to_file(url: str, dest_path: str, *, chunk_size: int = 1 << 20) -> None:
    """Stream the bytes at ``url`` to ``dest_path``."""
    with httpx.stream("GET", url, timeout=600.0) as r:
        r.raise_for_status()
        with open(dest_path, "wb") as f:
            for chunk in r.iter_bytes(chunk_size):
                f.write(chunk)


def upload_from_file(
    url: str, src_path: str, *, content_type: str, chunk_size: int = 1 << 20
) -> None:
    """PUT the bytes at ``src_path`` to a presigned URL."""
    with open(src_path, "rb") as f:
        r = httpx.put(
            url,
            content=f.read(),
            headers=_put_headers(url, content_type),
            timeout=600.0,
        )
    r.raise_for_status()


def _put_headers(url: str, content_type: str) -> Dict[str, str]:
    """Headers for a presigned PUT.

    Azure Blob requires `x-ms-blob-type: BlockBlob` on PUT Blob, else it
    rejects with 400 "An HTTP header that's mandatory for this request is
    not specified." S3/GCS/MinIO presigned PUTs don't need it (and ignore
    the extra header), so we only add it for Azure blob endpoints.
    """
    headers = {"content-type": content_type}
    if "blob.core.windows.net" in url:
        headers["x-ms-blob-type"] = "BlockBlob"
    return headers


def upload_bytes(url: str, body: bytes, *, content_type: str) -> None:
    r = httpx.put(
        url,
        content=body,
        headers=_put_headers(url, content_type),
        timeout=600.0,
    )
    r.raise_for_status()
