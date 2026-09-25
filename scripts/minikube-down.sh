#!/usr/bin/env bash
#
# Spegne o cancella il profilo minikube creato da scripts/minikube-up.sh.
#
# Uso:  scripts/minikube-down.sh [--profile NOME] [--stop] [--purge]
#   (nessuna opzione)  cancella il profilo: cluster, database e immagini caricate
#   --stop             lo ferma soltanto; minikube-up.sh lo riavvia com'era
#   --purge            cancella anche segreti e valori generati (cartella di
#                      stato): la prossima installazione ne genera di nuovi
#   --state-dir DIR    la cartella di stato, se a minikube-up.sh ne hai data una
#
# Il contesto di kubectl attivo prima del lancio resta quello; se era proprio
# il profilo cancellato, nessun contesto resta attivo.

set -euo pipefail

PROFILO="pa-webinar"
AZIONE="delete"
PURGE="no"
STATO=""

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILO="${2:?}"; shift 2 ;;
    --stop) AZIONE="stop"; shift ;;
    --purge) PURGE="si"; shift ;;
    --state-dir) STATO="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'Opzione sconosciuta: %s\n' "$1" >&2; exit 1 ;;
  esac
done
STATO="${STATO:-${XDG_CONFIG_HOME:-$HOME/.config}/pa-webinar/minikube/$PROFILO}"

if [ "$AZIONE" = "stop" ] && [ "$PURGE" = "si" ]; then
  printf '%s\n' "--purge con --stop lascerebbe un database di cui non si conoscono più le password: usa --purge solo per cancellare." >&2
  exit 1
fi

command -v minikube >/dev/null 2>&1 || { echo "Manca 'minikube' nel PATH." >&2; exit 1; }

CONTESTO_PRECEDENTE="$(kubectl config current-context 2>/dev/null || true)"
ripristina_contesto() {
  local ora
  ora="$(kubectl config current-context 2>/dev/null || true)"
  [ "$ora" = "$CONTESTO_PRECEDENTE" ] && return 0
  if [ -n "$CONTESTO_PRECEDENTE" ] && [ "$CONTESTO_PRECEDENTE" != "$PROFILO" ]; then
    kubectl config use-context "$CONTESTO_PRECEDENTE" >/dev/null 2>&1 || true
  fi
}
trap ripristina_contesto EXIT

if [ "$AZIONE" = "stop" ]; then
  minikube -p "$PROFILO" stop
  echo "Profilo $PROFILO fermo. Per riavviarlo: scripts/minikube-up.sh --profile $PROFILO"
  exit 0
fi

minikube -p "$PROFILO" delete
if [ "$PURGE" = "si" ]; then
  # Solo i file che scrive minikube-up.sh, poi la cartella se è rimasta vuota:
  # un --state-dir sbagliato non deve poter cancellare altro.
  if [ -d "$STATO" ]; then
    rm -f "$STATO/secrets.yaml" "$STATO/secrets.yaml.tmp" "$STATO/values-local.yaml" "$STATO/helm-notes.txt"
    rmdir "$STATO" 2>/dev/null || echo "In $STATO restano altri file: non li tocco."
  fi
  echo "Cancellati anche segreti e valori generati ($STATO)."
elif [ -d "$STATO" ]; then
  echo "Segreti e valori generati restano in $STATO: la prossima installazione li riusa."
  echo "Per cancellarli: scripts/minikube-down.sh --profile $PROFILO --purge"
fi
