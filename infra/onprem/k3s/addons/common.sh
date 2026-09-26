# shellcheck shell=bash
# shellcheck disable=SC2034  # le variabili le leggono gli script che includono questo file
#
# Funzioni comuni a storage.sh e turn.sh: non si esegue da solo.
#
# Gli addon girano dalla postazione (o dal server) con un kubeconfig esplicito:
# non cambiano mai il contesto corrente, non scrivono nel repository e non
# mettono un segreto sulla riga di comando di nessun programma. I segreti
# nascono una volta sola in file 0600 nella cartella di stato e da lì vanno ai
# Secret di Kubernetes (kubectl legge il file, non gli argomenti).

CARTELLA_ADDON="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFESTI="$CARTELLA_ADDON/manifests"

# ── Opzioni comuni (valori predefiniti) ─────────────────────────
NAMESPACE="pa-webinar"
RELEASE="pa-webinar"
STATO=""
HOST=""
TLS_SECRET=""
CERT_RESOLVER=""
RISOLVI=""
CACERT=""
CONTROLLO="si"
SOLO_IMMAGINI="no"
KUBECTL=(kubectl)

# PREFISSO lo imposta lo script che include questo file.
log()  { printf '[%s] %s\n' "${PREFISSO:-addon}" "$*" >&2; }
fine() { printf '[%s] ERRORE: %s\n' "${PREFISSO:-addon}" "$*" >&2; exit 1; }

# Restituisce 0 se ha consumato l'opzione (e in CONSUMATI quante parole),
# 1 se non è sua.
CONSUMATI=0
opzione_comune() {
  CONSUMATI=2
  case "$1" in
    --kubeconfig)    KUBECTL+=(--kubeconfig "${2:?manca il valore di --kubeconfig}") ;;
    --context)       KUBECTL+=(--context "${2:?manca il valore di --context}") ;;
    --namespace)     NAMESPACE="${2:?manca il valore di --namespace}" ;;
    --release)       RELEASE="${2:?manca il valore di --release}" ;;
    --state-dir)     STATO="${2:?manca il valore di --state-dir}" ;;
    --host)          HOST="${2:?manca il valore di --host}" ;;
    --tls-secret)    TLS_SECRET="${2:?manca il valore di --tls-secret}" ;;
    --cert-resolver) CERT_RESOLVER="${2:?manca il valore di --cert-resolver}" ;;
    --resolve)       RISOLVI="${2:?manca il valore di --resolve}" ;;
    --cacert)        CACERT="${2:?manca il valore di --cacert}" ;;
    --skip-check)    CONTROLLO="no"; CONSUMATI=1 ;;
    --print-images)  SOLO_IMMAGINI="si"; CONSUMATI=1 ;;
    *) return 1 ;;
  esac
  return 0
}

uso_opzioni_comuni() {
  cat <<'FINE'
Cluster
  --kubeconfig FILE        kubeconfig da usare (predefinito: KUBECONFIG o quello
                           di kubectl); il contesto corrente non viene cambiato
  --context NOME           contesto del kubeconfig (predefinito: quello corrente)
  --namespace NS           namespace della release (predefinito: pa-webinar)
  --release NOME           nome della release helm (predefinito: pa-webinar)
  --state-dir DIR          cartella dei file generati, fuori dal repository
                           (predefinito: ~/.config/pa-webinar/k3s/<release>)

Nome e certificato (uno fra --tls-secret e --cert-resolver)
  --host FQDN              nome pubblico dell'addon (obbligatorio)
  --tls-secret NOME        Secret TLS del namespace il cui certificato copre --host
  --cert-resolver NOME     resolver ACME di Traefik al posto del Secret

Controllo finale
  --resolve IP             si collega a questo indirizzo per --host (DNS non pronto)
  --cacert FILE            autorità per verificare il certificato (CA privata)
  --skip-check             salta il controllo finale

Altro
  --print-images           stampa le immagini che servono all'addon ed esce
  -h, --help               questo aiuto
FINE
}

