#!/bin/bash
# Verify that Jitsi roles are correctly enforced end-to-end.
#
# This script creates a test event, generates moderator and participant JWTs,
# decodes them, verifies role fields, and cleans up.
#
# Prerequisites: curl, jq, base64
# Usage: ./scripts/verify-jitsi-roles.sh [base-url] [admin-api-key]

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
ADMIN_KEY="${2:-dev_admin_key_2026}"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
PASS=true

fail() { echo -e "${RED}FAIL${NC}: $1"; PASS=false; }
ok()   { echo -e "${GREEN}  OK${NC}: $1"; }

echo "================================================"
echo "  Jitsi Role Verification — $BASE_URL"
echo "================================================"
echo ""

# ── Step 1: Authenticate as admin ─────────────────────────────
echo "=== Step 1: Authenticate as admin ==="
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/admin/login" \
  -H 'Content-Type: application/json' \
  -d "{\"apiKey\": \"$ADMIN_KEY\"}")

ADMIN_COOKIE=$(curl -s -D - -o /dev/null -X POST "$BASE_URL/api/admin/login" \
  -H 'Content-Type: application/json' \
  -d "{\"apiKey\": \"$ADMIN_KEY\"}" 2>/dev/null | grep -i 'set-cookie' | head -1 | sed 's/[Ss]et-[Cc]ookie: //' | cut -d';' -f1)

if [ -z "$ADMIN_COOKIE" ]; then
  echo "ERROR: Failed to authenticate as admin. Check ADMIN_API_KEY."
  exit 1
fi
echo "Authenticated (cookie obtained)"

# ── Step 2: Create test event ─────────────────────────────────
echo ""
echo "=== Step 2: Create test event ==="

STARTS_AT=$(date -u -d '+5 minutes' '+%Y-%m-%dT%H:%M:%S.000Z' 2>/dev/null || date -u -v+5M '+%Y-%m-%dT%H:%M:%S.000Z')
ENDS_AT=$(date -u -d '+65 minutes' '+%Y-%m-%dT%H:%M:%S.000Z' 2>/dev/null || date -u -v+65M '+%Y-%m-%dT%H:%M:%S.000Z')

EVENT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/events" \
  -H 'Content-Type: application/json' \
  -H "Cookie: $ADMIN_COOKIE" \
  -d "{
    \"titleIt\": \"Test Verifica Ruoli Jitsi\",
    \"titleEn\": \"Jitsi Role Verification Test\",
    \"descriptionIt\": \"Test automatico per verifica ruoli JWT\",
    \"descriptionEn\": \"Automated JWT role verification test\",
    \"startsAt\": \"$STARTS_AT\",
    \"endsAt\": \"$ENDS_AT\",
    \"maxParticipants\": 10,
    \"moderatorName\": \"Test Moderator\",
    \"moderatorEmail\": \"test@example.com\"
  }")

SLUG=$(echo "$EVENT_RESPONSE" | jq -r '.slug')
EVENT_ID=$(echo "$EVENT_RESPONSE" | jq -r '.id')
MOD_TOKEN=$(echo "$EVENT_RESPONSE" | jq -r '.moderatorToken')

if [ "$SLUG" = "null" ] || [ -z "$SLUG" ]; then
  echo "ERROR: Failed to create event"
  echo "$EVENT_RESPONSE" | jq .
  exit 1
fi

echo "Event created: $SLUG (ID: $EVENT_ID)"

# ── Step 3: Publish the event ─────────────────────────────────
echo ""
echo "=== Step 3: Publish event ==="
curl -s -X PUT "$BASE_URL/api/events/$EVENT_ID?token=$MOD_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status": "PUBLISHED"}' | jq '{status}'

# ── Step 4: Set event to LIVE ─────────────────────────────────
echo ""
echo "=== Step 4: Set event LIVE ==="
curl -s -X PUT "$BASE_URL/api/events/$EVENT_ID?token=$MOD_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status": "LIVE"}' | jq '{status}'

# ── Step 5: Register a participant ────────────────────────────
echo ""
echo "=== Step 5: Register participant ==="
REG_RESPONSE=$(curl -s -X POST "$BASE_URL/api/events/$SLUG/registrations" \
  -H 'Content-Type: application/json' \
  -d '{
    "displayName": "Test Participant",
    "email": "test-role-verify@example.com",
    "consentGiven": true
  }')

ACCESS_TOKEN=$(echo "$REG_RESPONSE" | jq -r '.accessToken')

if [ "$ACCESS_TOKEN" = "null" ] || [ -z "$ACCESS_TOKEN" ]; then
  echo "ERROR: Failed to register participant"
  echo "$REG_RESPONSE" | jq .
  # Cleanup before exiting
  curl -s -X DELETE "$BASE_URL/api/events/$EVENT_ID?token=$MOD_TOKEN" > /dev/null
  exit 1
fi

echo "Registered with access token: ${ACCESS_TOKEN:0:8}..."

# ── Step 6: Generate moderator JWT ────────────────────────────
echo ""
echo "=== Step 6: Moderator JWT ==="
MOD_JWT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/events/$SLUG/jitsi/token" \
  -H 'Content-Type: application/json' \
  -d "{\"moderatorToken\": \"$MOD_TOKEN\"}")

MOD_JWT=$(echo "$MOD_JWT_RESPONSE" | jq -r '.jwt')
MOD_ROLE=$(echo "$MOD_JWT_RESPONSE" | jq -r '.role')

