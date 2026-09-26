#!/usr/bin/env bash
#
# TURN per PA Webinar su un solo nodo k3s, per i partecipanti le cui reti
# bloccano UDP verso la porta 10000 del bridge: senza TURN entrano in sala ma
# non sentono e non vedono nessuno.
#
# coturn lo rende il chart (examples/values-k3s-turn.yaml): TURN su UDP 3478,
# pubblicato sull'indirizzo del nodo da ServiceLB. Questo script prepara il
# resto:
#   - il segreto di coturn (Secret <release>-turn), generato una volta;
#   - TURNS sulla 443 condivisa con il portale: Traefik riconosce <host> nella
#     negoziazione TLS (SNI), termina il TLS con lo stesso tipo di certificato
#     del portale e inoltra TURN su TCP a coturn. coturn non tiene nessun
#     certificato, e un rinnovo non chiede di riavviarlo;
#   - una NetworkPolicy che limita l'uscita di coturn alla porta dei media
#     del bridge.
#
# Scrive nella cartella di stato (fuori dal repository, file 0600):
#   turn.env           il segreto di coturn; nato una volta, mai sovrascritto
#   values-turn.yaml   nome, segreto e reti per il chart, riscritto a ogni
#                      lancio, da passare a helm dopo examples/values-k3s-turn.yaml
#
# Non lancia helm. Dopo helm upgrade, --check prova coturn da fuori: una
# richiesta STUN su UDP 3478 e una su TLS sulla 443.
#
# Uso:  ./turn.sh --host turn.<dominio> (--tls-secret NOME | --cert-resolver NOME) [opzioni]
#       ./turn.sh --check --host turn.<dominio> [--resolve IP] [--cacert FILE]
# Da:   la postazione con il kubeconfig del cluster, o il server stesso.
#       Servono kubectl e openssl.

set -euo pipefail

PREFISSO="turn"
# shellcheck source=common.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

PORTA_TURN=3478
PORTA_BRIDGE=10000
# Nome del sottochart della conferenza, che dà le etichette ai pod di coturn.
NOME_JITSI="jitsi-meet"
RETI_EXTRA=()
SOLO_CONTROLLO="no"
IP_PUBBLICO=""

uso() {
  cat <<'FINE'
Uso: ./turn.sh --host turn.<dominio> (--tls-secret NOME | --cert-resolver NOME) [opzioni]
     ./turn.sh --check --host turn.<dominio> [--resolve IP] [--cacert FILE]

Prepara TURN per un nodo k3s: segreto di coturn, TURNS sulla 443 tramite
Traefik, limiti di uscita di coturn. coturn lo installa helm con
examples/values-k3s-turn.yaml e il values-turn.yaml che questo script scrive.

TURN
  --peer-range RETE        rete a.b.c.d/nn (o un indirizzo) verso cui coturn
                           può inoltrare i media del bridge, in più delle
                           predefinite (ripetibile). Predefinite: la rete dei
                           pod di ogni nodo e l'indirizzo interno di ogni nodo,
                           dove risponde il bridge
  --jvb-port PORTA         porta UDP dei media del bridge (predefinito: 10000)
  --public-ip IP           indirizzo con cui i partecipanti raggiungono il nodo,
                           annunciato da coturn come indirizzo del relay
                           (predefinito: --resolve, poi l'indirizzo esterno o
                           interno del nodo)
  --check                  solo il controllo da fuori, dopo helm upgrade:
                           STUN su UDP 3478 e su TLS sulla 443

FINE
  uso_opzioni_comuni
  cat <<'FINE'

Porte da aprire verso il nodo di ingresso: UDP 3478 (TURN) e TCP 443 (già
aperta per il portale). Il nome <host> punta a quel nodo, come il portale.
FINE
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) uso; exit 0 ;;
    --peer-range) RETI_EXTRA+=("${2:?manca il valore di --peer-range}"); shift 2 ;;
    --jvb-port) PORTA_BRIDGE="${2:?manca il valore di --jvb-port}"; shift 2 ;;
    --public-ip) IP_PUBBLICO="${2:?manca il valore di --public-ip}"; shift 2 ;;
    --check) SOLO_CONTROLLO="si"; shift ;;
    *)
      opzione_comune "$@" || fine "opzione sconosciuta: $1 (vedi --help)"
      shift "$CONSUMATI" ;;
  esac
done

# coturn e busybox li rende il chart: preload-images.sh list li vede già
# quando examples/values-k3s-turn.yaml è fra i file di valori.
if [ "$SOLO_IMMAGINI" = "si" ]; then
  exit 0
fi

