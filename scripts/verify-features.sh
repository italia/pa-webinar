#!/bin/bash
# ──────────────────────────────────────────────────────────────
# eventi-dtd — Full feature verification
# Tests all engagement features against a running instance.
#
# Usage:
#   ./scripts/verify-features.sh [base-url] [admin-api-key] [cron-api-key]
#
# Prerequisites: curl, jq
# ──────────────────────────────────────────────────────────────

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
ADMIN_KEY="${2:-dev_admin_key_2026}"
CRON_KEY="${3:-dev_cron_key_change_in_production}"

echo "=========================================="
echo "  eventi-dtd Feature Verification"
echo "  Target: $BASE_URL"
echo "=========================================="

PASS=0
FAIL=0

check() {
  local name="$1"
  local result="$2"
  if [ "$result" = "true" ]; then
    echo "  ✅ $name"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $name"
    FAIL=$((FAIL + 1))
  fi
}

# ── Admin Login ──
echo ""
echo "=== Admin Auth ==="

LOGIN_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/admin/login" \
  -H 'Content-Type: application/json' \
  -d "{\"key\": \"$ADMIN_KEY\"}")
LOGIN_CODE=$(echo "$LOGIN_RESP" | tail -1)
check "Admin login (POST /api/admin/login)" "$([ "$LOGIN_CODE" = "200" ] && echo true || echo false)"

ADMIN_COOKIE=$(curl -s -c - -X POST "$BASE_URL/api/admin/login" \
  -H 'Content-Type: application/json' \
  -d "{\"key\": \"$ADMIN_KEY\"}" | grep admin_session | awk '{print $NF}')
check "Admin cookie received" "$([ -n "$ADMIN_COOKIE" ] && echo true || echo false)"

# ── Create Test Event ──
echo ""
echo "=== Event Creation ==="

START=$(date -u -d '+2 hours' '+%Y-%m-%dT%H:%M:%S.000Z' 2>/dev/null || date -u -v+2H '+%Y-%m-%dT%H:%M:%S.000Z')
END=$(date -u -d '+3 hours' '+%Y-%m-%dT%H:%M:%S.000Z' 2>/dev/null || date -u -v+3H '+%Y-%m-%dT%H:%M:%S.000Z')

EVENT=$(curl -s -b "admin_session=$ADMIN_COOKIE" -X POST "$BASE_URL/api/events" \
  -H 'Content-Type: application/json' \
  -d "{
    \"titleIt\": \"Verifica Feature Test $(date +%s)\",
    \"titleEn\": \"Feature Verification Test\",
    \"descriptionIt\": \"Test automatico di verifica funzionalità\",
    \"descriptionEn\": \"Automated feature verification test\",
    \"startsAt\": \"$START\",
    \"endsAt\": \"$END\",
    \"maxParticipants\": 50,
    \"qaEnabled\": true,
    \"chatEnabled\": true,
    \"recordingEnabled\": false,
    \"participantsCanUnmute\": true,
    \"participantsCanStartVideo\": true,
    \"participantsCanShareScreen\": true
  }")

SLUG=$(echo "$EVENT" | jq -r '.slug // empty')
EVENT_ID=$(echo "$EVENT" | jq -r '.id // empty')
MOD_TOKEN=$(echo "$EVENT" | jq -r '.moderatorToken // empty')
check "Event created" "$([ -n "$SLUG" ] && echo true || echo false)"

