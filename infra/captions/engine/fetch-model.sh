#!/bin/sh
# Scarica il modello del motore e ne verifica l'impronta. Gira come
# initContainer: se il file c'è già con l'impronta giusta (volume
# persistente), non scarica nulla. Un'impronta sbagliata ferma il pod.
#
#   CAPTIONS_MODEL_URL     da dove scaricarlo (Hugging Face a revisione fissa, o un mirror)
#   CAPTIONS_MODEL_SHA256  impronta attesa
#   CAPTIONS_MODEL_PATH    dove scriverlo
set -eu

: "${CAPTIONS_MODEL_URL:?CAPTIONS_MODEL_URL mancante}"
: "${CAPTIONS_MODEL_SHA256:?CAPTIONS_MODEL_SHA256 mancante}"
path="${CAPTIONS_MODEL_PATH:-/models/asr.gguf}"

if [ -f "$path" ] && echo "$CAPTIONS_MODEL_SHA256  $path" | sha256sum -c - >/dev/null 2>&1; then
  echo "modello già presente in $path"
  exit 0
fi

mkdir -p "$(dirname "$path")"
echo "scarico il modello in $path"
curl -fsSL --retry 5 --retry-delay 5 --connect-timeout 20 -o "$path.part" "$CAPTIONS_MODEL_URL"
if ! echo "$CAPTIONS_MODEL_SHA256  $path.part" | sha256sum -c - >/dev/null 2>&1; then
  rm -f "$path.part"
  echo "impronta del modello errata: atteso $CAPTIONS_MODEL_SHA256" >&2
  exit 1
fi
mv "$path.part" "$path"
echo "modello pronto"
