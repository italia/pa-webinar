"""Funzioni condivise dal banco di prova dei sottotitoli live.

Download con verifica dell'impronta, lettura e scrittura WAV senza
dipendenze, normalizzazione del testo italiano, WER, informazioni
sull'host. Le versioni del motore, del modello e del dataset sono fissate
qui: un risultato vale solo insieme alla terna che l'ha prodotto.
"""

from __future__ import annotations

import array
import hashlib
import os
import platform
import re
import struct
import sys
import tarfile
import unicodedata
import urllib.request
from pathlib import Path

# Motore: NeMo-Speech.cpp, build CPU per Linux x86_64 (Apache-2.0).
ENGINE_VERSION = "0.2.0"
ENGINE_ARCHIVE = f"nemo-speech-{ENGINE_VERSION}-linux-x86_64-cpu.tar.gz"
ENGINE_URL = (
    "https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/"
    f"v{ENGINE_VERSION}/{ENGINE_ARCHIVE}"
)
ENGINE_SHA256 = "f396057150f1b774935c7414fd32ebc04195a795a34120d78d8c9ecefa1b7507"

# Modello: Nemotron 3.5 ASR Streaming 0.6B, pesi quantizzati Q8_0 (OpenMDW-1.1).
MODEL_REPO = "nvidia/nemotron-3.5-asr-streaming-0.6b"
MODEL_REVISION = "ea30d66debe3740a08b573244286791d423d6b3e"
MODEL_FILE = "nemotron-3.5-asr-streaming-0.6b.q8_0.gguf"
MODEL_URL = f"https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REVISION}/{MODEL_FILE}"
MODEL_SHA256 = "3fc991d3badad7277c11030a7519832cddaf2057aafed6d4b25147e953a070b1"

# Dataset: FLEURS, italiano, split di test (CC-BY-4.0).
FLEURS_REVISION = "70bb2e84b976b7e960aa89f1c648e09c59f894dd"
FLEURS_BASE = (
    f"https://huggingface.co/datasets/google/fleurs/resolve/{FLEURS_REVISION}/data/it_it"
)
FLEURS_FILES = {
    "test.tsv": (
        f"{FLEURS_BASE}/test.tsv",
        "af1a6d7295547d283441e2ea2e6f24f41d9b26098b47fe3d588930cd053c7b08",
    ),
    "test.tar.gz": (
        f"{FLEURS_BASE}/audio/test.tar.gz",
        "97dbaedbfa52f4fa4a7b380be90b343066330b8526e1a88f5ab9f82f71f1758e",
    ),
}

