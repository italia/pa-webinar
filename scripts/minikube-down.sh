#!/usr/bin/env bash
#
# Spegne o cancella il profilo minikube creato da scripts/minikube-up.sh.
#
# Uso:  scripts/minikube-down.sh [--profile NOME] [--stop] [--purge] [--purge-images] [--yes]
#   (nessuna opzione)  cancella il profilo: cluster, database e immagini caricate
#                      nel nodo. Chiede conferma (il nome del profilo)
#   --stop             lo ferma soltanto; minikube-up.sh lo riavvia com'era.
#                      Non chiede conferma
#   --purge            cancella anche segreti, autorità locale, certificati e
#                      valori generati (cartella di stato): la prossima
#                      installazione ne genera di nuovi. Toglie l'autorità
#                      "PA Webinar minikube (<profilo>)" dal database NSS del
#                      browser (quella aggiunta da minikube-up.sh --trust-ca)
#                      e, come --purge-images, le immagini costruite
#   --purge-images     toglie dal docker di questa macchina le immagini
#                      pa-webinar:local-<profilo> costruite da minikube-up.sh
#                      --images local (2 GB e più)
#   --state-dir DIR    la cartella di stato, se a minikube-up.sh ne hai data una
#   --nssdb DIR        il database NSS, se a minikube-up.sh ne hai dato un altro
#                      (predefinito: ~/.pki/nssdb)
#   --yes, -y          nessuna domanda di conferma (come pa-webinar-down.sh)
#
# Il contesto di kubectl attivo prima del lancio resta quello; se era proprio
# il profilo cancellato, nessun contesto resta attivo.

set -euo pipefail

PROFILO="pa-webinar"
AZIONE="delete"
PURGE="no"
PURGE_IMMAGINI="no"
SI="no"
STATO=""
NSSDB="$HOME/.pki/nssdb"

errore() { printf '\n✗ %s\n' "$*" >&2; exit 1; }
uso() { awk 'NR < 3 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILO="${2:?}"; shift 2 ;;
    --stop) AZIONE="stop"; shift ;;
    --purge) PURGE="si"; PURGE_IMMAGINI="si"; shift ;;
    --purge-images) PURGE_IMMAGINI="si"; shift ;;
    --state-dir) STATO="${2:?}"; shift 2 ;;
    --nssdb) NSSDB="${2:?}"; shift 2 ;;
    --yes|-y) SI="si"; shift ;;
    -h|--help) uso; exit 0 ;;
    *) uso >&2; errore "Opzione sconosciuta: $1" ;;
  esac
done
STATO="${STATO:-${XDG_CONFIG_HOME:-$HOME/.config}/pa-webinar/minikube/$PROFILO}"

if [ "$AZIONE" = "stop" ] && [ "$PURGE_IMMAGINI" = "si" ]; then
  errore "--purge e --purge-images valgono solo per cancellare, non con --stop: --purge lascerebbe un database di cui non si conoscono più le password."
fi

command -v minikube >/dev/null 2>&1 || errore "Manca 'minikube' nel PATH."

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

# Cancellare il profilo cancella il database: si chiede di scriverne il nome,
# come pa-webinar-down.sh con il nome del portale.
if [ "$SI" != "si" ]; then
  [ -t 0 ] || errore "Senza terminale serve --yes."
  printf '\n   Da cancellare   il profilo minikube %s: cluster, database, immagini caricate nel nodo\n' "$PROFILO"
  if [ "$PURGE" = "si" ]; then
    printf '                   la cartella di stato %s (segreti, autorità locale, certificati)\n' "$STATO"
  fi
  if [ "$PURGE_IMMAGINI" = "si" ]; then
    printf '                   le immagini pa-webinar:local-<profilo> nel docker di questa macchina\n'
  fi
  printf '\nPer confermare scrivi il nome del profilo (%s): ' "$PROFILO"
  read -r risposta
  [ "$risposta" = "$PROFILO" ] || errore "Annullato: nessuna modifica."
fi

minikube -p "$PROFILO" delete
if [ "$PURGE" = "si" ]; then
  # Solo i file che scrive minikube-up.sh, poi la cartella se è rimasta vuota:
  # un --state-dir sbagliato non deve poter cancellare altro.
  if [ -d "$STATO" ]; then
    rm -f "$STATO/secrets.yaml" "$STATO/secrets.yaml.tmp" "$STATO/values-local.yaml" "$STATO/helm-notes.txt" \
          "$STATO/build.log" "$STATO/migrazioni.impronta"
    # L'autorità locale e i certificati dei nomi.
    rm -f "$STATO/ca.key" "$STATO/ca.crt"
    if [ -d "$STATO/tls" ]; then
      rm -f "$STATO/tls/app.key" "$STATO/tls/app.crt" "$STATO/tls/jitsi.key" "$STATO/tls/jitsi.crt" \
            "$STATO/tls/mail.key" "$STATO/tls/mail.crt"
      rmdir "$STATO/tls" 2>/dev/null || true
    fi
    rmdir "$STATO" 2>/dev/null || echo "In $STATO restano altri file: non li tocco."
  fi
  echo "Cancellati anche segreti, certificati e valori generati ($STATO)."
  # L'autorità del profilo fra quelle fidate dei browser basati su Chromium:
  # la sua chiave non c'è più, e la prossima installazione ne crea un'altra.
  NOME_CA="PA Webinar minikube ($PROFILO)"
  if [ -f "$NSSDB/cert9.db" ] && command -v certutil >/dev/null 2>&1; then
    tolta="no"
    for _ in 1 2 3 4 5; do
      certutil -d "sql:$NSSDB" -L -n "$NOME_CA" >/dev/null 2>&1 || break
      certutil -d "sql:$NSSDB" -D -n "$NOME_CA" >/dev/null 2>&1 || break
      tolta="si"
    done
    [ "$tolta" = "si" ] && echo "Tolta \"$NOME_CA\" dalle autorità fidate in $NSSDB."
  elif [ -f "$NSSDB/cert9.db" ]; then
    echo "Manca certutil: se avevi aggiunto \"$NOME_CA\" a $NSSDB, toglila con"
    echo "  certutil -d sql:$NSSDB -D -n \"$NOME_CA\""
  fi
  echo "Se l'avevi resa fidata anche in Firefox o nel sistema, toglila anche lì: nome comune"
  echo "\"PA Webinar minikube CA ($PROFILO, <data>)\"."
elif [ -d "$STATO" ]; then
  echo "Segreti e valori generati restano in $STATO: la prossima installazione li riusa."
  echo "Per cancellarli: scripts/minikube-down.sh --profile $PROFILO --purge"
fi
# Le immagini costruite per questo profilo sulla macchina (minikube-up.sh
# --images local): 2 GB e più, di nessuna utilità senza il profilo.
tag="local-$(printf '%s' "$PROFILO" | tr -c 'A-Za-z0-9_.-' '-')"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  for img in "pa-webinar:$tag" "pa-webinar:$tag-migrate"; do
    docker image inspect "$img" >/dev/null 2>&1 || continue
    if [ "$PURGE_IMMAGINI" = "si" ]; then
      docker image rm "$img" >/dev/null && echo "Tolta l'immagine $img."
    else
      echo "Resta l'immagine $img: --purge-images per toglierla."
    fi
  done
fi