# ── Controlli sui valori ────────────────────────────────────────
# I valori finiscono nei manifesti per sostituzione di testo: si accettano
# solo le forme che Kubernetes e il DNS accettano, così nessun carattere può
# cambiare il significato del file.
# Prima i caratteri, con case (niente a capo, niente spazi), poi la forma: un
# grep riga per riga accetterebbe un valore su due righe se una sola fosse
# giusta. I controlli leggono da una here-string e non da una pipe: con
# pipefail, un grep -q che esce prima della fine farebbe fallire la pipe.
nome_dns_valido() {
  case "$1" in ''|*[!a-z0-9.-]*) return 1 ;; esac
  [ "${#1}" -le 253 ] && grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' <<<"$1"
}
nome_k8s_valido() {
  case "$1" in ''|*[!a-z0-9-]*) return 1 ;; esac
  [ "${#1}" -le 63 ] && grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' <<<"$1"
}
indirizzo_ip_valido() {
  case "$1" in ''|*[!0-9.]*) return 1 ;; esac
  grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' <<<"$1" || return 1
  local a b c d
  IFS=. read -r a b c d <<<"$1"
  [ "$a" -le 255 ] && [ "$b" -le 255 ] && [ "$c" -le 255 ] && [ "$d" -le 255 ]
}

controlla_opzioni_comuni() {
  nome_k8s_valido "$NAMESPACE" || fine "namespace non valido: $NAMESPACE"
  # 53 caratteri: i nomi degli oggetti aggiungono un suffisso alla release.
  { nome_k8s_valido "$RELEASE" && [ "${#RELEASE}" -le 53 ]; } || fine "nome della release non valido: $RELEASE"
  [ -n "$HOST" ] || fine "manca --host (per esempio --host ${PREFISSO}.webinar.example.com)"
  nome_dns_valido "$HOST" || fine "--host non è un nome DNS valido (minuscole, almeno un punto): $HOST"
  if [ -n "$TLS_SECRET" ] && [ -n "$CERT_RESOLVER" ]; then
    fine "--tls-secret e --cert-resolver si escludono: scegli il modo del certificato del portale"
  fi
  if [ -z "$TLS_SECRET" ] && [ -z "$CERT_RESOLVER" ]; then
    fine "serve un certificato che i browser accettino per $HOST: --tls-secret <Secret TLS> oppure --cert-resolver <resolver ACME di Traefik>"
  fi
  [ -z "$TLS_SECRET" ] || nome_k8s_valido "$TLS_SECRET" || fine "nome del Secret TLS non valido: $TLS_SECRET"
  if [ -n "$CERT_RESOLVER" ]; then
    case "$CERT_RESOLVER" in *[!A-Za-z0-9_-]*) fine "nome del resolver non valido: $CERT_RESOLVER" ;; esac
    [ "${#CERT_RESOLVER}" -le 63 ] || fine "nome del resolver non valido: $CERT_RESOLVER"
  fi
  [ -z "$RISOLVI" ] || indirizzo_ip_valido "$RISOLVI" || fine "--resolve vuole un indirizzo IPv4: $RISOLVI"
  [ -z "$CACERT" ] || [ -r "$CACERT" ] || fine "file non leggibile: $CACERT"
}

richiedi_comandi() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || fine "serve il comando $c"
  done
}

k() { "${KUBECTL[@]}" "$@"; }
kn() { "${KUBECTL[@]}" -n "$NAMESPACE" "$@"; }

controlla_cluster() {
  k get --raw /readyz >/dev/null 2>&1 \
    || fine "il cluster non risponde con questo kubeconfig (--kubeconfig, --context)"
  if ! k get namespace "$NAMESPACE" >/dev/null 2>&1; then
    log "creo il namespace $NAMESPACE"
    k create namespace "$NAMESPACE" >/dev/null
  fi
}

