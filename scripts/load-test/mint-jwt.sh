#!/bin/sh
# Mint a Jitsi JWT using openssl + jq. Produces a token compatible with
# Prosody's JWT module in pa-webinar (same iss/aud/sub layout as app/src/lib/auth/jwt.ts).
#
# Required env vars:
#   JITSI_JWT_SECRET    HS256 shared secret configured on Prosody
#   JITSI_JWT_ISSUER    iss claim (e.g. "pa-webinar")
#   JITSI_JWT_AUDIENCE  aud claim (e.g. "jitsi")
#   JITSI_JWT_SUBJECT   sub claim (Jitsi domain, e.g. "jitsi-test.innovazione.gov.it")
#
# Optional:
#   BOT_NAME            participant display name (default: LoadBot)
#   JWT_TTL_SECONDS     token lifetime in seconds (default: 7200)
#
# Output: writes the signed JWT to $1 (or stdout if no arg)
set -eu

: "${JITSI_JWT_SECRET:?JITSI_JWT_SECRET required}"
: "${JITSI_JWT_ISSUER:?JITSI_JWT_ISSUER required}"
: "${JITSI_JWT_AUDIENCE:?JITSI_JWT_AUDIENCE required}"
: "${JITSI_JWT_SUBJECT:?JITSI_JWT_SUBJECT required}"

BOT_NAME="${BOT_NAME:-LoadBot}"
JWT_TTL_SECONDS="${JWT_TTL_SECONDS:-7200}"
JITSI_JWT_APP_ID="${JITSI_JWT_APP_ID:-pa_webinar}"

# Unique user id per token (not shared across bots — avoids JID collisions)
USER_ID=$(openssl rand -hex 8)

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

now=$(date +%s)
exp=$((now + JWT_TTL_SECONDS))
header='{"alg":"HS256","typ":"JWT"}'

# room="*" wildcard — necessario perché Malleus appende un suffisso numerico
# al room_name_prefix (es. load-test-room → load-test-room0) e una claim puntuale
# non matcherebbe mai il MUC effettivo.
payload=$(jq -cn \
  --arg name "$BOT_NAME" \
  --arg uid "$USER_ID" \
  --arg jti "${JITSI_JWT_APP_ID}:${USER_ID}" \
  --arg iss "$JITSI_JWT_ISSUER" \
  --arg aud "$JITSI_JWT_AUDIENCE" \
  --arg sub "$JITSI_JWT_SUBJECT" \
  --argjson iat "$now" \
  --argjson exp "$exp" \
  '{
    context: {
      user: {
        id: $uid,
        name: $name,
        moderator: "true",
        affiliation: "owner"
      },
      features: {
        recording: "true",
        livestreaming: "true",
        "screen-sharing": "true",
        "outbound-call": "true"
      }
    },
    moderator: true,
    affiliation: "owner",
    room: "*",
    iss: $iss,
    aud: $aud,
    sub: $sub,
    jti: $jti,
    iat: $iat,
    exp: $exp
  }')

h64=$(printf '%s' "$header"  | b64url)
p64=$(printf '%s' "$payload" | b64url)
sig=$(printf '%s.%s' "$h64" "$p64" \
      | openssl dgst -sha256 -hmac "$JITSI_JWT_SECRET" -binary | b64url)

token="${h64}.${p64}.${sig}"

if [ "${1:-}" = "" ]; then
  printf '%s\n' "$token"
else
  printf '%s' "$token" > "$1"
fi
