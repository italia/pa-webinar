"""Prepara il corpus del banco di prova a partire da FLEURS italiano (test).

Produce, sotto la cartella di lavoro:

- `corpus/utterances/*.wav`: frasi singole (una registrazione per frase),
  per WER e costo per chunk;
- `corpus/longform/*.wav`: tracce lunghe ottenute concatenando frasi con
  una pausa, una per ciascuna voce simulata nella prova di carico in tempo
  reale;
- `corpus/references.json`: testi di riferimento e confini delle frasi.

Tutto l'audio esce PCM16 mono a 16 kHz, lo stesso formato che il servizio
riceve dopo la decodifica dell'Opus del bridge.
"""

from __future__ import annotations

import argparse
import array
import csv
import json
import tarfile
from pathlib import Path

from common import (
    FLEURS_FILES,
    SAMPLE_RATE,
    default_work_dir,
    download,
    fetch_engine,
    fetch_model,
    log,
    parse_wav,
    write_wav,
)

MIN_SECONDS = 2.0
MAX_SECONDS = 25.0
FRAME = SAMPLE_RATE // 50  # 20 ms
MARGIN = SAMPLE_RATE // 10  # 100 ms di respiro attorno al parlato


def speech_bounds(samples: array.array) -> tuple[int, int]:
    """Primo e ultimo campione di parlato, con una soglia d'energia relativa.

    Le registrazioni FLEURS hanno spesso secondi di silenzio in testa e in
    coda: nelle tracce lunghe vanno tolti, altrimenti il ritardo della prima
    parola misurerebbe il silenzio e non il modello.
    """
    energies = [
        sum(x * x for x in samples[i : i + FRAME]) / FRAME
        for i in range(0, len(samples) - FRAME + 1, FRAME)
    ]
    if not energies:
        return 0, len(samples)
    threshold = max(energies) * 0.01  # -20 dB rispetto al frame più forte
    voiced = [i for i, e in enumerate(energies) if e >= threshold]
    start = max(0, voiced[0] * FRAME - MARGIN)
    end = min(len(samples), (voiced[-1] + 1) * FRAME + MARGIN)
    return start, end


def load_rows(tsv: Path) -> list[dict[str, object]]:
    """Una registrazione per frase, in ordine stabile.

    Il nome del file FLEURS è un identificativo casuale: ordinare per nome
    mescola parlanti e argomenti senza bisogno di un seme.
    """
    by_sentence: dict[str, dict[str, object]] = {}
    with tsv.open(newline="", encoding="utf-8") as f:
        for row in csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            sid, wav, raw, _norm, _chars, samples, gender = row[:7]
            seconds = int(samples) / SAMPLE_RATE
            if not MIN_SECONDS <= seconds <= MAX_SECONDS:
                continue
            current = by_sentence.get(sid)
            if current is None or wav < str(current["wav"]):
                by_sentence[sid] = {
                    "id": sid, "wav": wav, "text": raw, "seconds": seconds, "gender": gender,
                }
    return sorted(by_sentence.values(), key=lambda r: str(r["wav"]))


def extract(tar_path: Path, names: set[str]) -> dict[str, array.array]:
    wanted = {f"test/{n}" for n in names}
    audio: dict[str, array.array] = {}
    with tarfile.open(tar_path, "r:gz") as tar:
        for member in tar:
            if member.name not in wanted:
                continue
            f = tar.extractfile(member)
            if f is None:
                continue
            samples, rate = parse_wav(f.read())
            if rate != SAMPLE_RATE:
                raise SystemExit(f"{member.name}: {rate} Hz, attesi {SAMPLE_RATE}")
            audio[member.name.removeprefix("test/")] = samples
    missing = names - audio.keys()
    if missing:
        raise SystemExit(f"mancano nell'archivio: {sorted(missing)[:5]}")
    return audio


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work", type=Path, default=default_work_dir())
    ap.add_argument("--utterances", type=int, default=60, help="frasi singole per WER e costo per chunk")
    ap.add_argument("--longform-count", type=int, default=16, help="voci simulate (tracce lunghe)")
    ap.add_argument("--longform-seconds", type=float, default=150.0, help="durata di ogni traccia lunga")
    ap.add_argument("--pause-seconds", type=float, default=0.6, help="pausa tra le frasi di una traccia lunga")
    args = ap.parse_args()

    work: Path = args.work
    fetch_engine(work)
    fetch_model(work)
    fleurs = work / "downloads" / "fleurs-it"
    paths = {name: download(url, fleurs / name, sha) for name, (url, sha) in FLEURS_FILES.items()}

    rows = load_rows(paths["test.tsv"])
    if len(rows) < args.utterances + 10:
        raise SystemExit(f"solo {len(rows)} frasi utilizzabili")
    single = rows[: args.utterances]
    pool = rows[args.utterances :]

    # Ogni traccia lunga parte da un punto diverso della lista: voci diverse
    # dicono cose diverse, come in una sala vera.
    plans: list[list[dict[str, object]]] = []
    stride = max(1, len(pool) // max(1, args.longform_count))
    for k in range(args.longform_count):
        plan: list[dict[str, object]] = []
        total = 0.0
        i = k * stride
        while total < args.longform_seconds:
            row = pool[i % len(pool)]
            plan.append(row)
            total += float(row["seconds"]) + args.pause_seconds
            i += 1
        plans.append(plan)

    names = {str(r["wav"]) for r in single} | {str(r["wav"]) for p in plans for r in p}
    log(f"estraggo {len(names)} registrazioni da FLEURS")
    audio = extract(paths["test.tar.gz"], names)

    corpus = work / "corpus"
    refs: dict[str, dict[str, object]] = {"utterances": {}, "longform": {}}
    for row in single:
        stem = str(row["wav"]).removesuffix(".wav")
        write_wav(corpus / "utterances" / f"{stem}.wav", audio[str(row["wav"])])
        refs["utterances"][stem] = {"text": row["text"], "seconds": row["seconds"]}

    pause = array.array("h", bytes(2 * int(args.pause_seconds * SAMPLE_RATE)))
    for k, plan in enumerate(plans):
        track = array.array("h")
        segments = []
        for row in plan:
            clip = audio[str(row["wav"])]
            lo, hi = speech_bounds(clip)
            start = len(track) / SAMPLE_RATE
            track.extend(clip[lo:hi])
            segments.append({"start": start, "end": len(track) / SAMPLE_RATE, "text": row["text"]})
            track.extend(pause)
        name = f"voice-{k:02d}"
        write_wav(corpus / "longform" / f"{name}.wav", track)
        refs["longform"][name] = {"seconds": len(track) / SAMPLE_RATE, "segments": segments}

    (corpus / "references.json").write_text(json.dumps(refs, ensure_ascii=False, indent=1), encoding="utf-8")
    seconds = sum(float(r["seconds"]) for r in single)
    log(
        f"corpus pronto in {corpus}: {len(single)} frasi ({seconds / 60:.1f} min), "
        f"{len(plans)} tracce lunghe da ~{args.longform_seconds:.0f} s"
    )


if __name__ == "__main__":
    main()
