# Live captions: CPU benchmark

This folder measures whether live captions can run on CPU, and how much CPU
they need, before the captions service is built. It drives the streaming
speech recognition engine that the service would use, on the same audio
cadence the video bridge produces, and reports how many people speaking at
the same time a given CPU budget can caption without falling behind.

The engine is [NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp)
(Apache-2.0) with the multilingual
[Nemotron 3.5 ASR Streaming 0.6B](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b)
model (OpenMDW-1.1) in its 8-bit GGUF form. Speech comes from the Italian
test split of [FLEURS](https://huggingface.co/datasets/google/fleurs)
(CC-BY-4.0). Nothing is redistributed: the scripts download the engine, the
model and the dataset at pinned versions and check their SHA-256, all in
`common.py`. Everything runs locally; no audio leaves the machine.

## What is measured

| Script | Question it answers |
|---|---|
| `prepare.py` | Builds the corpus: single sentences, and one long track per simulated speaker (sentences joined with short pauses, leading and trailing silence trimmed). |
| `engine_sweep.py` | Cost of one audio chunk and aggregate throughput at full speed, for each thread count and chunk size, plus word error rate (WER) on the single sentences. |
| `paced_load.py` | The sizing test. Starts the engine's realtime WebSocket server and opens N sessions that send audio at real-time pace in 20 ms frames, like the bridge forwards Opus. Measures processing delay, delay of the first word of each sentence, drift over time, server CPU and memory, and WER. |
| `glossary_check.py` | Effect of a glossary on the transcript, through the engine's word boosting, at several strengths: recall of the glossary terms, WER on the sentences that contain none of them, and glossary terms written where they were not said. One glossary is the names in the sentences themselves; the other, `glossary-pa.txt`, is off topic on purpose. |
| `report.py` | Turns a results folder into Markdown tables with a verdict per point. |
| `run.sh` | Runs the whole suite for one or more CPU budgets. |

The chunk size is the model's algorithmic latency: 80, 160, 320, 560 or
1120 ms, selected with the right context (`--right-context` 0, 1, 3, 6 or
13). Smaller chunks give earlier captions and slightly higher WER, and cost
more CPU per second of audio.

How to read the real-time test:

- **Processing delay** is the time between sending a piece of audio and
  receiving the event that reports it as processed. It adds to the chunk
  latency. A point *holds* when its p95 stays at or below 0.5 s and does not
  grow during the run (drift at or below 0.25 s).
- **First word** is how long after a sentence starts its first word reaches
  the client: what a viewer perceives.
- **Server cores** is the CPU the server really used, which is what a pod's
  CPU request has to cover.

WER is computed after lowercasing and removing punctuation, without number
normalization, so it reads somewhat higher than published figures. FLEURS is
read speech: spontaneous speech in a meeting is harder, so treat WER as a
comparison between settings, not as the quality viewers will see.

## Run it locally

Requirements: Linux x86_64, Python 3.11 or later, `taskset` (util-linux),
about 2 GB of disk for downloads and corpus.

```bash
cd infra/captions/bench
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
BENCH_PYTHON=.venv/bin/python ./run.sh                       # quick profile
BENCH_PYTHON=.venv/bin/python BENCH_PROFILE=full ./run.sh    # full profile
```

Results go to `work/results/<timestamp>-<profile>/`, with `REPORT.md` and
the raw JSON lines. `BENCH_WORK` moves the working folder.

A cloud vCPU is one hardware thread, not a core. To simulate the budget a
node would leave to the captions service, confine the run to sibling
threads with `BENCH_BUDGETS`, in the form `<vcpu>:<cpuset>`:

```bash
# which threads are siblings
cat /sys/devices/system/cpu/cpu8/topology/thread_siblings_list   # e.g. 8,20
BENCH_BUDGETS="2:8,20 4:8,9,20,21 8:8-11,20-23" BENCH_PROFILE=full ./run.sh
```

On a workstation the result is optimistic: desktop cores clock higher than
cloud vCPUs, and other processes on the same machine add noise (each result
records the load average, so noisy points can be spotted). Use the local run
to choose settings, and the cluster run to size.

## Run it in the cluster

`job.example.yaml` runs the same suite as a Kubernetes Job on a bridge
node, with the CPU budget set by the container's limit. It uses the stock
Python image and takes the scripts from a ConfigMap; see the comments in the
file for the commands and the precautions (the pool scales from zero, and
the run must not share the node with a live event).

## Unit tests

```bash
.venv/bin/pip install pytest && .venv/bin/python -m pytest -q
```
