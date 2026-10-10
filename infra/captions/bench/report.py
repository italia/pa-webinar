"""Riassume una cartella di risultati in tabelle Markdown.

Legge `engine.jsonl` e `paced.jsonl` e stampa, per la prova in tempo reale,
il giudizio su ogni punto e il numero massimo di voci che la configurazione
regge con margine.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

# Soglie del giudizio sulla prova in tempo reale. Il ritardo di calcolo si
# somma alla latenza algoritmica del chunk: mezzo secondo al p95 tiene il
# sottotitolo entro circa un secondo dalla voce con chunk da 320 ms.
LAG_OK_S = 0.5
LAG_LIMIT_S = 1.0
DRIFT_OK_S = 0.25


def rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def fmt(value: float | None, pattern: str = "{:.2f}") -> str:
    return "–" if value is None else pattern.format(value)


def verdict(r: dict) -> str:
    lag = r["processing_lag_s"]["p95"]
    drift = r["lag_trend_s"] or 0.0
    if r["failed_sessions"] or lag is None:
        return "fallita"
    if lag <= LAG_OK_S and drift <= DRIFT_OK_S:
        return "regge"
    if lag <= LAG_LIMIT_S and drift <= DRIFT_OK_S * 2:
        return "al limite"
    return "non regge"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("results", type=Path, nargs="+", help="una o più cartelle di risultati")
    args = ap.parse_args()

    for folder in args.results:
        host_file = folder / "host.json"
        host = json.loads(host_file.read_text()) if host_file.exists() else {}
        print(f"## {folder.name}\n")
        if host:
            parts = [f"Host `{host.get('cpu_model')}`", f"CPU visibili {host.get('affinity_cpus')}"]
            if host.get("cgroup_cpu_limit"):
                parts.append(f"limite cgroup {host['cgroup_cpu_limit']:g}")
            if host.get("pinned_cpus"):
                parts.append(f"confinato su {host['pinned_cpus']}")
            parts.append(f"ISA {', '.join(host.get('isa', [])) or '–'}")
            parts.append(f"motore {host.get('engine_version')}")
            print(" · ".join(parts) + "\n")

        engine = rows(folder / "engine.jsonl")
        if engine:
            print("### Costo per chunk e throughput (massima velocità)\n")
            print("| Thread | Chunk | Concorrenza | Frasi | Calcolo p95 (ms) | Quota del chunk | RTFx aggregato | WER | RAM (MB) | Load |")
            print("|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
            for r in sorted(engine, key=lambda r: (r["threads"], r["chunk_ms"], r["concurrency"], r.get("utterances", 0))):
                print(
                    f"| {r['threads']} | {r['chunk_ms']} ms | {r['concurrency']} | {r.get('utterances', '–')} | "
                    f"{r['chunk_compute_ms']['p95']:.1f} | {r['chunk_load_p95']:.0%} | {r['rtfx']:.1f} | "
                    f"{r['wer']:.2%} | {r['peak_rss_mb']:.0f} | {fmt(r.get('loadavg', [None])[0], '{:.1f}')} |"
                )
            print()

        paced = rows(folder / "paced.jsonl")
        if paced:
            print("### Voci simultanee in tempo reale\n")
            print(
                "| Thread | Chunk | Batching | Voci | Ritardo calcolo p50 / p95 (s) | Prima parola p50 / p95 (s) "
                "| Deriva (s) | Core usati media / p95 | RAM (MB) | WER | Load | Giudizio |"
            )
            print("|---:|---:|:---:|---:|---:|---:|---:|---:|---:|---:|---:|:---|")
            best: dict[tuple, tuple[int, float | None]] = {}
            for r in sorted(paced, key=lambda r: (r["threads"], r["chunk_ms"], not r["batching"], r["sessions"])):
                v = verdict(r)
                key = (r["threads"], r["chunk_ms"], r["batching"])
                if v == "regge" and r["sessions"] > best.get(key, (0, None))[0]:
                    best[key] = (r["sessions"], r["server_cores"]["mean"])
                lag, first, cores = r["processing_lag_s"], r["first_word_s"], r["server_cores"]
                print(
                    f"| {r['threads']} | {r['chunk_ms']} ms | {'sì' if r['batching'] else 'no'} | {r['sessions']} | "
                    f"{fmt(lag['p50'])} / {fmt(lag['p95'])} | {fmt(first['p50'])} / {fmt(first['p95'])} | "
                    f"{fmt(r['lag_trend_s'], '{:+.2f}')} | {fmt(cores['mean'])} / {fmt(cores['p95'])} | "
                    f"{r['server_peak_rss_mb']:.0f} | {fmt(r['wer'], '{:.2%}')} | "
                    f"{fmt(r.get('loadavg', [None])[0], '{:.1f}')} | {v} |"
                )
            print()
            print("Voci massime che la configurazione regge con margine:\n")
            for (threads, chunk, batching), (n, cores) in sorted(best.items()):
                print(
                    f"- {threads} thread, chunk {chunk} ms, batching {'sì' if batching else 'no'}: "
                    f"**{n} voci**, {fmt(cores)} core usati in media"
                )
            print(
                f"\nGiudizio: *regge* = ritardo di calcolo p95 ≤ {LAG_OK_S} s e deriva ≤ {DRIFT_OK_S} s; "
                f"*al limite* = p95 ≤ {LAG_LIMIT_S} s. Il valore massimo di voci provato è un limite "
                "inferiore se anche l'ultimo punto regge.\n"
            )


if __name__ == "__main__":
    main()