# ── Cartella di stato ───────────────────────────────────────────
# Mai dentro il repository: ci finiscono le chiavi. Il controllo viene prima
# di creare o toccare qualunque cartella.
percorso_assoluto() {
  local p="$1" resto=""
  case "$p" in /*) ;; *) p="$PWD/$p" ;; esac
  while [ ! -d "$p" ]; do
    resto="/$(basename "$p")$resto"
    p="$(dirname "$p")"
  done
  printf '%s%s\n' "$(cd "$p" && pwd -P)" "$resto"
}

prepara_stato() {
  [ -n "$STATO" ] || STATO="$HOME/.config/pa-webinar/k3s/$RELEASE"
  STATO="$(percorso_assoluto "$STATO")"
  local radice
  radice="$(git -C "$CARTELLA_ADDON" rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -n "$radice" ]; then
    radice="$(cd "$radice" && pwd -P)"
    case "$STATO/" in
      "$radice"/*) fine "la cartella di stato $STATO è dentro il repository: sceglila fuori (--state-dir)" ;;
    esac
  fi
  local casa
  casa="$(percorso_assoluto "$HOME")"
  case "$STATO" in
    /|"$casa") fine "la cartella di stato non può essere $STATO: scegline una dedicata (--state-dir)" ;;
  esac
  if [ ! -d "$STATO" ]; then
    mkdir -p "$STATO"
    chmod 700 "$STATO"
    return 0
  fi
  # Una cartella che esiste già si stringe solo se è di chi lancia lo script
  # e sta sotto ~/.config/pa-webinar: altrove potrebbe essere condivisa (/tmp,
  # una cartella di progetto), e cambiarle i permessi romperebbe altro.
  local proprietario modo
  proprietario="$(stat -c '%u' "$STATO" 2>/dev/null || stat -f '%u' "$STATO")"
  [ "$proprietario" = "$(id -u)" ] || fine "la cartella di stato $STATO non è dell'utente che lancia lo script: scegline una tua (--state-dir)"
  modo="$(stat -c '%a' "$STATO" 2>/dev/null || stat -f '%Lp' "$STATO")"
  if [ $(( 8#$modo & 8#077 )) -ne 0 ]; then
    case "$STATO/" in
      "$casa/.config/pa-webinar/"*)
        chmod 700 "$STATO"
        log "permessi di $STATO portati a 700 (erano $modo)" ;;
      *)
        fine "la cartella di stato $STATO è accessibile ad altri utenti (permessi $modo): usa una cartella solo tua (chmod 700) o un'altra --state-dir" ;;
    esac
  fi
}

# Un file di segreti con permessi larghi si stringe, e lo si dice.
proteggi_file() {
  local f="$1" modo
  modo="$(stat -c '%a' "$f" 2>/dev/null || stat -f '%Lp' "$f")"
  if [ "$modo" != "600" ]; then
    chmod 600 "$f"
    log "permessi di $f portati a 600 (erano $modo)"
  fi
}

# Valore di una chiave in un file KEY=VALUE, senza stamparlo altrove.
valore_env() {
  sed -n "s/^$2=//p" "$1" | head -n 1
}

# Esadecimale casuale di $1 byte.
esadecimale() {
  od -An -tx1 -N "$1" /dev/urandom | tr -d ' \n'
}

# Una chiave di un Secret esistente, decodificata, su stdout (vuoto se non
# c'è). Serve a ricostruire un file di stato perso senza cambiare le chiavi
# già in uso nel cluster.
chiave_secret() {
  local nome="$1" chiave="$2" v
  v="$(kn get secret "$nome" -o "go-template={{with index .data \"$chiave\"}}{{.}}{{end}}" 2>/dev/null || true)"
  [ -n "$v" ] || return 0
  printf '%s' "$v" | base64 -d 2>/dev/null || printf '%s' "$v" | base64 -D
}

# Crea o aggiorna un Secret dalle righe KEY=VALUE di un file. Il contenuto
# passa da file a kubectl, mai da un argomento.
applica_secret_da_file() {
  local nome="$1" file="$2"
  kn create secret generic "$nome" --from-env-file="$file" --dry-run=client -o yaml \
    | kn label --local -f - -o yaml \
        app.kubernetes.io/part-of=pa-webinar \
        app.kubernetes.io/managed-by=pa-webinar-addons \
        "app.kubernetes.io/instance=$RELEASE" \
    | kn apply -f - >/dev/null
}

# Sostituisce i segnaposto @@NOME@@ di un modello e applica il risultato.
# Ogni argomento dopo il file è NOME=valore; i valori sono già stati
# controllati. Un segnaposto rimasto ferma tutto prima dell'applicazione.
applica_modello() {
  local modello="$1"; shift
  local testo coppia nome valore
  testo="$(cat "$modello")"
  for coppia in "$@"; do
    nome="${coppia%%=*}"
    valore="${coppia#*=}"
    # Una occorrenza per giro, con prefisso e suffisso: ${testo//…/…} darebbe
    # a una & del valore un significato speciale da bash 5.2, e le virgolette
    # che lo evitano restano nel testo con bash 3.2.
    while [ "${testo#*"@@${nome}@@"}" != "$testo" ]; do
      testo="${testo%%"@@${nome}@@"*}${valore}${testo#*"@@${nome}@@"}"
    done
  done
  case "$testo" in
    *@@[A-Z]*@@*)
      fine "segnaposto non sostituito in $(basename "$modello"): $(grep -o '@@[A-Z_]*@@' <<<"$testo" | head -n 1)" ;;
  esac
  printf '%s\n' "$testo" | kn apply -f - >/dev/null
}

# ── Certificato ────────────────────────────────────────────────
# Con --tls-secret il certificato deve coprire --host: un nome mancante non
# ferma nulla nel cluster, si scopre solo quando il browser rifiuta la
# connessione. Si legge solo tls.crt, la parte pubblica.
controlla_secret_tls() {
  [ -n "$TLS_SECRET" ] || return 0
  richiedi_comandi openssl
  local tipo crt
  tipo="$(kn get secret "$TLS_SECRET" -o 'jsonpath={.type}' 2>/dev/null || true)"
  [ -n "$tipo" ] || fine "il Secret $TLS_SECRET non esiste nel namespace $NAMESPACE: crealo con kubectl -n $NAMESPACE create secret tls $TLS_SECRET --cert=<catena.pem> --key=<chiave.pem>"
  [ "$tipo" = "kubernetes.io/tls" ] || fine "il Secret $TLS_SECRET è di tipo $tipo, non kubernetes.io/tls"
  crt="$(chiave_secret "$TLS_SECRET" tls.crt)"
  [ -n "$crt" ] || fine "il Secret $TLS_SECRET non ha tls.crt"
  local esito
  esito="$(printf '%s\n' "$crt" | openssl x509 -noout -checkhost "$HOST" 2>/dev/null || true)"
  case "$esito" in
    *"does match"*) ;;
    *) fine "il certificato di $TLS_SECRET non copre $HOST: serve un certificato con quel nome (o un jolly *.${HOST#*.})" ;;
  esac
  if ! printf '%s\n' "$crt" | openssl x509 -noout -checkend 604800 >/dev/null 2>&1; then
    log "ATTENZIONE: il certificato di $TLS_SECRET scade entro sette giorni"
  fi
}

# Argomenti di curl per il controllo finale (--resolve, --cacert).
argomenti_curl_host() {
  CURL_HOST=(-sS --max-time 10)
  [ -z "$RISOLVI" ] || CURL_HOST+=(--resolve "$HOST:443:$RISOLVI")
  [ -z "$CACERT" ] || CURL_HOST+=(--cacert "$CACERT")
}
