#!/usr/bin/env bash
# Run jitsi-meet-torture against an pa-webinar deployment.
#
# Wraps Maven invocation of the Malleus Jitsificus scenario with
# sensible defaults for this project. Supports three access modes:
#
#   1. public    — hit the live Jitsi hostname directly (only if the
#                  public ingress exposes room pages + signaling paths).
#   2. forward   — port-forward the in-cluster Jitsi web service to
#                  localhost, then point the test at https://localhost:8443.
#   3. in-cluster — run the test itself as a Kubernetes Job alongside
#                   Jitsi, hitting the ClusterIP service directly.
#                   See k8s-job.yaml.
#
# Required env vars:
#   JITSI_URL                e.g. https://jitsi.example.com or https://localhost:8443
#   JITSI_ROOM               room name to join (must match JWT "room" claim)
#   JITSI_JWT                signed JWT string (use mint-jwt.mjs)
#
# Optional env vars:
#   PARTICIPANTS             total bots to spawn           (default: 50)
#   SENDERS                  bots that publish audio+video (default: 2)
#   DURATION                 seconds the conference runs   (default: 300)
#   TORTURE_DIR              local checkout of jitsi-meet-torture
#                            (default: ./.cache/jitsi-meet-torture)
#   GRID_URL                 Selenium hub URL for remote browsers
#                            (default: empty = local chromedriver)
#
# Example:
#   export JITSI_URL=https://jitsi.example.com
#   export JITSI_ROOM=load-test-$(date +%s)
#   export JITSI_JWT=$(node mint-jwt.mjs --room "$JITSI_ROOM" --name Bot)
#   PARTICIPANTS=100 SENDERS=5 DURATION=600 ./run-torture.sh

set -euo pipefail

: "${JITSI_URL:?JITSI_URL is required}"
: "${JITSI_ROOM:?JITSI_ROOM is required}"
: "${JITSI_JWT:?JITSI_JWT is required}"

PARTICIPANTS="${PARTICIPANTS:-50}"
SENDERS="${SENDERS:-2}"
DURATION="${DURATION:-300}"
TORTURE_DIR="${TORTURE_DIR:-$(pwd)/.cache/jitsi-meet-torture}"
GRID_URL="${GRID_URL:-}"

if [[ ! -d "$TORTURE_DIR" ]]; then
  echo "==> cloning jitsi-meet-torture into $TORTURE_DIR"
  mkdir -p "$(dirname "$TORTURE_DIR")"
  git clone --depth=1 https://github.com/jitsi/jitsi-meet-torture.git "$TORTURE_DIR"
fi

cd "$TORTURE_DIR"

# Property names mirror upstream scripts/malleus.sh EXACTLY. Gotchas learned
# the hard way (7 lug):
#   * The JWT is passed via -Dorg.jitsi.token (NOT -Dorg.jitsi.malleus.jwt,
#     which does not exist). prosody enforces token auth (allow_empty_token=
#     false) so a missing/invalid JWT makes the jitsi client fail client-side
#     before it ever opens the signaling stream -> zero prosody connections.
#   * Every property is prefixed org.jitsi.malleus.* and uses audio_senders /
#     room_name_prefix. MalleusJitsificus.createData parses the numeric ones
#     with NO null-guard, so ALL must be present (NumberFormatException otherwise).
#   * duration is in SECONDS (do not multiply by 1000).
MVN_ARGS=(
  -Dthreadcount=1
  -Djitsi-meet.instance.url="$JITSI_URL"
  -Djitsi-meet.tests.toRun=MalleusJitsificus
  -Dorg.jitsi.malleus.conferences=1
  -Dorg.jitsi.malleus.max_disrupted_bridges_pct=0
  -Dorg.jitsi.malleus.participants="$PARTICIPANTS"
  -Dorg.jitsi.malleus.senders="$SENDERS"
  -Dorg.jitsi.malleus.audio_senders="$SENDERS"
  -Dorg.jitsi.malleus.duration="$DURATION"
  -Dorg.jitsi.malleus.join_delay=0
  -Dorg.jitsi.malleus.room_name_prefix="$JITSI_ROOM"
  -Dorg.jitsi.malleus.regions=
  -Dorg.jitsi.malleus.use_node_types=false
  -Dorg.jitsi.malleus.sender_tabs_per_browser=1
  -Dorg.jitsi.malleus.receiver_tabs_per_browser=1
  -Dorg.jitsi.malleus.senders_per_tab=1
  -Dorg.jitsi.malleus.receivers_per_tab=1
  -Dorg.jitsi.malleus.use_load_test=false
  -Dorg.jitsi.malleus.use_lite_mode=false
  -Dorg.jitsi.malleus.switch_speakers=false
  -Dorg.jitsi.malleus.use_stage_view=false
  -Dorg.jitsi.malleus.enable.headless=true
  -Dorg.jitsi.malleus.set.saveLogs=false
  -Dorg.jitsi.token="$JITSI_JWT"
  -Dchrome.disable.nosanbox=true
)

if [[ -n "$GRID_URL" ]]; then
  MVN_ARGS+=(-Dremote.address="$GRID_URL" -Dremote.resource.path=/)
fi

echo "==> starting Malleus: $PARTICIPANTS participants ($SENDERS senders), duration ${DURATION}s"
echo "==> target: $JITSI_URL/$JITSI_ROOM"

mvn test "${MVN_ARGS[@]}"
