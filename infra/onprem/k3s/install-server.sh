#!/usr/bin/env bash
#
# Installa il server k3s di PA Webinar: con un nodo solo è l'intero cluster,
# con tre è il piano di controllo a cui si uniscono gli agent
# (install-agent.sh). Oltre a k3s, alla versione provata, prepara quello che
# il chart dà per scontato:
#   - Traefik che vede l'indirizzo vero dei client (traefik-config.yaml), da
#     cui dipendono i limiti per IP del portale;
#   - buffer UDP del bridge (90-pa-webinar-jvb.conf);
#   - proxy solo per prelevare le immagini, oppure un mirror
#     (registries.yaml), oppure nessun download (--airgap-dir);
#   - Secret cifrati nel datastore di k3s.
# Rilanciato con le stesse opzioni, riscrive la configurazione e riavvia k3s:
# le modifiche a traefik-config.yaml si fanno nella copia accanto allo script,
# non in quella installata, che a ogni lancio viene sostituita.
#
# Uso:  sudo ./install-server.sh [opzioni]          (--help per l'elenco)
# Da:   una copia dell'intera cartella infra/onprem/k3s sul nodo.
#
# Cosa NON fa: non installa il chart (si installa con helm da una postazione
# con il kubeconfig), non apre porte nel firewall, non crea un cluster ad
# alta affidabilità (un solo server, datastore SQLite).

set -euo pipefail

# shellcheck source=common.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

TLS_SAN=()
CONFIG_TRAEFIK="$CARTELLA_SCRIPT/traefik-config.yaml"
DEST_TRAEFIK=/var/lib/rancher/k3s/server/manifests/traefik-config.yaml
ETICHETTA_LB="svccontroller.k3s.cattle.io/enablelb"
# Token con cui si uniscono gli agent, distinto da quello del server.
FILE_TOKEN_AGENT=/etc/rancher/k3s/pa-webinar-agent-token

uso() {
  cat <<'FINE'
Uso: sudo ./install-server.sh [opzioni]

Server
  --tls-san NOME           nome o indirizzo in più nel certificato dell'API
                           (ripetibile); l'IP del nodo c'è già
  --traefik-config FILE    HelmChartConfig di Traefik da installare
                           (predefinito: traefik-config.yaml accanto allo script)
  --no-traefik-config      lasciare Traefik come lo configura k3s

FINE
  uso_opzioni_comuni
  cat <<'FINE'

Il token per gli agent: /var/lib/rancher/k3s/server/agent-token (solo root).
Con il nodeSelector di traefik-config.yaml attivo e un solo nodo, oppure con
questo nodo come nodo di ingresso, aggiungi
  --node-label svccontroller.k3s.cattle.io/enablelb=true
Esempio dietro un proxy:
  sudo ./install-server.sh --proxy http://<proxy>:<porta> --no-proxy <rete-dei-nodi>
FINE
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) uso; exit 0 ;;
    --tls-san) TLS_SAN+=("${2:?manca il valore di --tls-san}"); shift 2 ;;
    --traefik-config) CONFIG_TRAEFIK="${2:?manca il valore di --traefik-config}"; shift 2 ;;
    --no-traefik-config) CONFIG_TRAEFIK=""; shift ;;
    *)
      opzione_comune "$@" || fine "opzione sconosciuta: $1 (vedi --help)"
      shift "$CONSUMATI" ;;
  esac
done

richiedi_root
controlla_opzioni_comuni
[ -z "$CONFIG_TRAEFIK" ] || [ -r "$CONFIG_TRAEFIK" ] || fine "file non leggibile: $CONFIG_TRAEFIK"

# Il nodeSelector di traefik-config.yaml porta Traefik sui nodi con
# l'etichetta di ServiceLB: se nessun nodo ce l'ha, Traefik resta in Pending
# e il portale non risponde. Si controlla prima di toccare il nodo.
controlla_selettore_traefik() {
  [ -n "$CONFIG_TRAEFIK" ] || return 0
  grep -qE "^[[:space:]]+$ETICHETTA_LB:" "$CONFIG_TRAEFIK" || return 0
  local e
  for e in ${ETICHETTE[@]+"${ETICHETTE[@]}"}; do
    [ "$e" = "$ETICHETTA_LB=true" ] && return 0
  done
  if [ -x /usr/local/bin/k3s ] \
    && [ -n "$(/usr/local/bin/k3s kubectl get nodes -l "$ETICHETTA_LB=true" -o name 2>/dev/null || true)" ]; then
    return 0
  fi
  fine "traefik-config.yaml porta Traefik sui nodi con $ETICHETTA_LB=true, e nessun nodo ce l'ha: Traefik resterebbe in Pending. Aggiungi --node-label $ETICHETTA_LB=true (questo nodo serve 80 e 443), oppure riattiva il nodeSelector dopo label-jvb-node.sh --ingress-node"
}
controlla_selettore_traefik
rileva_node_ip
log "server k3s su $NODE_IP"

