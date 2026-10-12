# Gateway dei sottotitoli live: riceve dal bridge l'audio di chi parla, lo
# passa al motore (sidecar sullo stesso pod) e rimanda il testo. Nessun
# modello qui dentro: solo Node e il decodificatore Opus (WebAssembly).

# ── Stage 1: build TypeScript → dist/ ────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev

# ── Stage 2: runtime ─────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
# Come l'immagine del portale: pacchetti di sistema aggiornati, e niente npm,
# che a runtime non serve e porta con sé dipendenze vulnerabili.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Utente `node` (uid 1000) dell'immagine base, lo stesso del securityContext
# del chart.
USER node
EXPOSE 8080
ENTRYPOINT ["node", "dist/index.js"]