# Decode JWT payload (handle both GNU and BSD base64)
decode_jwt_payload() {
  local payload
  payload=$(echo "$1" | cut -d. -f2)
  # Add padding if needed
  local pad=$((4 - ${#payload} % 4))
  if [ "$pad" -ne 4 ]; then
    payload="${payload}$(printf '=%.0s' $(seq 1 "$pad"))"
  fi
  echo "$payload" | base64 -d 2>/dev/null || echo "$payload" | base64 --decode 2>/dev/null
}

MOD_PAYLOAD=$(decode_jwt_payload "$MOD_JWT")
echo "Role from API: $MOD_ROLE"
echo "JWT payload (excerpt):"
echo "$MOD_PAYLOAD" | jq '{
  moderator: .moderator,
  affiliation: .context.user.affiliation,
  "context.user.moderator": .context.user.moderator,
  "context.user.id": .context.user.id
}' 2>/dev/null || echo "$MOD_PAYLOAD"

# ── Step 7: Generate participant JWT ──────────────────────────
echo ""
echo "=== Step 7: Participant JWT ==="
PART_JWT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/events/$SLUG/jitsi/token" \
  -H 'Content-Type: application/json' \
  -d "{\"accessToken\": \"$ACCESS_TOKEN\"}")

PART_JWT=$(echo "$PART_JWT_RESPONSE" | jq -r '.jwt')
PART_ROLE=$(echo "$PART_JWT_RESPONSE" | jq -r '.role')

PART_PAYLOAD=$(decode_jwt_payload "$PART_JWT")
echo "Role from API: $PART_ROLE"
echo "JWT payload (excerpt):"
echo "$PART_PAYLOAD" | jq '{
  moderator: .moderator,
  affiliation: .context.user.affiliation,
  "context.user.moderator": .context.user.moderator,
  "context.user.id": .context.user.id
}' 2>/dev/null || echo "$PART_PAYLOAD"

# ── Step 8: Verification ─────────────────────────────────────
echo ""
echo "================================================"
echo "  VERIFICATION RESULTS"
echo "================================================"

# API-level role checks
if [ "$MOD_ROLE" = "moderator" ]; then
  ok "Moderator API role: moderator"
else
  fail "Moderator API role is '$MOD_ROLE', expected 'moderator'"
fi

if [ "$PART_ROLE" = "participant" ]; then
  ok "Participant API role: participant"
else
  fail "Participant API role is '$PART_ROLE', expected 'participant'"
fi

# JWT affiliation checks
MOD_AFFILIATION=$(echo "$MOD_PAYLOAD" | jq -r '.context.user.affiliation // empty' 2>/dev/null)
PART_AFFILIATION=$(echo "$PART_PAYLOAD" | jq -r '.context.user.affiliation // empty' 2>/dev/null)

if [ "$MOD_AFFILIATION" = "owner" ]; then
  ok "Moderator JWT affiliation: owner"
else
  fail "Moderator JWT affiliation is '$MOD_AFFILIATION', expected 'owner'"
fi

if [ "$PART_AFFILIATION" = "member" ]; then
  ok "Participant JWT affiliation: member"
else
  fail "Participant JWT affiliation is '$PART_AFFILIATION', expected 'member'"
fi

# JWT moderator flag checks
MOD_FLAG=$(echo "$MOD_PAYLOAD" | jq -r '.context.user.moderator // empty' 2>/dev/null)
PART_FLAG=$(echo "$PART_PAYLOAD" | jq -r '.context.user.moderator // empty' 2>/dev/null)

if [ "$MOD_FLAG" = "true" ]; then
  ok "Moderator JWT moderator flag: 'true'"
else
  fail "Moderator JWT moderator flag is '$MOD_FLAG', expected 'true'"
fi

if [ "$PART_FLAG" = "false" ]; then
  ok "Participant JWT moderator flag: 'false'"
else
  fail "Participant JWT moderator flag is '$PART_FLAG', expected 'false'"
fi

# Unique ID checks
MOD_ID=$(echo "$MOD_PAYLOAD" | jq -r '.context.user.id // empty' 2>/dev/null)
PART_ID=$(echo "$PART_PAYLOAD" | jq -r '.context.user.id // empty' 2>/dev/null)

if [ -n "$MOD_ID" ] && [ -n "$PART_ID" ] && [ "$MOD_ID" != "$PART_ID" ]; then
  ok "Unique user IDs: mod=${MOD_ID:0:12}..., part=${PART_ID:0:12}..."
else
  fail "User IDs missing or duplicate: mod='$MOD_ID', part='$PART_ID'"
fi

# Room name consistency
MOD_ROOM=$(echo "$MOD_PAYLOAD" | jq -r '.room // empty' 2>/dev/null)
PART_ROOM=$(echo "$PART_PAYLOAD" | jq -r '.room // empty' 2>/dev/null)

if [ -n "$MOD_ROOM" ] && [ "$MOD_ROOM" = "$PART_ROOM" ]; then
  ok "Both JWTs target the same room: ${MOD_ROOM:0:20}..."
else
  fail "Room mismatch: mod='$MOD_ROOM', part='$PART_ROOM'"
fi

# ── Step 9: Cleanup ──────────────────────────────────────────
echo ""
echo "=== Cleanup ==="
CLEANUP_RESULT=$(curl -s -X DELETE "$BASE_URL/api/events/$EVENT_ID?token=$MOD_TOKEN")
echo "$CLEANUP_RESULT" | jq '{deleted: .deleted}' 2>/dev/null || echo "$CLEANUP_RESULT"

echo ""
echo "================================================"
if [ "$PASS" = true ]; then
  echo -e "  ${GREEN}ALL CHECKS PASSED${NC}"
  exit 0
else
  echo -e "  ${RED}SOME CHECKS FAILED${NC}"
  exit 1
fi