LAVORO="$(mktemp -d)"
trap 'rm -rf "$LAVORO"' EXIT

prepara_artefatti "$LAVORO"
installa_sysctl
installa_registri

# Configurazione del server. `secrets-encryption` cifra i Secret nel
# datastore di k3s, dove finiscono le chiavi dell'applicazione.
config=""
config+="tls-san:"$'\n'"  - \"$NODE_IP\""$'\n'
for san in ${TLS_SAN[@]+"${TLS_SAN[@]}"}; do config+="  - \"$san\""$'\n'; done
config+="cluster-cidr: \"$CLUSTER_CIDR\""$'\n'
config+="service-cidr: \"$SERVICE_CIDR\""$'\n'
config+="secrets-encryption: true"$'\n'

# Gli agent si uniscono con un token loro: chi lo ha può aggiungere un nodo
# agent, non un altro server, che leggerebbe il datastore e le chiavi del
# cluster. Si crea solo alla prima installazione: il token di un cluster che
# esiste già non cambia rilanciando lo script.
if [ ! -e /var/lib/rancher/k3s/server/token ] && [ ! -e "$FILE_TOKEN_AGENT" ]; then
  mkdir -p "$(dirname "$FILE_TOKEN_AGENT")"
  ( umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$FILE_TOKEN_AGENT" )
  log "token per gli agent generato"
fi
[ -e "$FILE_TOKEN_AGENT" ] && config+="agent-token-file: \"$FILE_TOKEN_AGENT\""$'\n'
scrivi_configurazione "$config"

# La HelmChartConfig va a posto prima del primo avvio: così Traefik nasce già
# con externalTrafficPolicy Local, senza una seconda installazione. A ogni
# lancio la copia installata viene sostituita con quella accanto allo script;
# se era stata modificata a mano, la versione precedente resta da parte.
if [ -n "$CONFIG_TRAEFIK" ]; then
  mkdir -p "$(dirname "$DEST_TRAEFIK")"
  if [ -f "$DEST_TRAEFIK" ] && ! cmp -s "$CONFIG_TRAEFIK" "$DEST_TRAEFIK"; then
    cp -p "$DEST_TRAEFIK" /var/lib/rancher/k3s/server/traefik-config.yaml.precedente
    log "ATTENZIONE: la configurazione di Traefik installata era diversa da $CONFIG_TRAEFIK, che la sostituisce. La precedente è in /var/lib/rancher/k3s/server/traefik-config.yaml.precedente: le modifiche vanno fatte nella copia accanto allo script"
  fi
  install -m 0600 "$CONFIG_TRAEFIK" "$DEST_TRAEFIK"
  log "configurazione di Traefik: $DEST_TRAEFIK"
fi

# Il token viene dall'ambiente, se c'è (K3S_TOKEN); altrimenti lo genera k3s.
extra=()
[ -n "${K3S_TOKEN:-}" ] && extra+=("K3S_TOKEN=$K3S_TOKEN")
lancia_installer server "$LAVORO" ${extra[@]+"${extra[@]}"}

aspetta_nodo || exit 1

if [ "$ATTESA" = si ]; then
  # Traefik lo installa un Job di k3s poco dopo l'avvio: senza immagini
  # (proxy sbagliato, mirror irraggiungibile) si ferma qui.
  log "attendo Traefik e CoreDNS"
  for _ in $(seq 1 60); do
    /usr/local/bin/k3s kubectl -n kube-system get deploy traefik >/dev/null 2>&1 && break
    sleep 5
  done
  /usr/local/bin/k3s kubectl -n kube-system rollout status deploy/coredns --timeout=5m
  /usr/local/bin/k3s kubectl -n kube-system rollout status deploy/traefik --timeout=5m \
    || fine "Traefik non parte: kubectl -n kube-system get pods; con un proxy controlla --no-proxy"
  politica="$(/usr/local/bin/k3s kubectl -n kube-system get svc traefik -o jsonpath='{.spec.externalTrafficPolicy}')"
  log "Service traefik: externalTrafficPolicy=$politica"
fi

cat <<FINE

Fatto. Prossimi passi:
  - kubeconfig per la postazione da cui si usa helm (poi tieni la porta 6443
    chiusa verso Internet):
      sudo cat /etc/rancher/k3s/k3s.yaml | sed 's#https://127.0.0.1:6443#https://$NODE_IP:6443#'
  - immagini del chart: preload-images.sh (vedi README.md)
  - con tre nodi, il token per install-agent.sh --token-file (solo per gli
    agent, non per unire altri server):
      sudo cat /var/lib/rancher/k3s/server/agent-token
FINE
