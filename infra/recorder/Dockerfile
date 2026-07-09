# Multitrack recorder (ADR-013, Fase 3).
# Headless-Chrome bot che registra una traccia audio per partecipante.
#
# Approccio (vedi README): Puppeteer + Chrome headless con lo stesso stack
# WebRTC che gira in produzione, come fa Jibri. Serve quindi Chrome + le
# sue librerie di sistema.
#
# ── Stage 1: build TypeScript → dist/ ────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Puppeteer scarica il Chrome compatibile durante l'install: lo dirigiamo in
# /app/.cache così lo stage runtime può copiarlo (default sarebbe ~/.cache).
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Pruna le devDependencies per lo stage runtime.
RUN npm prune --omit=dev

# ── Stage 2: runtime con Chrome ──────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Dipendenze di sistema per Chrome headless (allineate alla doc Puppeteer).
# + pulseaudio/pulseaudio-utils: forniscono un sink audio VIRTUALE così l'ADM
#   WebRTC di Chrome headless esegue il thread di playout e DECODIFICA l'audio
#   remoto (vedi entrypoint.sh + il fix <audio> in capture.ts). Senza device
#   audio la cattura remota risulta silenziosa (-91 dB).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \
      libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 \
      libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
      libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 \
      pulseaudio pulseaudio-utils \
      wget xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer scarica il Chrome compatibile durante `npm install`; copiamo la
# cache insieme a node_modules.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
COPY --from=build /app/.cache/puppeteer ./.cache/puppeteer
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Le tracce intermedie vivono qui prima dell'upload (volume effimero:
# minimizzazione GDPR — vanno cancellate dopo la trascrizione).
ENV OUTPUT_DIR=/recordings
RUN mkdir -p /recordings

# HOME/XDG_RUNTIME_DIR su path uid-agnostici e scrivibili: il chart gira il pod
# con runAsUser 1000 (≠ uid 10001 dell'immagine), quindi /home/recorder non
# sarebbe scrivibile. /tmp lo è per qualsiasi uid → PulseAudio (entrypoint) può
# partire senza privilegi.
ENV HOME=/tmp
ENV XDG_RUNTIME_DIR=/tmp/xdg-runtime

# Entrypoint: avvia (best-effort) il sink audio virtuale, poi esegue il recorder.
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod 0755 /app/entrypoint.sh

# Utente non-root (best practice; Chrome gira con --no-sandbox in container).
RUN useradd -m -u 10001 recorder && chown -R recorder:recorder /app /recordings
USER recorder

ENTRYPOINT ["/app/entrypoint.sh"]
