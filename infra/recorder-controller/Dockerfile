# Recorder controller (ADR-013, Fase 3).
# Operator riconciliante: pod fisso che crea/elimina i Job recorder.
# Immagine leggera — NESSUN Chrome/puppeteer (a differenza del recorder):
# parla solo l'API Kubernetes + HTTP al portale.

# ── Stage 1: build TypeScript → dist/ ────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: runtime ─────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY --from=build /app/dist ./dist

# Non-root (coerente coi securityContext del chart).
USER node
ENTRYPOINT ["node", "dist/index.js"]