# ── Controllo da fuori ─────────────────────────────────────────
# Una Binding Request STUN (RFC 5389) senza attributi: coturn risponde senza
# chiedere credenziali. La risposta di successo inizia con 0x0101. La
# richiesta si scrive prima in un file: su UDP deve partire in una sola
# scrittura, cioè in un solo datagramma.
richiesta_stun() {
  { printf '\000\001\000\000\041\022\244\102'; head -c 12 /dev/urandom; } > "$1"
}

controlla_da_fuori() {
  local indirizzo="$RISOLVI" risposta
  if [ -z "$indirizzo" ]; then
    indirizzo="$(getent ahostsv4 "$HOST" 2>/dev/null | awk 'NR == 1 { print $1 }' || true)"
    [ -n "$indirizzo" ] || fine "$HOST non si risolve: controlla il DNS o usa --resolve <ip>"
  fi
  local esito=0 richiesta
  richiesta="$(mktemp)"
  richiesta_stun "$richiesta"

  # UDP 3478, con i file speciali di bash: nessun programma in più.
  risposta="$( { exec 3<>"/dev/udp/$indirizzo/$PORTA_TURN" && cat "$richiesta" >&3 \
    && timeout 3 head -c 2 <&3 | od -An -tx1 | tr -d ' \n'; } 2>/dev/null || true)"
  if [ "$risposta" = "0101" ]; then
    log "UDP $PORTA_TURN su $indirizzo: coturn risponde"
  else
    log "UDP $PORTA_TURN su $indirizzo: nessuna risposta STUN. Controlla che la porta UDP $PORTA_TURN sia aperta verso il nodo e che il pod di coturn giri (kubectl -n $NAMESPACE get pods -l app.kubernetes.io/component=coturn)"
    esito=1
  fi

  # TLS sulla 443, con il nome del TURN nella negoziazione (SNI), come un
  # browser: certificato verificato, poi STUN dentro il TLS.
  local verifica=(-verify_return_error -verify_hostname "$HOST")
  [ -z "$CACERT" ] || verifica+=(-CAfile "$CACERT")
  risposta="$( { cat "$richiesta"; sleep 2; } | timeout 8 openssl s_client -quiet -connect "$indirizzo:443" \
    -servername "$HOST" "${verifica[@]}" 2>/dev/null | head -c 2 | od -An -tx1 | tr -d ' \n' || true)"
  if [ "$risposta" = "0101" ]; then
    log "TLS 443 su $indirizzo per $HOST: certificato valido, coturn risponde"
  else
    log "TLS 443 su $indirizzo per $HOST: nessuna risposta STUN. Controlla il certificato (--cacert per una CA privata), kubectl -n $NAMESPACE get ingressroutetcp $RELEASE-turns e il Service $RELEASE-turn-tcp"
    esito=1
  fi
  rm -f "$richiesta"
  return "$esito"
}

if [ "$SOLO_CONTROLLO" = "si" ]; then
  [ -n "$HOST" ] || fine "manca --host"
  nome_dns_valido "$HOST" || fine "--host non è un nome DNS valido: $HOST"
  [ -z "$RISOLVI" ] || indirizzo_ip_valido "$RISOLVI" || fine "--resolve vuole un indirizzo IPv4: $RISOLVI"
  [ -z "$CACERT" ] || [ -r "$CACERT" ] || fine "file non leggibile: $CACERT"
  richiedi_comandi openssl od timeout head
  if controlla_da_fuori; then
    log "TURN raggiungibile su UDP $PORTA_TURN e su TLS 443"
    exit 0
  fi
  exit 1
fi

controlla_opzioni_comuni
case "$PORTA_BRIDGE" in
  ''|0*|*[!0-9]*) fine "--jvb-port non valida: $PORTA_BRIDGE" ;;
esac
[ "${#PORTA_BRIDGE}" -le 5 ] && [ "$PORTA_BRIDGE" -le 65535 ] || fine "--jvb-port non valida: $PORTA_BRIDGE"
rete_valida() {
  case "$1" in
    */*)
      indirizzo_ip_valido "${1%/*}" || return 1
      case "${1#*/}" in ''|*[!0-9]*) return 1 ;; esac
      [ "${#1}" -gt 0 ] && [ "${1#*/}" -le 32 ] ;;
    *) indirizzo_ip_valido "$1" ;;
  esac
}
for i in ${RETI_EXTRA[@]+"${RETI_EXTRA[@]}"}; do
  rete_valida "$i" || fine "--peer-range vuole a.b.c.d/nn oppure a.b.c.d: $i"
done
[ -z "$IP_PUBBLICO" ] || indirizzo_ip_valido "$IP_PUBBLICO" || fine "--public-ip vuole un indirizzo IPv4: $IP_PUBBLICO"
richiedi_comandi kubectl openssl base64 od

prepara_stato
log "cartella di stato: $STATO"
controlla_cluster
k get crd ingressroutetcps.traefik.io >/dev/null 2>&1 \
  || fine "il cluster non ha le risorse di Traefik (IngressRouteTCP): serve il Traefik di k3s, installato da install-server.sh"
