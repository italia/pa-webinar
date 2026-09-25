#!/usr/bin/env bash
#
# Unisce un nodo agent al server k3s di PA Webinar (install-server.sh). Con
# --jvb il nodo nasce riservato al bridge: etichetta e taint
# `workload=jitsi-jvb` dal primo avvio, così nessun altro pod ci finisce prima
# del taint (un taint messo dopo non sposta quello che c'è già).
#
# Uso:  sudo ./install-agent.sh --server https://<ip-server>:6443 --token-file <file> [opzioni]
# Da:   una copia dell'intera cartella infra/onprem/k3s sul nodo.
#
# Il token si legge da un file leggibile solo da chi installa, che dopo
# l'unione si può cancellare. Mai come argomento, né con `sudo env
# K3S_TOKEN=…`: finirebbe nell'elenco dei processi e nella cronologia della
# shell. Resta accettato K3S_TOKEN già presente nell'ambiente di root (per
# esempio da un'automazione che lo esporta), mai scritto sulla riga di comando.

set -euo pipefail

# shellcheck source=common.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

SERVER=""
FILE_TOKEN=""
JVB="no"

uso() {
  cat <<'FINE'
Uso: sudo ./install-agent.sh --server URL --token-file FILE [opzioni]

Agent
  --server URL             API del server, es. https://<ip-server>:6443
  --token-file FILE        file con il token per gli agent, creato con
                           umask 077 (in alternativa: K3S_TOKEN già
                           nell'ambiente, mai scritto sulla riga di comando)
  --jvb                    nodo riservato al bridge: etichetta e taint
                           workload=jitsi-jvb (vedi values-k3s.yaml)

FINE
  uso_opzioni_comuni
  cat <<'FINE'

Il token per gli agent si legge sul server:
  sudo cat /var/lib/rancher/k3s/server/agent-token
Per esempio, dal nodo agent:
  (umask 077; ssh <utente>@<ip-server> sudo cat /var/lib/rancher/k3s/server/agent-token > token-agent)
FINE
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) uso; exit 0 ;;
    --server) SERVER="${2:?manca il valore di --server}"; shift 2 ;;
    --token-file) FILE_TOKEN="${2:?manca il valore di --token-file}"; shift 2 ;;
    --jvb) JVB="si"; shift ;;
    *)
      opzione_comune "$@" || fine "opzione sconosciuta: $1 (vedi --help)"
      shift "$CONSUMATI" ;;
  esac
done

richiedi_root
controlla_opzioni_comuni
[ -n "$SERVER" ] || fine "manca --server https://<ip-server>:6443"
case "$SERVER" in https://*) ;; *) fine "--server va scritto come https://<host>:6443" ;; esac
TOKEN="${K3S_TOKEN:-}"
if [ -n "$FILE_TOKEN" ]; then
  [ -r "$FILE_TOKEN" ] || fine "file del token non leggibile: $FILE_TOKEN"
  case "$(stat -c '%a' "$FILE_TOKEN" 2>/dev/null)" in
    *00) ;;
    *) log "ATTENZIONE: $FILE_TOKEN è leggibile da altri utenti (chmod 600)" ;;
  esac
  TOKEN="$(tr -d '[:space:]' < "$FILE_TOKEN")"
fi
[ -n "$TOKEN" ] || fine "manca il token: --token-file <file> (vedi --help)"

if [ "$JVB" = si ]; then
  ETICHETTE+=("workload=jitsi-jvb")
  TAINT+=("workload=jitsi-jvb:NoSchedule")
fi

rileva_node_ip
# Con --proxy-scope all anche il traffico verso il server passerebbe dal
# proxy: il server va in NO_PROXY.
HOST_EXTRA_NO_PROXY="$(printf '%s' "$SERVER" | sed -E 's#^https://##; s#:[0-9]+/?$##; s#/.*$##')"
log "agent k3s su $NODE_IP, server $SERVER"
[ "$JVB" = si ] && log "nodo riservato al bridge (workload=jitsi-jvb)"

LAVORO="$(mktemp -d)"
trap 'rm -rf "$LAVORO"' EXIT

prepara_artefatti "$LAVORO"
installa_sysctl
installa_registri
scrivi_configurazione ""

lancia_installer agent "$LAVORO" "K3S_URL=$SERVER" "K3S_TOKEN=$TOKEN"

if [ "$ATTESA" = si ]; then
  for _ in $(seq 1 30); do
    systemctl is-active --quiet k3s-agent && break
    sleep 2
  done
  systemctl is-active --quiet k3s-agent || fine "k3s-agent non è attivo: journalctl -u k3s-agent"
  log "k3s-agent attivo"
fi

cat <<FINE

Fatto. Dalla postazione con il kubeconfig controlla che il nodo sia Ready:
  kubectl get nodes -o wide
Il file del token non serve più: k3s ne tiene una copia leggibile solo da
root. Se l'hai copiato sul nodo, cancellalo.
FINE
if [ "$JVB" = si ]; then
  cat <<'FINE'
Il bridge va su questo nodo solo con nodeSelector e tolerations del blocco
"tre nodi" di values-k3s.yaml. Apri la porta 10000/udp di questo nodo ai client.
FINE
fi
