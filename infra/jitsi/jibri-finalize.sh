#!/bin/bash
# Jibri finalize script — runs after recording completes.
# 1. Extracts duration/size via ffprobe
# 2. Re-muxes with faststart for streaming (no re-encode)
# 3. Tags MP4 metadata from the portal (event title, organizer, participants)
# 4. Uploads to configured object storage
# 5. Notifies the portal webhook with enriched payload
#
# Arguments:
#   $1 — path to the recording directory (contains .mp4 and metadata)
#
# Environment variables (set from Kubernetes secret):
#   RECORDING_STORAGE_TYPE — azure-blob | s3 | gcs | minio | local
#   RECORDING_AZURE_CONNECTION_STRING, RECORDING_AZURE_CONTAINER
#   RECORDING_S3_BUCKET, RECORDING_S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
#   RECORDING_GCS_BUCKET, GOOGLE_APPLICATION_CREDENTIALS
#   RECORDING_MINIO_ENDPOINT, RECORDING_MINIO_BUCKET, RECORDING_MINIO_ACCESS_KEY, RECORDING_MINIO_SECRET_KEY
#   RECORDING_WEBHOOK_URL — URL to notify the portal when recording is ready
#   APP_INTERNAL_URL — internal URL for the portal (e.g. http://videocall-test-eventi-dtd:3000)
#   CRON_API_KEY — bearer-token authentication key for the webhook and internal API
#   RECORDING_WEBHOOK_SECRET — HMAC-SHA256 secret used to sign the webhook
#       body (header X-Webhook-Signature: sha256=<hex>). When unset the
#       portal falls back to bearer-only auth and logs a warning.

set -e

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] FINALIZE: $1"; }

RECORDING_DIR="$1"
if [ -z "$RECORDING_DIR" ] || [ ! -d "$RECORDING_DIR" ]; then
  log "ERROR: Recording directory not found: $RECORDING_DIR"
  exit 1
fi

MP4_FILE=$(find "$RECORDING_DIR" -name "*.mp4" | head -1)
if [ -z "$MP4_FILE" ]; then
  log "ERROR: No MP4 file found in $RECORDING_DIR"
  exit 1
fi

FILENAME=$(basename "$MP4_FILE")
ROOM_NAME=$(basename "$RECORDING_DIR" | sed 's/_[0-9]*-[0-9]*-[0-9]*.*$//')
log "Processing recording: $FILENAME (room: $ROOM_NAME)"

# ── Step 1: Extract metadata with ffprobe ────────────────────
DURATION=0
ORIGINAL_SIZE=0
if command -v ffprobe >/dev/null 2>&1; then
  DURATION=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$MP4_FILE" 2>/dev/null | cut -d. -f1 || echo "0")
  log "Duration: ${DURATION}s"
else
  log "WARNING: ffprobe not found, skipping duration extraction"
fi
ORIGINAL_SIZE=$(stat -c%s "$MP4_FILE" 2>/dev/null || stat -f%z "$MP4_FILE" 2>/dev/null || echo "0")
log "Original size: ${ORIGINAL_SIZE} bytes"

# ── Step 2: Re-mux with faststart (moov atom at front for streaming) ──
if command -v ffmpeg >/dev/null 2>&1; then
  FASTSTART_FILE="${MP4_FILE%.mp4}_faststart.mp4"
  log "Re-muxing with faststart..."
  ffmpeg -y -i "$MP4_FILE" -c copy -movflags +faststart "$FASTSTART_FILE" 2>/dev/null
  mv "$FASTSTART_FILE" "$MP4_FILE"
  log "Faststart re-mux complete"
else
  log "WARNING: ffmpeg not found, skipping faststart re-mux"
fi

# ── Step 3: Tag MP4 metadata from portal ─────────────────────
EVENT_TITLE=""
EVENT_ORGANIZER=""
EVENT_DESCRIPTION=""
EVENT_DATE=""
PARTICIPANTS_JSON="[]"

if [ -n "$APP_INTERNAL_URL" ] && [ -n "$CRON_API_KEY" ] && command -v ffmpeg >/dev/null 2>&1; then
  log "Fetching event metadata from portal..."
  EVENT_META=$(curl -sf \
    -H "x-api-key: ${CRON_API_KEY}" \
    "${APP_INTERNAL_URL}/api/internal/recording-metadata?room=${ROOM_NAME}" 2>/dev/null || echo "{}")

  if [ "$EVENT_META" != "{}" ] && command -v jq >/dev/null 2>&1; then
    EVENT_TITLE=$(echo "$EVENT_META" | jq -r '.title // ""')
    EVENT_ORGANIZER=$(echo "$EVENT_META" | jq -r '.organizer // ""')
    EVENT_DESCRIPTION=$(echo "$EVENT_META" | jq -r '.description // ""')
    EVENT_DATE=$(echo "$EVENT_META" | jq -r '.date // ""')
    PARTICIPANTS_JSON=$(echo "$EVENT_META" | jq -c '.participants // []')

    if [ -n "$EVENT_TITLE" ]; then
      TAGGED_FILE="${MP4_FILE%.mp4}_tagged.mp4"
      log "Tagging MP4 with event metadata..."
      ffmpeg -y -i "$MP4_FILE" -c copy \
        -metadata title="$EVENT_TITLE" \
        -metadata artist="$EVENT_ORGANIZER" \
        -metadata date="$EVENT_DATE" \
        -metadata description="$EVENT_DESCRIPTION" \
        -metadata comment="participants: $PARTICIPANTS_JSON" \
        "$TAGGED_FILE" 2>/dev/null
      mv "$TAGGED_FILE" "$MP4_FILE"
      log "MP4 metadata tagged"
    fi
  else
    log "WARNING: Could not fetch event metadata (response: ${EVENT_META:0:100})"
  fi