controlla_secret_tls

LAVORO="$(mktemp -d)"
chmod 700 "$LAVORO"
trap 'rm -rf "$LAVORO"' EXIT

# ── Segreto di coturn, generato una volta ──────────────────────
# Prosody lo usa per dare a ogni partecipante credenziali a tempo, coturn per
# verificarle. Cambiarlo non fa cadere le chiamate in corso, ma va fatto con
# le sale vuote: le credenziali già date smettono di valere.
SECRET_TURN="$RELEASE-turn"
FILE_TURN="$STATO/turn.env"
if [ -f "$FILE_TURN" ]; then
  proteggi_file "$FILE_TURN"
else
  segreto="$(chiave_secret "$SECRET_TURN" TURN_CREDENTIALS)"
  if [ -n "$segreto" ]; then
    log "turn.env mancante: lo ricostruisco dal Secret $SECRET_TURN"
  else
    segreto="$(esadecimale 32)"
  fi
  ( umask 077; printf 'TURN_CREDENTIALS=%s\n' "$segreto" > "$FILE_TURN" )
  unset segreto
fi
[ -n "$(valore_env "$FILE_TURN" TURN_CREDENTIALS)" ] || fine "manca TURN_CREDENTIALS in $FILE_TURN"
grep '^TURN_CREDENTIALS=' "$FILE_TURN" > "$LAVORO/turn-secret.env"
applica_secret_da_file "$SECRET_TURN" "$LAVORO/turn-secret.env"
rm -f "$LAVORO/turn-secret.env"

# ── Verso dove coturn può inoltrare ────────────────────────────
# coturn nega per costruzione le reti private. Il bridge risponde
# sull'indirizzo del nodo (useNodeIP, porta host) e sul proprio indirizzo di
# pod, spesso entrambi privati: si permettono la rete dei pod di ogni nodo e
# l'indirizzo interno di ogni nodo. La NetworkPolicy restringe l'uscita di
# coturn a quelle reti e alla sola porta dei media.
ip_a_numero() {
  local a b c d
  IFS=. read -r a b c d <<<"$1"
  echo $(( (a << 24) + (b << 16) + (c << 8) + d ))
}
numero_a_ip() {
  echo "$(( ($1 >> 24) & 255 )).$(( ($1 >> 16) & 255 )).$(( ($1 >> 8) & 255 )).$(( $1 & 255 ))"
}
cidr_a_intervallo() {
  local ip="${1%/*}" bit="${1#*/}" n maschera inizio ultimo
  n="$(ip_a_numero "$ip")"
  maschera=$(( (0xFFFFFFFF << (32 - bit)) & 0xFFFFFFFF ))
  inizio=$(( n & maschera ))
  ultimo=$(( inizio | (~maschera & 0xFFFFFFFF) ))
  echo "$(numero_a_ip "$inizio")-$(numero_a_ip "$ultimo")"
}
# L'indirizzo che coturn annuncia per i relay. Il chart fa ascoltare coturn
# su 0.0.0.0, e l'immagine cerca l'indirizzo pubblico con una richiesta DNS
# verso Internet, che la NetworkPolicy qui sotto non permette. Senza un
# indirizzo, coturn annuncia i relay come 0.0.0.0 e il browser li scarta: con
# UDP bloccato, TURNS non porta media. Con l'indirizzo del nodo il browser
# tiene il relay, e il bridge scopre da solo quello vero di coturn dalle prime
# verifiche di connettività.
if [ -z "$IP_PUBBLICO" ]; then
  IP_PUBBLICO="$RISOLVI"
fi
if [ -z "$IP_PUBBLICO" ]; then
  IP_PUBBLICO="$(k get nodes -o 'jsonpath={range .items[*]}{range .status.addresses[?(@.type=="ExternalIP")]}{.address}{"\n"}{end}{end}' | grep -E '^([0-9]{1,3}\.){3}[0-9]{1,3}$' | head -n 1 || true)"
fi
if [ -z "$IP_PUBBLICO" ]; then
  IP_PUBBLICO="$(k get nodes -o 'jsonpath={range .items[*]}{range .status.addresses[?(@.type=="InternalIP")]}{.address}{"\n"}{end}{end}' | grep -E '^([0-9]{1,3}\.){3}[0-9]{1,3}$' | head -n 1 || true)"
fi
[ -n "$IP_PUBBLICO" ] || fine "indirizzo del nodo non trovato: indica --public-ip"

# Le reti del bridge: la rete dei pod di ogni nodo, l'indirizzo interno di
# ogni nodo, l'indirizzo pubblico e quelle indicate con --peer-range. Servono
# due volte: a coturn come intervalli (allowedPeerIPs, perché nega per
# costruzione le reti private) e alla NetworkPolicy come reti, perché il relay
# non raggiunga altro.
RETI=()
while read -r cidr; do
  rete_valida "$cidr" && [ "${cidr#*/}" != "$cidr" ] || continue
  RETI+=("$cidr")