# Publish the event
PUB_RESP=$(curl -s -X PUT "$BASE_URL/api/events/$EVENT_ID" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MOD_TOKEN" \
  -d '{"status": "PUBLISHED"}')
PUB_STATUS=$(echo "$PUB_RESP" | jq -r '.status // empty')
check "Event published" "$([ "$PUB_STATUS" = "PUBLISHED" ] && echo true || echo false)"

# ── GET single event (public) ──
echo ""
echo "=== Event Detail ==="

EVENT_DETAIL=$(curl -s "$BASE_URL/api/events/$SLUG")
check "Event detail by slug" "$(echo "$EVENT_DETAIL" | jq -r '.slug // empty' | grep -q "$SLUG" && echo true || echo false)"

EVENT_DETAIL_BY_ID=$(curl -s "$BASE_URL/api/events/$EVENT_ID")
check "Event detail by UUID" "$(echo "$EVENT_DETAIL_BY_ID" | jq -r '.id // empty' | grep -q "$EVENT_ID" && echo true || echo false)"

# Moderator detail
EVENT_MOD=$(curl -s "$BASE_URL/api/events/$EVENT_ID?token=$MOD_TOKEN")
check "Moderator detail includes jitsiRoomName" "$(echo "$EVENT_MOD" | jq -r '.jitsiRoomName // empty' | grep -q 'evt-' && echo true || echo false)"

# ── Registration ──
echo ""
echo "=== Registration ==="

REG=$(curl -s -X POST "$BASE_URL/api/events/$SLUG/registrations" \
  -H 'Content-Type: application/json' \
  -d '{
    "displayName": "Utente Test",
    "email": "test-verify@example.com",
    "consentGiven": true
  }')
ACCESS_TOKEN=$(echo "$REG" | jq -r '.accessToken // empty')
check "Registration created" "$([ -n "$ACCESS_TOKEN" ] && echo true || echo false)"

REG2=$(curl -s -X POST "$BASE_URL/api/events/$SLUG/registrations" \
  -H 'Content-Type: application/json' \
  -d '{
    "displayName": "Utente Profiled",
    "email": "test-verify2@example.com",
    "consentGiven": true,
    "organization": "AGID",
    "organizationRole": "Sviluppatore",
    "organizationType": "AGENCY"
  }')
ACCESS_TOKEN2=$(echo "$REG2" | jq -r '.accessToken // empty')
check "Registration with profiling fields" "$([ -n "$ACCESS_TOKEN2" ] && echo true || echo false)"

# Duplicate registration should fail
REG_DUP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/events/$SLUG/registrations" \
  -H 'Content-Type: application/json' \
  -d '{
    "displayName": "Utente Test",
    "email": "test-verify@example.com",
    "consentGiven": true
  }')
check "Duplicate registration rejected (409)" "$([ "$REG_DUP" = "409" ] && echo true || echo false)"

# Lookup registration
REG_LOOKUP=$(curl -s "$BASE_URL/api/events/$SLUG/registrations/$ACCESS_TOKEN")
check "Registration lookup by accessToken" "$(echo "$REG_LOOKUP" | jq -r '.displayName // empty' | grep -q 'Utente Test' && echo true || echo false)"

# ── Set LIVE ──
echo ""
echo "=== Go LIVE ==="

