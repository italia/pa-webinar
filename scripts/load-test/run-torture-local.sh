#!/bin/bash
# Entrypoint del container eventi-dtd-load-test.
# Conia un JWT, lancia Malleus Jitsificus con i parametri passati via env.
#
# Env richieste:
#   JITSI_URL               URL pubblico Jitsi (es. https://jitsi-test.innovazione.gov.it)
#   JITSI_JWT_SECRET        secret HS256 (dallo stesso deploy Jitsi che stai testando)
#   JITSI_JWT_SUBJECT       sub claim (il Jitsi domain)
#
# Env opzionali (default tra parentesi):
#   JITSI_JWT_ISSUER        (eventi-dtd)
#   JITSI_JWT_AUDIENCE      (jitsi)
#   JITSI_ROOM              (load-test-room)
#   PARTICIPANTS            (20)
#   SENDERS                 (2)
#   DURATION                (300)
#   USE_LOAD_TEST           (false — se true, bypassa media plane, abilita multiplexing)
#   RECEIVERS_PER_TAB       (1)
#   SENDERS_PER_TAB         (1)
#   RECEIVER_TABS_PER_BROWSER (1)
#   SENDER_TABS_PER_BROWSER   (1)
set -euo pipefail

: "${JITSI_URL:?JITSI_URL required (e.g. https://jitsi-test.innovazione.gov.it)}"
: "${JITSI_JWT_SECRET:?JITSI_JWT_SECRET required}"
: "${JITSI_JWT_SUBJECT:?JITSI_JWT_SUBJECT required}"

export JITSI_JWT_ISSUER="${JITSI_JWT_ISSUER:-eventi-dtd}"
export JITSI_JWT_AUDIENCE="${JITSI_JWT_AUDIENCE:-jitsi}"

JITSI_ROOM="${JITSI_ROOM:-load-test-room}"
PARTICIPANTS="${PARTICIPANTS:-20}"
SENDERS="${SENDERS:-2}"
DURATION="${DURATION:-300}"
USE_LOAD_TEST="${USE_LOAD_TEST:-false}"
RECEIVERS_PER_TAB="${RECEIVERS_PER_TAB:-1}"
SENDERS_PER_TAB="${SENDERS_PER_TAB:-1}"
RECEIVER_TABS_PER_BROWSER="${RECEIVER_TABS_PER_BROWSER:-1}"
SENDER_TABS_PER_BROWSER="${SENDER_TABS_PER_BROWSER:-1}"

echo "==> minting JWT"
JWT=$(/usr/local/bin/mint-jwt.sh)
echo "==> JWT minted ($(printf '%s' "$JWT" | wc -c) bytes)"

cd /torture

echo "==> target=$JITSI_URL room=$JITSI_ROOM participants=$PARTICIPANTS senders=$SENDERS duration=${DURATION}s use_load_test=$USE_LOAD_TEST"

xvfb-run -a --server-args="-screen 0 1280x720x24" \
mvn -q test \
  -Djitsi-meet.instance.url="$JITSI_URL" \
  -Djitsi-meet.tests.toRun=MalleusJitsificus \
  -Dorg.jitsi.malleus.conferences=1 \
  -Dorg.jitsi.malleus.participants="$PARTICIPANTS" \
  -Dorg.jitsi.malleus.senders="$SENDERS" \
  -Dorg.jitsi.malleus.audio_senders="$SENDERS" \
  -Dorg.jitsi.malleus.duration="$DURATION" \
  -Dorg.jitsi.malleus.join_delay=1000 \
  -Dorg.jitsi.malleus.max_disrupted_bridges_pct=0 \
  -Dorg.jitsi.malleus.room_name_prefix="$JITSI_ROOM" \
  -Dorg.jitsi.malleus.extra_sender_params="jwt=$JWT&config.startWithAudioMuted=false&config.startWithVideoMuted=false&config.startAudioMuted=99999&config.startVideoMuted=99999" \
  -Dorg.jitsi.malleus.extra_receiver_params="jwt=$JWT&config.startAudioMuted=99999&config.startVideoMuted=99999" \
  -Dorg.jitsi.malleus.use_load_test="$USE_LOAD_TEST" \
  -Dorg.jitsi.malleus.receivers_per_tab="$RECEIVERS_PER_TAB" \
  -Dorg.jitsi.malleus.senders_per_tab="$SENDERS_PER_TAB" \
  -Dorg.jitsi.malleus.receiver_tabs_per_browser="$RECEIVER_TABS_PER_BROWSER" \
  -Dorg.jitsi.malleus.sender_tabs_per_browser="$SENDER_TABS_PER_BROWSER" \
  -Dchrome.binary.path=/usr/bin/google-chrome-stable \
  -Dwebdriver.chrome.driver=/usr/bin/chromedriver \
  -Dchrome.disable.sandbox=true \
  -Dallow.insecure.certs=true \
  -Dorg.jitsi.malleus.set.saveLogs="${SAVE_LOGS:-false}"
