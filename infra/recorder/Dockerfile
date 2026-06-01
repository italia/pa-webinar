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

COPY package.json ./
# Nessun lockfile committato in questa fase iniziale: install best-effort.
# In CI sostituire con `npm ci` una volta generato il package-lock.json.
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Pruna le devDependencies per lo stage runtime.
RUN npm prune --omit=dev

# ── Stage 2: runtime con Chrome ──────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Dipendenze di sistema per Chrome headless (allineate alla doc Puppeteer).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \
      libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 \
      libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
      libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 \
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

# Utente non-root (best practice; Chrome gira con --no-sandbox in container).
RUN useradd -m -u 10001 recorder && chown -R recorder:recorder /app /recordings
USER recorder

ENTRYPOINT ["node", "dist/index.js"]