fi

# Update file size after processing
FILE_SIZE=$(stat -c%s "$MP4_FILE" 2>/dev/null || stat -f%z "$MP4_FILE" 2>/dev/null || echo "$ORIGINAL_SIZE")
log "Final size: ${FILE_SIZE} bytes (was ${ORIGINAL_SIZE})"

# ── Step 4: Upload to storage ────────────────────────────────
RECORDING_URL=""

case "${RECORDING_STORAGE_TYPE:-local}" in
  azure-blob)
    log "Uploading to Azure Blob Storage..."
    if ! command -v azcopy &>/dev/null; then
      log "ERROR: azcopy not found. Install it in the Jibri image."
      exit 1
    fi
    azcopy copy "$MP4_FILE" \
      "https://${RECORDING_AZURE_CONTAINER}.blob.core.windows.net/recordings/$FILENAME" \
      --from-to LocalBlob
    RECORDING_URL="https://${RECORDING_AZURE_CONTAINER}.blob.core.windows.net/recordings/$FILENAME"
    ;;

  s3)
    log "Uploading to S3..."
    aws s3 cp "$MP4_FILE" \
      "s3://${RECORDING_S3_BUCKET}/recordings/$FILENAME" \
      --region "${RECORDING_S3_REGION}"
    RECORDING_URL="https://${RECORDING_S3_BUCKET}.s3.${RECORDING_S3_REGION}.amazonaws.com/recordings/$FILENAME"
    ;;

  gcs)
    log "Uploading to Google Cloud Storage..."
    gcloud storage cp "$MP4_FILE" "gs://${RECORDING_GCS_BUCKET}/recordings/$FILENAME"
    RECORDING_URL="gs://${RECORDING_GCS_BUCKET}/recordings/$FILENAME"
    ;;

  minio)
    log "Uploading to MinIO..."
    mc alias set myminio "${RECORDING_MINIO_ENDPOINT}" "${RECORDING_MINIO_ACCESS_KEY}" "${RECORDING_MINIO_SECRET_KEY}"
    mc cp "$MP4_FILE" "myminio/${RECORDING_MINIO_BUCKET}/recordings/$FILENAME"
    RECORDING_URL="${RECORDING_MINIO_ENDPOINT}/${RECORDING_MINIO_BUCKET}/recordings/$FILENAME"
    ;;

  local)
    log "Keeping recording locally: $MP4_FILE"
    RECORDING_URL="file://$MP4_FILE"
    ;;

  *)
    log "ERROR: Unknown storage type: $RECORDING_STORAGE_TYPE"
    exit 1
    ;;
esac

log "Recording uploaded: $RECORDING_URL"

# ── Step 5: Notify the portal with enriched payload ──────────
if [ -n "$RECORDING_WEBHOOK_URL" ] && [ "${RECORDING_URL}" != "file://"* ]; then
  if command -v jq >/dev/null 2>&1; then
    PAYLOAD=$(jq -n \
      --arg room "$ROOM_NAME" \
      --arg url "$RECORDING_URL" \
      --arg file "$FILENAME" \
      --argjson duration "${DURATION:-0}" \
      --argjson fileSize "${FILE_SIZE:-0}" \
      --argjson participants "$PARTICIPANTS_JSON" \
      '{roomName: $room, recordingUrl: $url, filename: $file, duration: $duration, fileSize: $fileSize, participants: $participants}')
  elif command -v python3 >/dev/null 2>&1; then
    PAYLOAD=$(python3 -c "
import json,sys
print(json.dumps({
  'roomName': sys.argv[1],
  'recordingUrl': sys.argv[2],
  'filename': sys.argv[3],
  'duration': int(sys.argv[4]),
  'fileSize': int(sys.argv[5]),
  'participants': json.loads(sys.argv[6])
}))" "$ROOM_NAME" "$RECORDING_URL" "$FILENAME" "${DURATION:-0}" "${FILE_SIZE:-0}" "$PARTICIPANTS_JSON")
  else
    PAYLOAD="{\"roomName\":\"$ROOM_NAME\",\"recordingUrl\":\"$RECORDING_URL\",\"filename\":\"$FILENAME\",\"duration\":${DURATION:-0},\"fileSize\":${FILE_SIZE:-0}}"
  fi

  # Sign the body with HMAC-SHA256 when a webhook secret is configured.
  # The portal enforces signature verification iff it sees this header.
  SIGNATURE_HEADER=()
  if [ -n "$RECORDING_WEBHOOK_SECRET" ] && command -v openssl >/dev/null 2>&1; then
    SIG_HEX=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$RECORDING_WEBHOOK_SECRET" -hex 2>/dev/null | awk '{print $NF}')
    if [ -n "$SIG_HEX" ]; then
      SIGNATURE_HEADER=(-H "X-Webhook-Signature: sha256=${SIG_HEX}")
    else
      log "WARNING: Could not compute webhook signature"
    fi
  fi

  log "Notifying portal: $RECORDING_WEBHOOK_URL"
  curl -sf -X POST "$RECORDING_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${CRON_API_KEY}" \
    "${SIGNATURE_HEADER[@]}" \
    -d "$PAYLOAD" || log "WARNING: Failed to notify portal"
fi

# ── Cleanup ──────────────────────────────────────────────────
if [ "${RECORDING_STORAGE_TYPE}" != "local" ]; then
  rm -rf "$RECORDING_DIR"
  log "Local recording cleaned up"
fi

log "Finalize complete (duration=${DURATION}s, size=${FILE_SIZE} bytes)"
