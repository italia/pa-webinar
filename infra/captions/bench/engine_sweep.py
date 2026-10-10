"""Costo del modello per chunk e throughput, alla massima velocità.

Lancia `nemo-speech bench asr --mode stream` sulle frasi singole per ogni
combinazione di thread e contesto destro (la latenza algoritmica del
modello) e, a ogni livello di concorrenza, misura:

- il tempo di calcolo per chunk (media, p95, p99): finché resta sotto la
  durata del chunk, una voce sta al passo con il tempo reale;
- l'RTFx aggregato: secondi di audio elaborati per secondo di orologio,
  cioè quante voci simultanee si reggono al massimo, senza margine;
- il WER sulle frasi, per vedere se la quantizzazione o il chunk piccolo
  peggiorano la trascrizione dell'italiano;
- RAM di picco e tempo CPU del processo.

Un risultato per riga in `<out>/engine.jsonl`.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from pathlib import Path

from common import (
    corpus_wer,
    default_work_dir,
    fetch_engine,
    fetch_model,
    host_info,
    log,
    pinned,
)

# Contesto destro del modello -> durata del chunk (frame da 80 ms).
CHUNK_MS = {0: 80, 1: 160, 3: 320, 6: 560, 13: 1120}


def int_list(text: str) -> list[int]:
    return [int(x) for x in text.split(",") if x.strip()]


def run(cmd: list[str], logs: Path) -> tuple[str, dict[str, float]]:
    """Esegue `cmd` e restituisce stdout e le risorse consumate da quel figlio.

    Le uscite vanno su file e il figlio si raccoglie con `wait4`, che dà la
    RAM di picco e il tempo CPU del solo processo appena terminato.
    """
    logs.parent.mkdir(parents=True, exist_ok=True)
    out_path, err_path = logs.with_suffix(".out"), logs.with_suffix(".err")
    started = time.monotonic()
    with out_path.open("w") as out, err_path.open("w") as err:
        proc = subprocess.Popen(cmd, stdout=out, stderr=err)
        _, status, usage = os.wait4(proc.pid, 0)
    wall = time.monotonic() - started
    proc.returncode = os.waitstatus_to_exitcode(status)
    if proc.returncode != 0:
        tail = err_path.read_text(errors="replace")[-2000:]
        raise SystemExit(f"comando fallito ({proc.returncode}): {' '.join(cmd)}\n{tail}")
    return out_path.read_text(), {
        "wall_seconds": wall,
        "cpu_seconds": usage.ru_utime + usage.ru_stime,
        "peak_rss_mb": usage.ru_maxrss / 1024.0,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work", type=Path, default=default_work_dir())
    ap.add_argument("--out", type=Path, help="cartella dei risultati (default: <work>/results/<data>)")
    ap.add_argument("--threads", type=int_list, default=[1, 2, 4])
    ap.add_argument("--right-context", type=int_list, default=[1, 3, 6], help=f"valori in {sorted(CHUNK_MS)}")
    ap.add_argument("--concurrency", default="1", help="livelli di concorrenza, es. 1,2,4,8")
    ap.add_argument("--repetitions", type=int, default=1)
    ap.add_argument("--limit", type=int, default=0, help="usa solo le prime N frasi (0 = tutte)")
    ap.add_argument("--cpus", help="confina il motore su queste CPU (sintassi di taskset, es. 0-3)")
    ap.add_argument("--language", default="it-IT")
    args = ap.parse_args()

    work: Path = args.work
    engine = fetch_engine(work)
    model = fetch_model(work)
    corpus = work / "corpus"
    refs = json.loads((corpus / "references.json").read_text(encoding="utf-8"))["utterances"]
    source = corpus / "utterances"
    if args.limit:
        # Sottoinsieme stabile in una cartella a parte, così il motore vede
        # solo quei file.
        source = corpus / f"utterances-{args.limit}"
        source.mkdir(exist_ok=True)
        for stem in sorted(refs)[: args.limit]:
            link = source / f"{stem}.wav"
            if not link.exists():
                link.symlink_to(corpus / "utterances" / f"{stem}.wav")
        refs = {k: refs[k] for k in sorted(refs)[: args.limit]}

    out: Path = args.out or work / "results" / time.strftime("%Y%m%d-%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    host = host_info(args.cpus)
    (out / "host.json").write_text(json.dumps(host, indent=1))
    log(f"host: {host['cpu_model']} · CPU disponibili {host['affinity_cpus']} · confinamento {args.cpus or '-'}")

    for threads in args.threads:
        for rc in args.right_context:
            if rc not in CHUNK_MS:
                raise SystemExit(f"contesto destro {rc} non valido: usa {sorted(CHUNK_MS)}")
            tag = f"t{threads}-r{rc}-u{len(refs)}"
            hyp_dir = out / "hyp" / tag
            trace = out / "trace" / f"{tag}.jsonl"
            trace.parent.mkdir(parents=True, exist_ok=True)
            cmd = pinned(
                [
                    str(engine), "bench", "asr", str(source),
                    "--model", str(model), "--mode", "stream", "--device", "cpu",
                    "-l", args.language,
                    "-c", args.concurrency, "-n", str(args.repetitions), "--warmup", "1",
                    "--save", str(hyp_dir), "--trace", str(trace), "--json",
                    "--asr.backend.threads", str(threads),
                    "--asr.streaming.rnnt_right_context", str(rc),
                ],
                args.cpus,
            )
            load_before = os.getloadavg()[0]
            stdout, usage = run(cmd, out / "logs" / tag)
            report = json.loads(stdout)

            pairs = []
            for stem, ref in refs.items():
                hyp_file = hyp_dir / f"{stem}.txt"
                pairs.append((str(ref["text"]), hyp_file.read_text(encoding="utf-8") if hyp_file.exists() else ""))
            quality = corpus_wer(pairs)

            chunk_s = CHUNK_MS[rc] / 1000.0
            for run_ in report["runs"]:
                lat = run_["metrics"]["chunk_latency_ms"]
                row = {
                    "kind": "engine",
                    "threads": threads,
                    "right_context": rc,
                    "chunk_ms": report.get("chunk_ms", CHUNK_MS[rc]),
                    "concurrency": run_["concurrency"],
                    "utterances": len(refs),
                    "audio_seconds": run_["audio_seconds"],
                    "wall_seconds": run_["wall_seconds"],
                    "rtfx": run_["rtfx"],
                    "chunk_compute_ms": {k: lat[k] for k in ("mean", "p50", "p95", "p99", "max")},
                    # Quota del tempo reale spesa a calcolare un chunk: sopra 1
                    # la voce resta indietro e il ritardo cresce senza limite.
                    "chunk_load_p95": lat["p95"] / 1000.0 / chunk_s,
                    "wer": quality["wer"],
                    "ref_words": quality["ref_words"],
                    # Tempo CPU e RAM dell'intero processo: includono caricamento,
                    # riscaldamento e tutti i livelli di concorrenza del giro.
                    "process_cpu_seconds": usage["cpu_seconds"],
                    "process_wall_seconds": usage["wall_seconds"],
                    "peak_rss_mb": usage["peak_rss_mb"],
                    "transcript_mismatches": run_.get("transcript_mismatches"),
                    # Carico della macchina prima e dopo: su un host condiviso un
                    # valore alto rende il punto inaffidabile.
                    "loadavg": [load_before, os.getloadavg()[0]],
                    "host": host,
                }
                with (out / "engine.jsonl").open("a", encoding="utf-8") as f:
                    f.write(json.dumps(row) + "\n")
                log(
                    f"{tag} c={row['concurrency']:>2} chunk {row['chunk_ms']} ms · calcolo p95 "
                    f"{lat['p95']:.1f} ms ({row['chunk_load_p95']:.0%} del chunk) · RTFx {row['rtfx']:.1f} · "
                    f"WER {quality['wer']:.2%}"
                )
    log(f"risultati in {out}")


if __name__ == "__main__":
    main()
