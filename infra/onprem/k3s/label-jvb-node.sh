#!/usr/bin/env bash
#
# Con tre nodi: riserva un nodo al bridge della conferenza (etichetta e taint
# `workload=jitsi-jvb`, gli stessi che values-k3s.yaml chiede al bridge) e,
# con --ingress-node, sceglie il nodo che serve 80/443.
#
# Un taint NoSchedule non sposta i pod già sul nodo: lo script li elenca e,
# con --evict, cancella quelli che un controller ricrea altrove. Non tocca i
# pod dei DaemonSet, quelli senza controller e quelli con un volume
# persistente (con local-path il volume sta sul disco di quel nodo: il pod
# ricreato resterebbe in Pending). Meglio ancora, il nodo del bridge si unisce
# già riservato: install-agent.sh --jvb.
#
# --ingress-node mette su quel nodo l'etichetta
# svccontroller.k3s.cattle.io/enablelb=true: da quel momento ServiceLB
# risponde su 80/443 solo dai nodi che la portano, e i nomi DNS vanno puntati
# lì. Con il nodeSelector di traefik-config.yaml anche Traefik va su quel
# nodo, e con externalTrafficPolicy Local il portale vede l'indirizzo vero
# dei client.
#
# Uso:  ./label-jvb-node.sh <nodo-bridge> [--ingress-node <nodo>] [--evict] [--context CTX]
#       ./label-jvb-node.sh <nodo-bridge> --undo [--ingress-node <nodo>] [--context CTX]
# Da:   la postazione con il kubeconfig del cluster (kubectl).

set -euo pipefail

CHIAVE="workload"
VALORE="jitsi-jvb"
ETICHETTA_LB="svccontroller.k3s.cattle.io/enablelb"

NODO=""
NODO_INGRESSO=""
EVICT="no"
UNDO="no"
KUBECTL=(kubectl)

log()  { printf '[nodi] %s\n' "$*" >&2; }
fine() { printf '[nodi] ERRORE: %s\n' "$*" >&2; exit 1; }
uso()  { sed -n '3,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) uso; exit 0 ;;
    --ingress-node) NODO_INGRESSO="${2:?manca il valore di --ingress-node}"; shift 2 ;;
    --evict) EVICT="si"; shift ;;
    --undo) UNDO="si"; shift ;;
    --context) KUBECTL+=(--context "${2:?manca il valore di --context}"); shift 2 ;;
    -*) fine "opzione sconosciuta: $1 (vedi --help)" ;;
    *) [ -z "$NODO" ] || fine "un solo nodo per il bridge"; NODO="$1"; shift ;;
  esac
done

[ -n "$NODO" ] || { uso; exit 1; }
command -v kubectl >/dev/null || fine "serve kubectl"
"${KUBECTL[@]}" get node "$NODO" >/dev/null || fine "nodo non trovato: $NODO"
if [ -n "$NODO_INGRESSO" ]; then
  [ "$NODO_INGRESSO" != "$NODO" ] || fine "il nodo di ingresso non può essere quello del bridge"
  "${KUBECTL[@]}" get node "$NODO_INGRESSO" >/dev/null || fine "nodo non trovato: $NODO_INGRESSO"
fi

if [ "$UNDO" = si ]; then
  "${KUBECTL[@]}" taint node "$NODO" "$CHIAVE=$VALORE:NoSchedule-" >/dev/null 2>&1 || true
  "${KUBECTL[@]}" label node "$NODO" "$CHIAVE-" >/dev/null 2>&1 || true
  log "$NODO: tolti etichetta e taint $CHIAVE=$VALORE"
  if [ -n "$NODO_INGRESSO" ]; then
    "${KUBECTL[@]}" label node "$NODO_INGRESSO" "$ETICHETTA_LB-" >/dev/null 2>&1 || true
    log "$NODO_INGRESSO: tolta $ETICHETTA_LB (ServiceLB torna su tutti i nodi)"
  fi
  exit 0
fi

"${KUBECTL[@]}" label node "$NODO" "$CHIAVE=$VALORE" --overwrite >/dev/null
"${KUBECTL[@]}" taint node "$NODO" "$CHIAVE=$VALORE:NoSchedule" --overwrite >/dev/null
log "$NODO: etichetta e taint $CHIAVE=$VALORE:NoSchedule"

if [ -n "$NODO_INGRESSO" ]; then
  "${KUBECTL[@]}" label node "$NODO_INGRESSO" "$ETICHETTA_LB=true" --overwrite >/dev/null
  log "$NODO_INGRESSO: $ETICHETTA_LB=true, ServiceLB serve 80/443 solo da qui: punta i nomi DNS su questo nodo"
fi

# Pod già sul nodo del bridge. Il separatore è `|`: con una tabulazione i
# campi vuoti si fonderebbero.
elenco="$("${KUBECTL[@]}" get pods -A --field-selector "spec.nodeName=$NODO" -o jsonpath='{range .items[*]}{.metadata.namespace}{"|"}{.metadata.name}{"|"}{.metadata.ownerReferences[0].kind}{"|"}{.status.phase}{"|"}{.spec.volumes[*].persistentVolumeClaim.claimName}{"|"}{.spec.tolerations[*].key}{"\n"}{end}')"

da_spostare=0
bloccati=0
while IFS='|' read -r ns nome proprietario fase pvc tolleranze; do
  [ -n "$nome" ] || continue
  case "$fase" in Succeeded|Failed) continue ;; esac
  case " $tolleranze " in *" $CHIAVE "*) log "resta: $ns/$nome (tollera il taint)"; continue ;; esac
  if [ "$proprietario" = DaemonSet ]; then
    log "resta: $ns/$nome (DaemonSet)"
    case "$nome" in
      svclb-*) [ -n "$NODO_INGRESSO" ] || log "  ServiceLB risponde su 80/443 anche da qui: con --ingress-node sceglie un solo nodo" ;;
    esac
    continue
  fi
  if [ -n "$pvc" ]; then
    log "ATTENZIONE: $ns/$nome usa il volume $pvc su questo nodo: non lo sposto. Con local-path i dati stanno qui; spostali (backup e ripristino) prima di dedicare il nodo al bridge"
    bloccati=$((bloccati + 1))
    continue
  fi
  if [ -z "$proprietario" ]; then
    log "ATTENZIONE: $ns/$nome non ha un controller: cancellato non tornerebbe, non lo tocco"
    bloccati=$((bloccati + 1))
    continue
  fi
  da_spostare=$((da_spostare + 1))
  if [ "$EVICT" = si ]; then
    "${KUBECTL[@]}" -n "$ns" delete pod "$nome" --wait=false >/dev/null
    log "spostato: $ns/$nome (il controller lo ricrea su un altro nodo)"
  else
    log "da spostare: $ns/$nome"
  fi
done <<< "$elenco"

if [ "$da_spostare" -gt 0 ] && [ "$EVICT" = no ]; then
  log "$da_spostare pod da spostare: rilancia con --evict per cancellarli (i controller li ricreano altrove)"
fi
[ "$bloccati" -eq 0 ] || log "$bloccati pod richiedono un intervento a mano (vedi sopra)"
log "valori del chart: nodeSelector e tolerations del blocco \"tre nodi\" in values-k3s.yaml"