LIVE_RESP=$(curl -s -X PUT "$BASE_URL/api/events/$EVENT_ID" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MOD_TOKEN" \
  -d '{"status": "LIVE"}')
LIVE_STATUS=$(echo "$LIVE_RESP" | jq -r '.status // empty')
check "Event set to LIVE" "$([ "$LIVE_STATUS" = "LIVE" ] && echo true || echo false)"

# ── Jitsi JWT ──
echo ""
echo "=== Jitsi JWT ==="

MOD_JWT_RESP=$(curl -s -X POST "$BASE_URL/api/events/$SLUG/jitsi/token" \
  -H 'Content-Type: application/json' \
  -d "{\"moderatorToken\": \"$MOD_TOKEN\"}")
check "Moderator JWT (role=moderator)" "$(echo "$MOD_JWT_RESP" | jq -r '.role // empty' | grep -q 'moderator' && echo true || echo false)"

PART_JWT_RESP=$(curl -s -X POST "$BASE_URL/api/events/$SLUG/jitsi/token" \
  -H 'Content-Type: application/json' \
  -d "{\"accessToken\": \"$ACCESS_TOKEN\"}")
check "Participant JWT (role=participant)" "$(echo "$PART_JWT_RESP" | jq -r '.role // empty' | grep -q 'participant' && echo true || echo false)"

GUEST_JWT_RESP=$(curl -s -X POST "$BASE_URL/api/events/$SLUG/jitsi/token" \
  -H 'Content-Type: application/json' \
  -d '{"guestName": "Ospite Test"}')
check "Guest JWT (role=guest)" "$(echo "$GUEST_JWT_RESP" | jq -r '.role // empty' | grep -qE 'guest|participant' && echo true || echo false)"

# ── Q&A ──
echo ""
echo "=== Q&A System ==="

Q1=$(curl -s -X POST "$BASE_URL/api/events/$SLUG/questions" \
  -H 'Content-Type: application/json' \
  -d "{\"accessToken\": \"$ACCESS_TOKEN\", \"text\": \"Come funziona la verifica delle feature?\"}")
Q_ID=$(echo "$Q1" | jq -r '.id // empty')
check "Question submitted" "$([ -n "$Q_ID" ] && echo true || echo false)"

UPVOTE=$(curl -s -X POST "$BASE_URL/api/events/$SLUG/questions/$Q_ID/upvote" \
  -H 'Content-Type: application/json' \
  -d "{\"accessToken\": \"$ACCESS_TOKEN\"}")
check "Upvote (toggle on)" "$(echo "$UPVOTE" | jq -r '.upvoted // empty' | grep -q 'true' && echo true || echo false)"

UPVOTE_OFF=$(curl -s -X POST "$BASE_URL/api/events/$SLUG/questions/$Q_ID/upvote" \
  -H 'Content-Type: application/json' \
  -d "{\"accessToken\": \"$ACCESS_TOKEN\"}")
check "Upvote (toggle off)" "$(echo "$UPVOTE_OFF" | jq -r '.upvoted // empty' | grep -q 'false' && echo true || echo false)"

Q_LIST=$(curl -s "$BASE_URL/api/events/$SLUG/questions" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
check "Questions listed" "$(echo "$Q_LIST" | jq -r '.totalCount // 0' | grep -q '[1-9]' && echo true || echo false)"

Q_HIGHLIGHT=$(curl -s -X PATCH "$BASE_URL/api/events/$SLUG/questions/$Q_ID" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MOD_TOKEN" \
  -d '{"status": "HIGHLIGHTED"}')
check "Question highlighted (moderator)" "$(echo "$Q_HIGHLIGHT" | jq -r '.status // empty' | grep -q 'HIGHLIGHTED' && echo true || echo false)"

Q_ANSWERED=$(curl -s -X PATCH "$BASE_URL/api/events/$SLUG/questions/$Q_ID" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MOD_TOKEN" \
  -d '{"status": "ANSWERED"}')
check "Question answered (moderator)" "$(echo "$Q_ANSWERED" | jq -r '.status // empty' | grep -q 'ANSWERED' && echo true || echo false)"

# ── Polls ──
echo ""
echo "=== Polling System ==="

POLL=$(curl -s -X POST "$BASE_URL/api/events/$SLUG/polls" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MOD_TOKEN" \
  -d '{"question": "Ti piace questa piattaforma?", "options": ["Sì, molto!", "Sì", "Così così", "No"]}')
POLL_ID=$(echo "$POLL" | jq -r '.id // empty')
check "Poll created" "$([ -n "$POLL_ID" ] && echo true || echo false)"

VOTE=$(curl -s -X POST "$BASE_URL/api/events/$SLUG/polls/$POLL_ID/vote" \
  -H 'Content-Type: application/json' \
  -d "{\"optionIndex\": 0, \"accessToken\": \"$ACCESS_TOKEN\"}")
check "Poll vote cast" "$(echo "$VOTE" | jq -r '.ok // empty' | grep -q 'true' && echo true || echo false)"

POLL_CLOSE=$(curl -s -X PATCH "$BASE_URL/api/events/$SLUG/polls/$POLL_ID" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MOD_TOKEN" \
  -d '{"status": "CLOSED"}')
check "Poll closed" "$(echo "$POLL_CLOSE" | jq -r '.status // empty' | grep -q 'CLOSED' && echo true || echo false)"

POLL_PUB=$(curl -s -X PATCH "$BASE_URL/api/events/$SLUG/polls/$POLL_ID" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MOD_TOKEN" \
  -d '{"status": "PUBLISHED"}')
check "Poll results published" "$(echo "$POLL_PUB" | jq -r '.status // empty' | grep -q 'PUBLISHED' && echo true || echo false)"

POLL_LIST=$(curl -s "$BASE_URL/api/events/$SLUG/polls" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
check "Polls listed (participant)" "$(echo "$POLL_LIST" | jq -r '.polls | length' | grep -q '[1-9]' && echo true || echo false)"

# ── Materials ──
echo ""
echo "=== Session Materials ==="

MAT=$(curl -s -X POST "$BASE_URL/api/events/$SLUG/materials" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MOD_TOKEN" \
  -d '{"title": "Slide presentazione", "url": "https://example.com/slides.pdf", "description": "Le slide usate"}')
MAT_ID=$(echo "$MAT" | jq -r '.id // empty')
check "Material added" "$([ -n "$MAT_ID" ] && echo true || echo false)"

MAT_LIST=$(curl -s "$BASE_URL/api/events/$SLUG/materials")
check "Materials listed" "$(echo "$MAT_LIST" | jq -r 'length' | grep -q '[1-9]' && echo true || echo false)"

# ── Reminders ──
echo ""
echo "=== Reminders ==="

REM_LIST=$(curl -s "$BASE_URL/api/events/$SLUG/reminders" \
  -H "Authorization: Bearer $MOD_TOKEN")
check "Default reminders exist" "$(echo "$REM_LIST" | jq -r 'length' | grep -q '[1-9]' && echo true || echo false)"

# ── Calendar ──
echo ""
echo "=== Calendar Integration ==="

ICAL_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/events/$SLUG/calendar.ics")
check "iCal download (200)" "$([ "$ICAL_CODE" = "200" ] && echo true || echo false)"

# ── Health / Status ──
echo ""
echo "=== Health & Status ==="

HEALTH=$(curl -s "$BASE_URL/api/health" | jq -r '.status // empty')
check "Health check OK" "$([ "$HEALTH" = "ok" ] && echo true || echo false)"

STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/status")
check "Status endpoint (200)" "$([ "$STATUS_CODE" = "200" ] && echo true || echo false)"

# ── Metrics (requires CRON_API_KEY) ──
echo ""
echo "=== Metrics ==="

METRICS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/metrics" \
  -H "Authorization: Bearer $CRON_KEY")
check "Metrics endpoint (200)" "$([ "$METRICS_CODE" = "200" ] && echo true || echo false)"

# ── Site Settings ──
echo ""
echo "=== Site Settings ==="

SETTINGS=$(curl -s "$BASE_URL/api/admin/settings")
check "Settings GET (public)" "$(echo "$SETTINGS" | jq -r '.siteName // empty' | grep -q '.' && echo true || echo false)"

SETTINGS_ADMIN=$(curl -s -b "admin_session=$ADMIN_COOKIE" "$BASE_URL/api/admin/settings")
check "Settings GET (admin)" "$(echo "$SETTINGS_ADMIN" | jq -r '.siteName // empty' | grep -q '.' && echo true || echo false)"

# ── Analytics ──
echo ""
echo "=== Analytics ==="

ANALYTICS=$(curl -s -b "admin_session=$ADMIN_COOKIE" "$BASE_URL/api/admin/analytics?period=all")
check "Analytics API" "$(echo "$ANALYTICS" | jq -r '.overview.totalEvents // empty' | grep -q '[0-9]' && echo true || echo false)"

# ── Infrastructure ──
echo ""
echo "=== Infrastructure ==="

INFRA=$(curl -s -b "admin_session=$ADMIN_COOKIE" "$BASE_URL/api/admin/infrastructure")
check "Infrastructure API" "$(echo "$INFRA" | jq -r '.deployment.mode // empty' | grep -qE 'simple|standard|full|unknown' && echo true || echo false)"

# ── JVB Scaler (requires CRON_API_KEY) ──
echo ""
echo "=== JVB Scaler ==="

JVB=$(curl -s "$BASE_URL/api/internal/jvb-desired-replicas" \
  -H "x-api-key: $CRON_KEY")
check "JVB scaler API (authed)" "$(echo "$JVB" | jq -r '.desired // empty' | grep -q '[0-9]' && echo true || echo false)"

# ── GDPR ──
echo ""
echo "=== GDPR ==="

CLEANUP=$(curl -s "$BASE_URL/api/cron/cleanup" \
  -H "x-api-key: $CRON_KEY")
check "GDPR cleanup cron" "$(echo "$CLEANUP" | jq -r '.ok // empty' | grep -q 'true' && echo true || echo false)"

EXPORT=$(curl -s "$BASE_URL/api/gdpr/export?email=nonexistent@test.com")
check "GDPR export (empty data)" "$(echo "$EXPORT" | jq -r '.data // empty' | grep -q '\[\]' && echo true || echo false)"

# ── Email (Mailpit) ──
echo ""
echo "=== Email (Mailpit) ==="

MAILPIT_RESP=$(curl -s "http://localhost:8025/api/v1/messages" 2>/dev/null || echo '{}')
MAILPIT_COUNT=$(echo "$MAILPIT_RESP" | jq -r '.total // .count // 0' 2>/dev/null || echo "0")
check "Confirmation emails sent (Mailpit)" "$([ "$MAILPIT_COUNT" -gt 0 ] 2>/dev/null && echo true || echo false)"

# ── Pages ──
echo ""
echo "=== Pages ==="

for path in "" "/eventi" "/status" "/privacy" "/accessibilita"; do
  for locale in "it" "en"; do
    PAGE_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/${locale}${path}")
    check "Page /${locale}${path} (200)" "$([ "$PAGE_CODE" = "200" ] && echo true || echo false)"
  done
done

# ── Cleanup: delete test event ──
echo ""
echo "=== Cleanup ==="

DEL=$(curl -s -X DELETE "$BASE_URL/api/events/$EVENT_ID" \
  -H "Authorization: Bearer $MOD_TOKEN")
check "Test event deleted" "$(echo "$DEL" | jq -r '.deleted // empty' | grep -q 'true' && echo true || echo false)"

# ── Summary ──
echo ""
echo "=========================================="
echo "  Results: $PASS passed, $FAIL failed"
echo "  Total: $((PASS + FAIL)) checks"
echo "=========================================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
