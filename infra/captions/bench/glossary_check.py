"""Effetto di un glossario (word boosting) sulla trascrizione in streaming.

Il motore accetta per ogni sessione realtime una lista di frasi da
favorire (`speech_contexts`), senza riaddestrare nulla: è il punto in cui il
glossario dell'evento (termini, sigle, nomi dei relatori) può guidare i
sottotitoli. Questo script misura, sulle frasi singole del corpus:

- **richiamo dei termini**: quante occorrenze dei termini del glossario
  presenti nel riferimento compaiono nella trascrizione, senza e con il
  glossario;
- **danno collaterale**: il WER sulle frasi che non contengono nessun
  termine, e quante volte un termine compare dove il riferimento non lo ha.

Due glossari:

- `names`: i nomi propri e le sigle delle frasi stesse (parole maiuscole non
  a inizio frase), come il glossario di un evento che elenca relatori,
  luoghi ed enti di cui si parlerà;
- un file di termini (`--terms`, un termine per riga), per esempio quelli
  dell'amministrazione digitale in `glossary-pa.txt`, che nel corpus non
  compaiono: serve a vedere se un glossario fuori tema fa danni.

Le sessioni girano sul server realtime, la stessa via del servizio, senza
cadenza in tempo reale: l'audio si invia alla velocità che il server
accetta. Un risultato per riga in `<out>/glossary.jsonl`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import time
from pathlib import Path

import websockets

from common import (
    SAMPLE_RATE,
    default_work_dir,
    edit_distance,
    fetch_engine,
    fetch_model,
    host_info,
    log,
    normalize_words,
    read_wav,
)
from paced_load import start_server, stop_server

FRAME_BYTES = SAMPLE_RATE // 50 * 2  # 20 ms


# Dopo questi segni la maiuscola è di inizio frase o di citazione, non di nome.
SENTENCE_OPENERS = {".", "!", "?", ":", ";", "«", '"', "“", "(", "—", "–"}


def proper_nouns(text: str) -> list[str]:
    """Parole maiuscole non a inizio frase e sigle, unite se consecutive."""
    tokens = re.findall(r"[\w'’]+|[^\w\s]", text)
    out: list[str] = []
    run: list[str] = []
    seen_word = False
    for i, tok in enumerate(tokens):
        word = tok.split("'")[-1].split("’")[-1]
        is_word = bool(re.match(r"\w", tok))
        sentence_start = is_word and (not seen_word or tokens[i - 1] in SENTENCE_OPENERS)
        seen_word = seen_word or is_word
        is_name = is_word and word[:1].isupper() and not word.isdigit() and (not sentence_start or word.isupper())
        if is_name and len(word) > 1:
            run.append(word)
        else:
            if run:
                out.append(" ".join(run))
            run = []
    if run:
        out.append(" ".join(run))
    return out


def occurrences(words: list[str], phrase: list[str]) -> int:
    n = len(phrase)
    return sum(1 for i in range(len(words) - n + 1) if words[i : i + n] == phrase) if n else 0


async def transcribe(url: str, pcm: bytes, session: dict) -> str:
    async with websockets.connect(url, max_size=None, open_timeout=60, ping_interval=None) as ws:
        json.loads(await ws.recv())  # session.created
        await ws.send(json.dumps({"type": "session.update", "session": session}))
        ack = json.loads(await ws.recv())
        if ack.get("type") != "session.updated":
            raise RuntimeError(f"session.update rifiutato: {ack}")
        finals: list[str] = []
        done = asyncio.Event()

        async def receive() -> None:
            async for message in ws:
                if not isinstance(message, str):
                    continue
                ev = json.loads(message)
                kind = ev.get("type", "")
                if kind.endswith("transcription.completed"):
                    finals.append(str(ev.get("transcript", "")))
                elif kind == "input_audio_buffer.committed":
                    done.set()
                elif kind == "error":
                    raise RuntimeError(json.dumps(ev)[:300])

        receiver = asyncio.create_task(receive())
        for offset in range(0, len(pcm), FRAME_BYTES):
            await ws.send(pcm[offset : offset + FRAME_BYTES])
        await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
        try:
            await asyncio.wait_for(done.wait(), timeout=120)
            await asyncio.sleep(0.5)
        finally:
            await ws.close()
            receiver.cancel()
        return " ".join(finals)


async def run_condition(
    url: str, items: list[tuple[str, bytes]], session: dict, concurrency: int
) -> dict[str, str]:
    sem = asyncio.Semaphore(concurrency)
    out: dict[str, str] = {}

    async def one(stem: str, pcm: bytes) -> None:
        async with sem:
            out[stem] = await transcribe(url, pcm, session)

    await asyncio.gather(*(one(stem, pcm) for stem, pcm in items))
    return out


def score(refs: dict[str, str], hyps: dict[str, str], terms: list[str]) -> dict[str, object]:
    phrases = [normalize_words(t) for t in terms]
    hits = total = false_terms = 0
    clean_err = clean_words = all_err = all_words = 0
    for stem, ref in refs.items():
        r, h = normalize_words(ref), normalize_words(hyps.get(stem, ""))
        e = edit_distance(r, h)
        all_err += e
        all_words += len(r)
        in_ref = [p for p in phrases if occurrences(r, p)]
        for p in in_ref:
            want = occurrences(r, p)
            total += want
            hits += min(want, occurrences(h, p))
        for p in phrases:
            false_terms += max(0, occurrences(h, p) - occurrences(r, p))
        if not in_ref:
            clean_err += e
            clean_words += len(r)
    return {
        "term_recall": hits / total if total else None,
        "term_occurrences": total,
        "false_term_insertions": false_terms,
        "wer": all_err / all_words if all_words else None,
        "wer_without_terms": clean_err / clean_words if clean_words else None,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work", type=Path, default=default_work_dir())
    ap.add_argument("--out", type=Path, help="cartella dei risultati (default: <work>/results/<data>)")
    ap.add_argument("--terms", type=Path, default=Path(__file__).with_name("glossary-pa.txt"))
    # Sull'italiano i valori "tipici" della documentazione del motore (2-3)
    # scrivono termini mai detti: si parte da valori bassi.
    ap.add_argument("--boost", default="0.5,1,2", help="punteggi da provare (il motore li limita a 5)")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--right-context", type=int, default=3)
    ap.add_argument("--concurrency", type=int, default=4, help="sessioni in parallelo")
    ap.add_argument("--cpus", help="confina il server su queste CPU (sintassi di taskset)")
    ap.add_argument("--port", type=int, default=18090)
    ap.add_argument("--language", default="it-IT")
    args = ap.parse_args()
    args.batching = True

    work: Path = args.work
    engine = fetch_engine(work)
    model = fetch_model(work)
    corpus = work / "corpus"
    meta = json.loads((corpus / "references.json").read_text(encoding="utf-8"))["utterances"]
    refs = {stem: str(m["text"]) for stem, m in meta.items()}
    items = [(stem, read_wav(corpus / "utterances" / f"{stem}.wav")[0].tobytes()) for stem in sorted(refs)]

    names = sorted({n for text in refs.values() for n in proper_nouns(text)})
    external = [t.strip() for t in args.terms.read_text(encoding="utf-8").splitlines() if t.strip() and not t.startswith("#")]
    glossaries = {"names": names, "pa": external}
    log(f"glossario names: {len(names)} voci · glossario pa: {len(external)} voci")

    out: Path = args.out or work / "results" / time.strftime("%Y%m%d-%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    host = host_info(args.cpus)
    url = f"ws://127.0.0.1:{args.port}/v1/audio/transcriptions/realtime"
    base = {"sample_rate": SAMPLE_RATE, "language": args.language}

    conditions: list[tuple[str, float, list[str]]] = [("none", 0.0, [])]
    for boost in (float(b) for b in args.boost.split(",") if b.strip()):
        conditions += [("names", boost, names), ("pa", boost, external)]

    server = start_server(args, engine, model, args.concurrency, out / "logs" / "serve-glossary.log")
    try:
        baseline: dict[str, str] = {}
        for label, boost, terms in conditions:
            session = dict(base)
            if terms:
                session["speech_contexts"] = [{"phrases": terms, "boost": boost}]
            started = time.monotonic()
            hyps = asyncio.run(run_condition(url, items, session, args.concurrency))
            if label == "none":
                baseline = hyps
            # Ogni condizione si confronta con entrambi i glossari: così la
            # riga "none" dà il richiamo di partenza di ciascuno.
            for gname, gterms in glossaries.items():
                if label not in ("none", gname):
                    continue
                row = {
                    "kind": "glossary",
                    "glossary": gname,
                    "applied": label != "none",
                    "boost": boost,
                    "terms": len(gterms),
                    **score(refs, hyps, gterms),
                    "changed_utterances": sum(1 for s in refs if hyps.get(s) != baseline.get(s)),
                    "seconds": time.monotonic() - started,
                    "host": host,
                }
                with (out / "glossary.jsonl").open("a", encoding="utf-8") as f:
                    f.write(json.dumps(row) + "\n")
                log(
                    f"{gname:<5} {'con' if row['applied'] else 'senza'} glossario"
                    f"{f' (boost {boost:g})' if row['applied'] else ''}: richiamo termini "
                    f"{(row['term_recall'] or 0):.0%} su {row['term_occurrences']} · inserzioni spurie "
                    f"{row['false_term_insertions']} · WER {row['wer']:.2%} · WER frasi senza termini "
                    f"{(row['wer_without_terms'] or 0):.2%} · frasi cambiate {row['changed_utterances']}"
                )
            (out / "hyp-glossary").mkdir(exist_ok=True)
            (out / "hyp-glossary" / f"{label}-{boost:g}.json").write_text(json.dumps(hyps, ensure_ascii=False, indent=1))
    finally:
        stop_server(server)
    log(f"risultati in {out}")


if __name__ == "__main__":
    main()
