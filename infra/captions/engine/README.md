# Live captions engine

The engine of the [live captions](../../../docs/architecture/live-captions.md) service: [NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp) (Apache-2.0) in server mode, CPU build, running the multilingual Nemotron 3.5 ASR Streaming 0.6B model in 8-bit weights. It listens on the pod's loopback only; the [gateway](../gateway/README.md) next to it is its only client.

## The image

The `Dockerfile` downloads the engine's release at a pinned version, checks its SHA-256 and copies it onto `debian:bookworm-slim` (the binary needs glibc). Changing the version or the checksum changes the engine: run the [benchmark](../bench/README.md) again before relying on it.

The model is **not** in the image. `fetch-model.sh`, run by the chart as an init container from the same image, downloads it into a volume and checks its SHA-256; a wrong checksum stops the pod. The URL can point to Hugging Face at a pinned revision (the default) or to a mirror inside the installation; the license terms of the model are recorded in [THIRD-PARTY-LICENSES.md](../../../THIRD-PARTY-LICENSES.md#live-captions-model).

| Variable | Used by | Meaning |
|---|---|---|
| `CAPTIONS_MODEL_URL` | `fetch-model.sh` | Where to download the model from |
| `CAPTIONS_MODEL_SHA256` | `fetch-model.sh` | Expected checksum |
| `CAPTIONS_MODEL_PATH` | `fetch-model.sh` | Where to write it (`/models/asr.gguf`) |

The server's options (threads, chunk size, concurrent sessions) are passed by the chart as arguments; see `templates/captions.yaml` and the `captions.engine` values.

## Sizing

How many people speaking at once a CPU budget can caption is measured by [`../bench`](../bench/README.md), locally or as a Job on the cluster's node type. The results and the defaults that follow from them are in [Live captions: sizing](../../../docs/architecture/live-captions.md#sizing-and-placement).
