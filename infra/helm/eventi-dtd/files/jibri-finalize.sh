#!/bin/bash
# Jibri finalize script — runs after recording completes.
#
# Flow:
#   1. Extract duration + size via ffprobe.
#   2. Re-mux with faststart so the mp4 is streamable from cold storage.
#   3. Ask the portal for a short-lived write-SAS URL.
#   4. PUT the file to object storage via curl.
#   5. Notify the portal webhook so it can write recordingUrl on the
#      Event + create a CallSession row.
#   6. Clean up the local recording directory.
#
# Required environment (set via jibri.extraEnvs in Helm values):
#   APP_INTERNAL_URL — e.g. http://videocall-test-eventi-dtd:3000
#   CRON_API_KEY     — shared secret for the internal endpoint + webhook
#
# Arguments:
#   $1 — path to the recording directory (contains the .mp4)

set -e

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] FINALIZE: $1"; }

RECORDING_DIR="$1"
if [ -z "$RECORDING_DIR" ] || [ ! -d "$RECORDING_DIR" ]; then
  log "ERROR: recording directory not found: $RECORDING_DIR"
  exit 1
fi

MP4_FILE=$(find "$RECORDING_DIR" -name "*.mp4" | head -1)
if [ -z "$MP4_FILE" ]; then
  log "ERROR: no mp4 in $RECORDING_DIR"
  exit 1
fi

FILENAME=$(basename "$MP4_FILE")
# File names look like: <roomName>_<yyyy-mm-dd>-<HH-MM-SS>.mp4
ROOM_NAME=$(echo "$FILENAME" | sed 's/_[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}-[0-9]\{2\}-[0-9]\{2\}-[0-9]\{2\}\.mp4$//')
log "processing $FILENAME (room: $ROOM_NAME)"

if [ -z "$APP_INTERNAL_URL" ] || [ -z "$CRON_API_KEY" ]; then
  log "ERROR: APP_INTERNAL_URL / CRON_API_KEY not set — cannot upload"
  exit 1
fi

# ── 1. Probe duration + size ────────────────────────────────
DURATION=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$MP4_FILE" 2>/dev/null | cut -d. -f1 || echo "0")
[ -z "$DURATION" ] && DURATION=0
ORIG_SIZE=$(stat -c%s "$MP4_FILE" 2>/dev/null || echo 0)
log "duration=${DURATION}s size=${ORIG_SIZE}B"

# ── 2. Re-mux with faststart (moov atom at the front) ──────
FASTSTART_FILE="${MP4_FILE%.mp4}_fs.mp4"
if ffmpeg -y -i "$MP4_FILE" -c copy -movflags +faststart "$FASTSTART_FILE" </dev/null >/dev/null 2>&1; then
  mv "$FASTSTART_FILE" "$MP4_FILE"
  log "faststart remux ok"
else
  log "WARN: faststart remux failed, using original"
  rm -f "$FASTSTART_FILE"
fi
FILE_SIZE=$(stat -c%s "$MP4_FILE" 2>/dev/null || echo "$ORIG_SIZE")

# ── 3. Get a write-SAS from the portal ─────────────────────
log "requesting upload URL from $APP_INTERNAL_URL"
SAS_RESP=$(curl -sf -X POST "$APP_INTERNAL_URL/api/internal/recording-upload-url" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $CRON_API_KEY" \
  -d "$(jq -nc --arg room "$ROOM_NAME" --arg file "$FILENAME" \
        '{roomName: $room, filename: $file}')") || {
  log "ERROR: portal refused upload-url request"
  exit 1
}

UPLOAD_URL=$(echo "$SAS_RESP" | jq -r '.uploadUrl // empty')
RECORDING_URL=$(echo "$SAS_RESP" | jq -r '.recordingUrl // empty')
if [ -z "$UPLOAD_URL" ] || [ -z "$RECORDING_URL" ]; then
  log "ERROR: upload-url response missing fields: $SAS_RESP"
  exit 1
fi

# ── 4. PUT the blob ────────────────────────────────────────
log "uploading $(du -h "$MP4_FILE" | cut -f1) to object storage"
if ! curl -sf -X PUT -T "$MP4_FILE" \
     -H "x-ms-blob-type: BlockBlob" \
     -H "Content-Type: video/mp4" \
     "$UPLOAD_URL" >/dev/null; then
  log "ERROR: blob upload failed"
  exit 1
fi
log "upload ok: $RECORDING_URL"

# ── 5. Notify portal webhook ───────────────────────────────
log "notifying webhook"
PAYLOAD=$(jq -nc \
  --arg room "$ROOM_NAME" \
  --arg url  "$RECORDING_URL" \
  --arg file "$FILENAME" \
  --argjson dur "$DURATION" \
  --argjson sz  "$FILE_SIZE" \
  '{roomName: $room, recordingUrl: $url, filename: $file, duration: $dur, fileSize: $sz}')

if ! curl -sf -X POST "$APP_INTERNAL_URL/api/webhooks/recording" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $CRON_API_KEY" \
     -d "$PAYLOAD" >/dev/null; then
  log "WARN: webhook post failed (blob uploaded, portal unaware — will be picked up by reconcile cron)"
fi

# ── 6. Clean up the local file ─────────────────────────────
rm -rf "$RECORDING_DIR"
log "done (duration=${DURATION}s size=${FILE_SIZE}B)"
