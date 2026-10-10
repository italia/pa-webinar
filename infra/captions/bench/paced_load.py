"""Prova di carico in tempo reale: N voci simultanee contro `nemo-speech serve`.

È la misura che decide il dimensionamento. Il server gira come girerebbe in
cluster (confinato con `--cpus`, se richiesto) e riceve N sessioni
WebSocket `/v1/audio/transcriptions/realtime`. Ogni sessione invia una
traccia lunga a ritmo reale in frame PCM16 da 20 ms, la cadenza dell'Opus
che il bridge inoltra. Per ogni N si misura:

- il ritardo di elaborazione: ogni evento del server riporta i secondi di
  audio già elaborati (`audio_processed`). La differenza tra l'istante di
  arrivo e l'istante in cui quell'audio era stato inviato è il ritardo che
  il calcolo aggiunge alla latenza algoritmica del chunk. Se cresce durante
  la prova, il server non sta al passo;
- il ritardo percepito: per ogni frase, quando ne arriva la prima parola
  rispetto a quando la frase è cominciata;
- CPU (in core) e RAM del server, campionate da /proc;
- il WER delle trascrizioni definitive rispetto alle frasi inviate.

Un risultato per riga in `<out>/paced.jsonl`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import signal
import subprocess
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import websockets

from common import (
    corpus_wer,
    default_work_dir,
    fetch_engine,
    fetch_model,
    host_info,
    log,
    percentile,
    pinned,
    read_wav,
    SAMPLE_RATE,
)

CHUNK_MS = {0: 80, 1: 160, 3: 320, 6: 560, 13: 1120}
CLK_TCK = os.sysconf("SC_CLK_TCK")


@dataclass
class Session:
    name: str
    t0: float = 0.0
    sent_seconds: float = 0.0
    events: list[tuple[float, dict]] = field(default_factory=list)
    error: str | None = None


def int_list(text: str) -> list[int]:
    return [int(x) for x in text.split(",") if x.strip()]


def proc_cpu_seconds(pid: int) -> float:
    fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
    return (int(fields[11]) + int(fields[12])) / CLK_TCK


def proc_rss_mb(pid: int) -> float:
    for line in Path(f"/proc/{pid}/status").read_text().splitlines():
        if line.startswith("VmRSS:"):
            return int(line.split()[1]) / 1024.0
    return 0.0


def start_server(args: argparse.Namespace, engine: Path, model: Path, sessions: int, log_path: Path) -> subprocess.Popen:
    cmd = pinned(
        [
            str(engine), "serve",
            "--asr-model", str(model), "--device", "cpu",
            "--host", "127.0.0.1", "--port", str(args.port), "--no-ui",
            # Ogni WebSocket occupa un worker HTTP: il pool deve superare le
            # sessioni, altrimenti le ultime restano in coda e la prova mente.
            "--threads", str(sessions + 4),
            "--read-timeout", "300", "--write-timeout", "300",
            "--asr.backend.threads", str(args.threads),
            "--asr.streaming.rnnt_right_context", str(args.right_context),
            # I valori booleani si passano con "=": separati da spazio il
            # parser li prende per argomenti posizionali.
            f"--asr.batching.enabled={'true' if args.batching else 'false'}",
            f"--asr.batching.state_arena_slots={max(16, sessions)}",
        ],
        args.cpus,
    )
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("w") as log_file:
        proc = subprocess.Popen(cmd, stdout=log_file, stderr=subprocess.STDOUT)
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise SystemExit(f"il server è uscito subito, vedi {log_path}")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{args.port}/v1/models", timeout=2) as r:
                if r.status == 200:
                    return proc
        except OSError:
            pass
        time.sleep(0.5)
    proc.kill()
    raise SystemExit(f"il server non è pronto dopo 180 s, vedi {log_path}")


def stop_server(proc: subprocess.Popen) -> None:
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


async def run_session(
    s: Session, url: str, pcm: bytes, frame_bytes: int, frame_s: float, delay: float, language: str, duration: float
) -> None:
    await asyncio.sleep(delay)
    try:
        async with websockets.connect(url, max_size=None, open_timeout=60, ping_interval=None) as ws:
            json.loads(await ws.recv())  # session.created
            await ws.send(json.dumps({"type": "session.update", "session": {"sample_rate": SAMPLE_RATE, "language": language}}))
            ack = json.loads(await ws.recv())
            if ack.get("type") != "session.updated":
                raise RuntimeError(f"session.update rifiutato: {ack}")

            async def receive() -> None:
                async for message in ws:
                    if isinstance(message, str):
                        s.events.append((time.monotonic(), json.loads(message)))

            receiver = asyncio.create_task(receive())
            total = min(len(pcm), int(duration * SAMPLE_RATE) * 2)
            s.t0 = time.monotonic()
            for k, offset in enumerate(range(0, total, frame_bytes)):
                wait = s.t0 + k * frame_s - time.monotonic()
                if wait > 0:
                    await asyncio.sleep(wait)
                await ws.send(pcm[offset : offset + frame_bytes])
            s.sent_seconds = total / 2 / SAMPLE_RATE
            await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
            # Attende la trascrizione definitiva dell'ultimo spezzone.
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if any(e.get("type") == "input_audio_buffer.committed" for _, e in s.events[-5:]):
                    break
                await asyncio.sleep(0.1)
            await asyncio.sleep(1.0)
            await ws.close()
            await asyncio.wait_for(receiver, timeout=10)
    except Exception as exc:  # una sessione fallita è un dato, non un crash
        s.error = f"{type(exc).__name__}: {exc}"


def analyse(s: Session, segments: list[dict]) -> dict[str, object]:
    lags: list[float] = []
    timeline: list[tuple[float, float]] = []
    deltas: list[tuple[float, str]] = []
    finals: list[str] = []
    for recv, ev in s.events:
        kind = ev.get("type", "")
        since_start = recv - s.t0
        if kind.endswith("transcription.delta"):
            processed = ev.get("audio_processed")
            if isinstance(processed, (int, float)):
                lag = since_start - float(processed)
                timeline.append((since_start, lag))
                if ev.get("delta"):
                    lags.append(lag)
                    deltas.append((since_start, ev["delta"]))
        elif kind.endswith("transcription.completed"):
            finals.append(str(ev.get("transcript", "")))
        elif kind == "error":
            s.error = s.error or json.dumps(ev)[:300]

    # Prima parola di ogni frase: il primo testo che arriva dopo l'inizio
    # della frase e prima dell'inizio della successiva, più un margine.
    first_word: list[float] = []
    sent = [seg for seg in segments if seg["end"] <= s.sent_seconds]
    for i, seg in enumerate(sent):
        limit = sent[i + 1]["start"] + 2.0 if i + 1 < len(sent) else s.sent_seconds + 5.0
        hit = next((t for t, text in deltas if seg["start"] <= t <= limit and text.strip()), None)
        if hit is not None:
            first_word.append(hit - seg["start"])

    # Tendenza: ritardo medio nell'ultimo quarto contro il primo quarto.
    trend = None
    if timeline:
        q = max(1, len(timeline) // 4)
        head = sum(l for _, l in timeline[:q]) / q
        tail = sum(l for _, l in timeline[-q:]) / q
        trend = tail - head
    quality = corpus_wer([(" ".join(seg["text"] for seg in sent), " ".join(finals))])
    return {
        "name": s.name,
        "timeline": [(round(t, 3), round(l, 3)) for t, l in timeline if l > 0.05 or t == timeline[-1][0]],
        "lags": lags,
        "first_word": first_word,
        "trend_s": trend,
        "wer": quality,
        "finals": len(finals),
        "sent_seconds": s.sent_seconds,
        "error": s.error,
    }


async def run_level(args: argparse.Namespace, n: int, voices: list[tuple[str, bytes, list[dict]]]) -> list[tuple[Session, list[dict]]]:
    url = f"ws://127.0.0.1:{args.port}/v1/audio/transcriptions/realtime"
    frame_s = args.frame_ms / 1000.0
    frame_bytes = int(SAMPLE_RATE * frame_s) * 2
    jobs = []
    sessions = []
    for i in range(n):
        name, pcm, segments = voices[i % len(voices)]
        s = Session(name=f"{name}#{i}")
        # Si taglia al confine di una frase: una frase troncata a metà
        # gonfierebbe il WER con parole che il riferimento non ha.
        ends = [seg["end"] for seg in segments if seg["end"] <= args.duration]
        cut = (ends[-1] if ends else args.duration) + 0.3
        sessions.append((s, segments))
        # Le voci partono sfalsate: i flussi del bridge non sono in fase.
        delay = args.ramp_seconds * i / max(1, n)
        jobs.append(run_session(s, url, pcm, frame_bytes, frame_s, delay, args.language, cut))
    await asyncio.gather(*jobs)
    return sessions


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work", type=Path, default=default_work_dir())
    ap.add_argument("--out", type=Path, help="cartella dei risultati (default: <work>/results/<data>)")
    ap.add_argument("--sessions", type=int_list, default=[1, 2, 4, 8])
    ap.add_argument("--duration", type=float, default=90.0, help="secondi di audio per voce")
    ap.add_argument("--threads", type=int, default=4, help="thread di calcolo del motore")
    ap.add_argument("--right-context", type=int, default=3, help=f"valori in {sorted(CHUNK_MS)}")
    ap.add_argument("--no-batching", dest="batching", action="store_false", help="disattiva il batching tra sessioni")
    ap.add_argument("--cpus", help="confina il server su queste CPU (sintassi di taskset, es. 0-3)")
    ap.add_argument("--port", type=int, default=18080)
    ap.add_argument("--frame-ms", type=int, default=20)
    ap.add_argument("--ramp-seconds", type=float, default=2.0, help="sfalsamento massimo tra l'avvio delle voci")
    ap.add_argument("--language", default="it-IT")
    args = ap.parse_args()
    if args.right_context not in CHUNK_MS:
        raise SystemExit(f"contesto destro {args.right_context} non valido: usa {sorted(CHUNK_MS)}")

    work: Path = args.work
    engine = fetch_engine(work)
    model = fetch_model(work)
    corpus = work / "corpus"
    refs = json.loads((corpus / "references.json").read_text(encoding="utf-8"))["longform"]
    voices = []
    for name in sorted(refs):
        samples, _ = read_wav(corpus / "longform" / f"{name}.wav")
        voices.append((name, samples.tobytes(), refs[name]["segments"]))
    if max(args.sessions) > len(voices):
        log(f"attenzione: {max(args.sessions)} sessioni ma {len(voices)} tracce, alcune voci si ripetono")

    out: Path = args.out or work / "results" / time.strftime("%Y%m%d-%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    host = host_info(args.cpus)
    (out / "host.json").write_text(json.dumps(host, indent=1))
    tag = f"t{args.threads}-r{args.right_context}{'' if args.batching else '-nobatch'}"

    for n in args.sessions:
        load_before = os.getloadavg()[0]
        server = start_server(args, engine, model, n, out / "logs" / f"serve-{tag}-n{n}.log")
        try:
            rss_peak = proc_rss_mb(server.pid)
            cpu_start = proc_cpu_seconds(server.pid)
            wall_start = time.monotonic()
            samples: list[float] = []

            async def sample_cpu() -> None:
                nonlocal rss_peak
                last_cpu, last_t = cpu_start, wall_start
                while True:
                    await asyncio.sleep(1.0)
                    now_cpu, now_t = proc_cpu_seconds(server.pid), time.monotonic()
                    samples.append((now_cpu - last_cpu) / (now_t - last_t))
                    last_cpu, last_t = now_cpu, now_t
                    rss_peak = max(rss_peak, proc_rss_mb(server.pid))

            async def level() -> list[tuple[Session, list[dict]]]:
                sampler = asyncio.create_task(sample_cpu())
                try:
                    return await run_level(args, n, voices)
                finally:
                    sampler.cancel()

            sessions = asyncio.run(level())
            cpu_used = proc_cpu_seconds(server.pid) - cpu_start
            wall = time.monotonic() - wall_start
        finally:
            stop_server(server)

        per = [analyse(s, segs) for s, segs in sessions]
        # Ritardo nel tempo per sessione (solo i punti sopra 50 ms), per
        # capire se un picco è all'avvio, a regime o in deriva.
        (out / "timeline").mkdir(exist_ok=True)
        (out / "timeline" / f"{tag}-n{n}.json").write_text(
            json.dumps({p["name"]: p["timeline"] for p in per})
        )
        lags = [x for p in per for x in p["lags"]]
        first = [x for p in per for x in p["first_word"]]
        trends = [p["trend_s"] for p in per if p["trend_s"] is not None]
        errors = sum(int(p["wer"]["errors"]) for p in per)
        words = sum(int(p["wer"]["ref_words"]) for p in per)
        failed = [p["error"] for p in per if p["error"]]
        row = {
            "kind": "paced",
            "threads": args.threads,
            "right_context": args.right_context,
            "chunk_ms": CHUNK_MS[args.right_context],
            "batching": args.batching,
            "sessions": n,
            "duration_s": args.duration,
            "processing_lag_s": {
                "p50": percentile(lags, 50), "p95": percentile(lags, 95), "max": max(lags) if lags else None,
            },
            "first_word_s": {"p50": percentile(first, 50), "p95": percentile(first, 95)},
            "lag_trend_s": max(trends) if trends else None,
            "server_cores": {
                "mean": cpu_used / wall if wall else None,
                "p95": percentile(samples, 95),
            },
            "server_peak_rss_mb": rss_peak,
            "wer": errors / words if words else None,
            "failed_sessions": len(failed),
            # Carico della macchina prima e dopo: su un host condiviso un
            # valore alto rende il punto inaffidabile.
            "loadavg": [load_before, os.getloadavg()[0]],
            "errors": failed[:3],
            "host": host,
        }
        with (out / "paced.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
        lag = row["processing_lag_s"]
        log(
            f"{tag} voci={n:>2} · ritardo calcolo p50 {lag['p50'] or 0:.2f} s p95 {lag['p95'] or 0:.2f} s · "
            f"prima parola p50 {row['first_word_s']['p50'] or 0:.2f} s · deriva {row['lag_trend_s'] or 0:+.2f} s · "
            f"CPU {row['server_cores']['mean'] or 0:.2f} core · RAM {rss_peak:.0f} MB · WER {row['wer'] or 0:.2%}"
            + (f" · {len(failed)} sessioni fallite" if failed else "")
        )
    log(f"risultati in {out}")


if __name__ == "__main__":
    main()