SAMPLE_RATE = 16000


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def default_work_dir() -> Path:
    return Path(os.environ.get("BENCH_WORK", "work")).resolve()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def download(url: str, dest: Path, sha256: str) -> Path:
    """Scarica `url` in `dest` se manca o non corrisponde all'impronta attesa."""
    if dest.exists() and sha256_file(dest) == sha256:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    log(f"download {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "captions-bench"})
    with urllib.request.urlopen(req) as resp, part.open("wb") as out:
        while block := resp.read(1 << 20):
            out.write(block)
    got = sha256_file(part)
    if got != sha256:
        part.unlink()
        raise SystemExit(f"impronta errata per {url}: atteso {sha256}, ottenuto {got}")
    part.rename(dest)
    return dest


def fetch_engine(work: Path) -> Path:
    """Scarica ed estrae il motore; restituisce il percorso dell'eseguibile.

    `BENCH_ENGINE` punta a un eseguibile già presente e salta il download.
    """
    if os.environ.get("BENCH_ENGINE"):
        return Path(os.environ["BENCH_ENGINE"])
    root = work / "engine"
    binary = root / ENGINE_ARCHIVE.removesuffix(".tar.gz") / "bin" / "nemo-speech"
    if binary.exists():
        return binary
    archive = download(ENGINE_URL, work / "downloads" / ENGINE_ARCHIVE, ENGINE_SHA256)
    root.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as tar:
        tar.extractall(root, filter="data")
    binary.chmod(0o755)
    return binary


def fetch_model(work: Path) -> Path:
    return download(MODEL_URL, work / "models" / MODEL_FILE, MODEL_SHA256)


# --- WAV -------------------------------------------------------------------


def parse_wav(data: bytes) -> tuple[array.array, int]:
    """Decodifica un WAV PCM16 o float32 in campioni int16 mono.

    FLEURS distribuisce WAV float32 (formato 3), che il modulo `wave` della
    libreria standard non legge.
    """
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("non è un file WAV")
    fmt: tuple[int, ...] | None = None
    payload: bytes | None = None
    i = 12
    while i + 8 <= len(data):
        cid = data[i : i + 4]
        size = struct.unpack("<I", data[i + 4 : i + 8])[0]
        body = data[i + 8 : i + 8 + size]
        if cid == b"fmt ":
            fmt = struct.unpack("<HHIIHH", body[:16])
            if fmt[0] == 0xFFFE and len(body) >= 26:
                # WAVE_FORMAT_EXTENSIBLE: il formato vero è nel sottoformato.
                fmt = (struct.unpack("<H", body[24:26])[0], *fmt[1:])
        elif cid == b"data":
            payload = body
        i += 8 + size + (size & 1)
    if fmt is None or payload is None:
        raise ValueError("WAV senza blocchi fmt/data")
    tag, channels, rate, _, _, bits = fmt
    if tag == 1 and bits == 16:
        samples = array.array("h")
        samples.frombytes(payload[: len(payload) // 2 * 2])
    elif tag == 3 and bits == 32:
        floats = array.array("f")
        floats.frombytes(payload[: len(payload) // 4 * 4])
        samples = array.array(
            "h", (max(-32768, min(32767, int(round(x * 32767.0)))) for x in floats)
        )
    else:
        raise ValueError(f"formato WAV non supportato: tag={tag} bit={bits}")
    if sys.byteorder != "little":
        samples.byteswap()
    if channels > 1:
        samples = array.array(
            "h",
            (
                int(sum(samples[k : k + channels]) / channels)
                for k in range(0, len(samples) - channels + 1, channels)
            ),
        )
    return samples, rate


def read_wav(path: Path) -> tuple[array.array, int]:
    return parse_wav(path.read_bytes())


def write_wav(path: Path, samples: array.array, rate: int = SAMPLE_RATE) -> None:
    pcm = array.array("h", samples)
    if sys.byteorder != "little":
        pcm.byteswap()
    raw = pcm.tobytes()
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + len(raw), b"WAVE",
        b"fmt ", 16, 1, 1, rate, rate * 2, 2, 16,
        b"data", len(raw),
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + raw)


# --- Testo e WER -----------------------------------------------------------

_LANG_TAG = re.compile(r"<[a-z]{2,3}-[a-z]{2}>")
_NOT_WORD = re.compile(r"[^\w' ]+")
_LOOSE_APOSTROPHE = re.compile(r"(?<!\w)'|'(?!\w)")


def normalize_words(text: str) -> list[str]:
    """Parole confrontabili: minuscole, senza punteggiatura né tag di lingua.

    L'apostrofo interno resta ("l'incidente" è una parola sola), come nelle
    trascrizioni normalizzate di FLEURS. I numeri non vengono convertiti: una
    cifra contro la stessa quantità scritta in lettere conta come errore, e il
    WER risulta un po' più alto di quello pubblicato con normalizzatori più
    aggressivi.
    """
    t = unicodedata.normalize("NFC", text).lower()
    t = t.replace("’", "'").replace("‘", "'").replace("`", "'")
    t = _LANG_TAG.sub(" ", t)
    t = _NOT_WORD.sub(" ", t.replace("_", " "))
    t = _LOOSE_APOSTROPHE.sub(" ", t)
    return t.split()


def edit_distance(ref: list[str], hyp: list[str]) -> int:
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i] + [0] * len(hyp)
        for j, h in enumerate(hyp, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h))
        prev = cur
    return prev[-1]


def corpus_wer(pairs: list[tuple[str, str]]) -> dict[str, float | int]:
    """WER di corpus: errori totali su parole di riferimento totali."""
    errors = words = 0
    for ref, hyp in pairs:
        r = normalize_words(ref)
        errors += edit_distance(r, normalize_words(hyp))
        words += len(r)
    return {"wer": errors / words if words else 0.0, "errors": errors, "ref_words": words}


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    k = (len(ordered) - 1) * p / 100.0
    lo = int(k)
    hi = min(lo + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


# --- Host ------------------------------------------------------------------


def cgroup_cpu_limit() -> float | None:
    """Limite di CPU del cgroup v2 (quota/periodo), se impostato."""
    try:
        quota, period = Path("/sys/fs/cgroup/cpu.max").read_text().split()
    except (OSError, ValueError):
        return None
    return None if quota == "max" else int(quota) / int(period)


def host_info(cpus: str | None) -> dict[str, object]:
    model = ""
    try:
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.startswith("model name"):
                model = line.split(":", 1)[1].strip()
                break
    except OSError:
        pass
    flags: set[str] = set()
    try:
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.startswith("flags"):
                flags = set(line.split(":", 1)[1].split())
                break
    except OSError:
        pass
    return {
        "node": os.environ.get("NODE_NAME") or platform.node(),
        "cpu_model": model,
        "logical_cpus": os.cpu_count(),
        "affinity_cpus": len(os.sched_getaffinity(0)),
        "cgroup_cpu_limit": cgroup_cpu_limit(),
        "pinned_cpus": cpus,
        "isa": sorted(f for f in ("avx2", "avx512f", "avx512_vnni", "avx512_bf16", "amx_tile") if f in flags),
        "engine_version": ENGINE_VERSION,
        "model": MODEL_FILE,
        "model_revision": MODEL_REVISION,
    }


def pinned(cmd: list[str], cpus: str | None) -> list[str]:
    """Antepone `taskset` quando il banco va confinato su CPU precise."""
    return ["taskset", "-c", cpus, *cmd] if cpus else cmd
