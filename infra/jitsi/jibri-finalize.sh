#!/bin/bash
# Jibri finalize script — runs after recording completes.
# Uploads the recording to configured object storage and notifies the portal.
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
#   CRON_API_KEY — authentication key for the webhook

set -e

RECORDING_DIR="$1"
if [ -z "$RECORDING_DIR" ] || [ ! -d "$RECORDING_DIR" ]; then
  echo "ERROR: Recording directory not found: $RECORDING_DIR"
  exit 1
fi

MP4_FILE=$(find "$RECORDING_DIR" -name "*.mp4" | head -1)
if [ -z "$MP4_FILE" ]; then
  echo "ERROR: No MP4 file found in $RECORDING_DIR"
  exit 1
fi

FILENAME=$(basename "$MP4_FILE")
echo "Processing recording: $FILENAME"

RECORDING_URL=""

case "${RECORDING_STORAGE_TYPE:-local}" in
  azure-blob)
    echo "Uploading to Azure Blob Storage..."
    if ! command -v azcopy &>/dev/null; then
      echo "ERROR: azcopy not found. Install it in the Jibri image."
      exit 1
    fi
    azcopy copy "$MP4_FILE" \
      "https://${RECORDING_AZURE_CONTAINER}.blob.core.windows.net/recordings/$FILENAME" \
      --from-to LocalBlob
    RECORDING_URL="https://${RECORDING_AZURE_CONTAINER}.blob.core.windows.net/recordings/$FILENAME"
    ;;

  s3)
    echo "Uploading to S3..."
    aws s3 cp "$MP4_FILE" \
      "s3://${RECORDING_S3_BUCKET}/recordings/$FILENAME" \
      --region "${RECORDING_S3_REGION}"
    RECORDING_URL="https://${RECORDING_S3_BUCKET}.s3.${RECORDING_S3_REGION}.amazonaws.com/recordings/$FILENAME"
    ;;

  gcs)
    echo "Uploading to Google Cloud Storage..."
    gcloud storage cp "$MP4_FILE" "gs://${RECORDING_GCS_BUCKET}/recordings/$FILENAME"
    RECORDING_URL="gs://${RECORDING_GCS_BUCKET}/recordings/$FILENAME"
    ;;

  minio)
    echo "Uploading to MinIO..."
    mc alias set myminio "${RECORDING_MINIO_ENDPOINT}" "${RECORDING_MINIO_ACCESS_KEY}" "${RECORDING_MINIO_SECRET_KEY}"
    mc cp "$MP4_FILE" "myminio/${RECORDING_MINIO_BUCKET}/recordings/$FILENAME"
    RECORDING_URL="${RECORDING_MINIO_ENDPOINT}/${RECORDING_MINIO_BUCKET}/recordings/$FILENAME"
    ;;

  local)
    echo "Keeping recording locally: $MP4_FILE"
    RECORDING_URL="file://$MP4_FILE"
    ;;

  *)
    echo "ERROR: Unknown storage type: $RECORDING_STORAGE_TYPE"
    exit 1
    ;;
esac

echo "Recording uploaded: $RECORDING_URL"

# Notify the portal via webhook
if [ -n "$RECORDING_WEBHOOK_URL" ] && [ "${RECORDING_URL}" != "file://"* ]; then
  ROOM_NAME=$(basename "$RECORDING_DIR" | sed 's/_[0-9]*-[0-9]*-[0-9]*.*$//')

  # Use jq if available, otherwise python — avoids broken JSON from special chars in URLs
  if command -v jq >/dev/null 2>&1; then
    PAYLOAD=$(jq -n --arg room "$ROOM_NAME" --arg url "$RECORDING_URL" --arg file "$FILENAME" \
      '{roomName: $room, recordingUrl: $url, filename: $file}')
  elif command -v python3 >/dev/null 2>&1; then
    PAYLOAD=$(python3 -c "import json,sys;print(json.dumps({'roomName':sys.argv[1],'recordingUrl':sys.argv[2],'filename':sys.argv[3]}))" "$ROOM_NAME" "$RECORDING_URL" "$FILENAME")
  else
    # Minimal escaping for backslash and double-quote
    ESC_ROOM=$(printf '%s' "$ROOM_NAME" | sed 's/\\/\\\\/g;s/"/\\"/g')
    ESC_URL=$(printf '%s' "$RECORDING_URL" | sed 's/\\/\\\\/g;s/"/\\"/g')
    ESC_FILE=$(printf '%s' "$FILENAME" | sed 's/\\/\\\\/g;s/"/\\"/g')
    PAYLOAD="{\"roomName\":\"$ESC_ROOM\",\"recordingUrl\":\"$ESC_URL\",\"filename\":\"$ESC_FILE\"}"
  fi

  echo "Notifying portal: $RECORDING_WEBHOOK_URL"
  curl -s -X POST "$RECORDING_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${CRON_API_KEY}" \
    -d "$PAYLOAD" || echo "WARNING: Failed to notify portal"
fi

# Cleanup local file after successful upload (except for local storage)
if [ "${RECORDING_STORAGE_TYPE}" != "local" ]; then
  rm -rf "$RECORDING_DIR"
  echo "Local recording cleaned up"
fi

echo "Finalize complete"
