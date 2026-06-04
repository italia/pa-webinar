# ─────────────────────────────────────────────────────────────
# pa-webinar — Production Dockerfile
# Multi-stage build: deps → builder → runner
# ─────────────────────────────────────────────────────────────

# Base image is pulled from Google's public mirror of Docker Hub so
# CI runners don't hit the anonymous-pull rate limit (the shared ARC
# runner exhausts the 100-per-6h Docker Hub quota during a single
# busy day). The mirror is content-addressable and serves the exact
# same digests as docker.io/library — overridable at build time:
#   docker build --build-arg NODE_BASE=node:20-alpine .
ARG NODE_BASE=mirror.gcr.io/library/node:20-alpine

# ── Stage 1: Dependencies ────────────────────────────────────
FROM ${NODE_BASE} AS deps

LABEL maintainer="Dipartimento per la Trasformazione Digitale <innovazione@governo.it>"
LABEL org.opencontainers.image.title="pa-webinar"
LABEL org.opencontainers.image.description="Public digital event platform for the Italian DTD"
LABEL org.opencontainers.image.source="https://github.com/italia/pa-webinar"

RUN apk add --no-cache libc6-compat

WORKDIR /workspace

# Copy workspace root config and app package.json for npm ci
COPY package.json package-lock.json ./
COPY app/package.json ./app/

RUN npm ci --ignore-scripts && npm cache clean --force

# Copy app config files needed by both build and dev mode
COPY app/tsconfig.json app/next.config.ts app/next-env.d.ts ./app/
COPY app/eslint.config.mjs ./app/

# Generate Prisma client (needs schema + prisma CLI from devDeps)
COPY app/prisma ./app/prisma
RUN cd app && npx prisma generate


# ── Stage 2: Builder ─────────────────────────────────────────
FROM ${NODE_BASE} AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /workspace

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* are inlined by webpack at build time. These defaults produce a
# generic image; the app reads actual values at runtime via lib/env.ts (bracket
# notation bypasses DefinePlugin). Client components receive values as props
# from Server Components. Override at build time with --build-arg if needed.
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_JITSI_DOMAIN=localhost:8443
ARG NEXT_PUBLIC_WATERMARK_URL=/images/dtd-watermark.svg
ARG NEXT_PUBLIC_DEFAULT_LOCALE=it
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_JITSI_DOMAIN=$NEXT_PUBLIC_JITSI_DOMAIN
ENV NEXT_PUBLIC_WATERMARK_URL=$NEXT_PUBLIC_WATERMARK_URL
ENV NEXT_PUBLIC_DEFAULT_LOCALE=$NEXT_PUBLIC_DEFAULT_LOCALE

# Build identity — inlined by webpack so the footer can render version + sha.
# BUILD_CHANNEL is `dev` for rolling :dev builds and `release` for tagged v*
# pushes; the footer uses it to pick between commit link and release link.
ARG NEXT_PUBLIC_BUILD_VERSION=dev
ARG NEXT_PUBLIC_BUILD_SHA=
ARG NEXT_PUBLIC_BUILD_CHANNEL=dev
ARG NEXT_PUBLIC_BUILD_DATE=
ENV NEXT_PUBLIC_BUILD_VERSION=$NEXT_PUBLIC_BUILD_VERSION
ENV NEXT_PUBLIC_BUILD_SHA=$NEXT_PUBLIC_BUILD_SHA
ENV NEXT_PUBLIC_BUILD_CHANNEL=$NEXT_PUBLIC_BUILD_CHANNEL
ENV NEXT_PUBLIC_BUILD_DATE=$NEXT_PUBLIC_BUILD_DATE

# Copy installed deps from stage 1
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/package.json ./

# Copy full app source
COPY app/ ./app/

WORKDIR /workspace/app

# Copy Bootstrap Italia SVG sprite to public — needed by design-react-kit <Icon>
# Deps are hoisted to workspace root (/workspace/node_modules)
RUN mkdir -p public/svg && \
    cp /workspace/node_modules/bootstrap-italia/dist/svg/sprites.svg public/svg/sprites.svg

RUN npm run build

# Clean standalone output: remove .env files and build-only traced packages
RUN find .next/standalone -name '.env*' -type f -delete && \
    cd .next/standalone && \
    rm -rf node_modules/typescript \
           node_modules/sass \
           node_modules/caniuse-lite


# ── Stage 3: Production runner ───────────────────────────────
FROM ${NODE_BASE} AS runner

RUN apk upgrade --no-cache && apk add --no-cache tini && \
    npm cache clean --force && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

# Copy cleaned standalone server output
COPY --from=builder --chown=nextjs:nodejs /workspace/app/.next/standalone ./

# Copy static assets (not included in standalone)
COPY --from=builder --chown=nextjs:nodejs /workspace/app/.next/static ./app/.next/static
COPY --from=builder --chown=nextjs:nodejs /workspace/app/public ./app/public

# Copy entrypoint
COPY --chown=nextjs:nodejs scripts/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "app/server.js"]