done < <(k get nodes -o 'jsonpath={range .items[*]}{range .spec.podCIDRs[*]}{@}{"\n"}{end}{end}')
while read -r ip; do
  indirizzo_ip_valido "$ip" || continue
  RETI+=("$ip/32")
done < <(k get nodes -o 'jsonpath={range .items[*]}{range .status.addresses[?(@.type=="InternalIP")]}{.address}{"\n"}{end}{end}')
RETI+=("$IP_PUBBLICO/32")
for r in ${RETI_EXTRA[@]+"${RETI_EXTRA[@]}"}; do
  case "$r" in */*) RETI+=("$r") ;; *) RETI+=("$r/32") ;; esac
done
# Senza doppioni, nell'ordine in cui sono state trovate.
UNICHE=()
while read -r r; do
  UNICHE+=("$r")
done < <(printf '%s\n' "${RETI[@]}" | awk '!vista[$0]++')
RETI=("${UNICHE[@]}")

PERMESSI=()
BLOCCHI=""
for r in "${RETI[@]}"; do
  intervallo="$(cidr_a_intervallo "$r")"
  # La rete scritta dal suo primo indirizzo: 10.42.0.7/24 diventa 10.42.0.0/24.
  r="${intervallo%-*}/${r#*/}"
  if [ "${r#*/}" = "32" ]; then
    PERMESSI+=("${r%/*}")
  else
    PERMESSI+=("$intervallo")
  fi
  BLOCCHI="$BLOCCHI        - ipBlock:
            cidr: $r
"
done
BLOCCHI="${BLOCCHI%
}"

# ── Oggetti nel cluster ────────────────────────────────────────
applica_modello "$MANIFESTI/turn.yaml" \
  "RELEASE=$RELEASE" "JITSI_NAME=$NOME_JITSI" "JVB_PORT=$PORTA_BRIDGE" "PEER_BLOCKS=$BLOCCHI"
if [ -n "$TLS_SECRET" ]; then
  applica_modello "$MANIFESTI/turn-route.yaml" \
    "RELEASE=$RELEASE" "HOST=$HOST" "TLS_SECRET=$TLS_SECRET"
else
  applica_modello "$MANIFESTI/turn-route-acme.yaml" \
    "RELEASE=$RELEASE" "HOST=$HOST" "CERT_RESOLVER=$CERT_RESOLVER"
fi
log "TURNS su $HOST:443 instradato a coturn da Traefik; uscita di coturn limitata al bridge, UDP $PORTA_BRIDGE"

# ── Valori per il chart ────────────────────────────────────────
FILE_VALORI="$STATO/values-turn.yaml"
( umask 077
  {
    echo "# Generato da turn.sh: TURN di questa installazione. Nessun segreto: il"
    echo "# segreto di coturn sta in turn.env e nel Secret $SECRET_TURN."
    echo "# Va passato a helm dopo examples/values-k3s-turn.yaml."
    echo "jitsi-meet:"
    echo "  turnHost: $HOST"
    echo "  coturn:"
    echo "    extraEnvs:"
    echo "      # Indirizzo annunciato per i relay (vedi values-k3s-turn.yaml)."
    echo "      REAL_EXTERNAL_IP: \"$IP_PUBBLICO\""
    echo "    staticAuth:"
    echo "      existingSecretName: $SECRET_TURN"
    echo "    allowedPeerIPs:"
    for p in "${PERMESSI[@]}"; do
      echo "      - \"$p\""
    done
    echo "  prosody:"
    echo "    extraEnvs:"
    echo "      # TURNS annunciato ai client sulla 443 di Traefik."
    echo "      TURNS_HOST: $HOST"
  } > "$FILE_VALORI" )

cat >&2 <<FINE

Fatto. TURN preparato per $HOST.
  - In helm upgrade: examples/values-k3s-turn.yaml subito dopo
    examples/values-k3s.yaml, e dopo il file del sito
      -f $FILE_VALORI
    La prima volta Prosody riparte: fallo senza eventi in corso.
  - Apri UDP $PORTA_TURN verso il nodo di ingresso; $HOST punta a quel nodo.
  - Dopo helm upgrade, prova da fuori:
      $0 --check --host $HOST [--resolve <ip>] [--cacert <ca.crt>]
    e poi una chiamata da una rete che blocca UDP.
  - Reti del bridge verso cui coturn inoltra: ${RETI[*]}
    Indirizzo annunciato per i relay: $IP_PUBBLICO (--public-ip per cambiarlo)
    Se aggiungi un nodo, rilancia questo script e helm upgrade.
FINE
