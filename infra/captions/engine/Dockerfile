# Motore dei sottotitoli live: NeMo-Speech.cpp, build per CPU (Apache-2.0),
# in modalità server (`nemo-speech serve`). Il modello non è nell'immagine:
# lo scarica `fetch-model.sh` all'avvio del pod (initContainer), con revisione
# e impronta fissate, da Hugging Face o da un mirror interno.
#
# Versione e impronta del motore sono fissate qui. Cambiarle è un cambio di
# motore: il banco di prova (infra/captions/bench) va rifatto.
#
# Debian e non Alpine: il binario è compilato per glibc.
FROM mirror.gcr.io/library/debian:bookworm-slim AS fetch

ARG ENGINE_VERSION=0.2.0
ARG ENGINE_SHA256=f396057150f1b774935c7414fd32ebc04195a795a34120d78d8c9ecefa1b7507

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /fetch
RUN curl -fsSL -o engine.tgz \
      "https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v${ENGINE_VERSION}/nemo-speech-${ENGINE_VERSION}-linux-x86_64-cpu.tar.gz" \
    && echo "${ENGINE_SHA256}  engine.tgz" | sha256sum -c - \
    && mkdir engine \
    && tar -xzf engine.tgz -C engine --strip-components=1 \
    && engine/bin/nemo-speech --version

FROM mirror.gcr.io/library/debian:bookworm-slim

# curl serve solo a fetch-model.sh, che gira come initContainer con la stessa immagine.
# /models appartiene all'utente del motore: un volume con nome montato lì
# (Docker Compose) ne eredita il proprietario e fetch-model.sh può scriverci.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --system --no-create-home --shell /usr/sbin/nologin engine \
    && mkdir /models \
    && chown 10001:10001 /models

COPY --from=fetch /fetch/engine /opt/nemo-speech
COPY fetch-model.sh /usr/local/bin/fetch-model.sh

USER 10001
ENV HOME=/tmp \
    CAPTIONS_MODEL_PATH=/models/asr.gguf

EXPOSE 8090
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/nemo-speech/bin/nemo-speech", "serve"]
CMD ["--asr-model", "/models/asr.gguf", "--device", "cpu", "--host", "127.0.0.1", "--port", "8090", "--no-ui"]
