#!/usr/bin/env bash
# Wrapper per lanciare il container di load test in locale con podman o docker.
#
# Richiede:
#   - podman o docker installato
#   - l'immagine `pa-webinar-load-test` già built
#       (altrimenti build automatico al primo run con --build)
#
# Uso:
#   JITSI_URL=https://jitsi-test.innovazione.gov.it \
#   JITSI_JWT_SECRET=<secret> \
#   JITSI_JWT_SUBJECT=jitsi-test.innovazione.gov.it \
#   PARTICIPANTS=50 SENDERS=5 DURATION=300 \
#     ./run-local.sh [--build]
#
# Per webinar (300 ricevitori in load-test mode):
#   USE_LOAD_TEST=true RECEIVERS_PER_TAB=25 PARTICIPANTS=300 SENDERS=2 \
#     ./run-local.sh
#
# Per video-call con media reale (fino a ~200 bot su 128 GB / 24 core):
#   USE_LOAD_TEST=false PARTICIPANTS=150 SENDERS=3 \
#     ./run-local.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${IMAGE:-pa-webinar-load-test}"

# Scegli runtime (podman preferito, docker fallback)
if command -v podman >/dev/null 2>&1; then
  RUNTIME=podman
elif command -v docker >/dev/null 2>&1; then
  RUNTIME=docker
else
  echo "error: need podman or docker installed" >&2
  exit 1
fi

# Optional build
if [[ "${1:-}" == "--build" ]] || ! "$RUNTIME" image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "==> building $IMAGE with $RUNTIME"
  "$RUNTIME" build -t "$IMAGE" "$SCRIPT_DIR"
fi

: "${JITSI_URL:?JITSI_URL required (e.g. https://jitsi-test.innovazione.gov.it)}"
: "${JITSI_JWT_SECRET:?JITSI_JWT_SECRET required (HS256 secret from the Jitsi deploy)}"
: "${JITSI_JWT_SUBJECT:?JITSI_JWT_SUBJECT required (Jitsi domain, e.g. jitsi-test.innovazione.gov.it)}"

# Sulle macchine beefy (64+ GB, 16+ core) vale la pena alzare --shm-size per
# far respirare i tanti Chrome
SHM_SIZE="${SHM_SIZE:-4g}"

echo "==> running $IMAGE via $RUNTIME"
exec "$RUNTIME" run --rm -it \
  --shm-size="$SHM_SIZE" \
  -e JITSI_URL \
  -e JITSI_JWT_SECRET \
  -e JITSI_JWT_SUBJECT \
  -e JITSI_JWT_ISSUER \
  -e JITSI_JWT_AUDIENCE \
  -e JITSI_ROOM \
  -e PARTICIPANTS \
  -e SENDERS \
  -e DURATION \
  -e USE_LOAD_TEST \
  -e RECEIVERS_PER_TAB \
  -e SENDERS_PER_TAB \
  -e RECEIVER_TABS_PER_BROWSER \
  -e SENDER_TABS_PER_BROWSER \
  -e BOT_NAME \
  "$IMAGE"
