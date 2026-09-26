#!/usr/bin/env bash
#
# Installa PA Webinar su un server k3s, dalla postazione dell'amministratore
# (--host utente@server, via ssh) o sul server stesso (--local): controlla il
# server, installa k3s, porta le immagini, genera i segreti una volta sola e
# crea i Secret di Kubernetes, scrive i valori del sito dai due nomi DNS,
# installa il chart e controlla che portale e conferenza rispondano.
# Rilanciato, aggiorna la stessa installazione con gli stessi segreti: le
# opzioni del primo lancio sono ricordate, basta --portal.
#
# Uso:  infra/onprem/k3s/pa-webinar-up.sh --portal FQDN --meet FQDN --host UTENTE@SERVER [opzioni]
#       (--help per l'elenco)
# Da:   il checkout del repository al tag del rilascio da installare: chart,
#       file di esempio e immagini vengono tutti da lì.
#
# Cosa NON fa: non tocca il contesto di kubectl né ~/.kube/config (il
# kubeconfig del server resta nella cartella di stato), non crea eventi o
# utenti nel portale, non apre porte nel firewall, non configura il DNS.

set -euo pipefail

CARTELLA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RADICE="$(cd "$CARTELLA/../../.." && pwd)"
CHART="$RADICE/infra/helm/pa-webinar"

# Versione di k3s provata, tag dal checkout, costruzione delle immagini.
# shellcheck source-path=SCRIPTDIR source=common.sh
. "$CARTELLA/common.sh"

# ── Valori predefiniti ──────────────────────────────────────────
# Il minimo documentato per un server solo (docs/install/k3s.md): 4 vCPU,
# 8 GiB, 40 GB di disco. La memoria che il sistema vede è un po' meno di
# quella della VM, il disco un po' meno di quello del volume.
CPU_MIN=4
MEMORIA_MIN_MB=7500
DISCO_MIN_GB=35
DISCO_LIBERO_MIN_GB=10
HELM_MIN="3.16.3"
MAILPIT_IMMAGINE="docker.io/axllent/mailpit:v1.31.2"
RESOLVER_ACME="pa-webinar"
ATTESA="15m"

uso() {
  cat <<'FINE'
Uso: infra/onprem/k3s/pa-webinar-up.sh --portal FQDN --meet FQDN (--host UTENTE@SERVER | --local) [opzioni]

Installa PA Webinar su un server solo con k3s: una piccola installazione di
produzione, senza alta affidabilità (vedi docs/install/k3s.md). Rilanciato con
lo stesso --portal aggiorna la stessa installazione, con gli stessi segreti e
le opzioni già date (quelle ripassate valgono dal lancio in poi).

Server
  --host UTENTE@SERVER      il server, via ssh (sudo senza password, o root)
  --local                   lo script gira sul server stesso (sudo)
  --ssh-key FILE            chiave ssh (predefinita: quella di ssh)
  --ssh-port N              porta ssh
  --ssh-option OPZIONE      opzione -o di ssh, ripetibile (es. StrictHostKeyChecking=accept-new)
  --tunnel-port N           porta di questa macchina per il tunnel ssh verso
                            l'API di k3s, scritta in kubeconfig.tunnel
                            (predefinito: 6443)

Nomi e rete
  --portal FQDN             nome del portale (es. webinar.ente.it)
  --meet FQDN               nome della conferenza (es. meet.ente.it); tutte le
                            chiavi del chart si ricavano da questi due nomi
  --public-ip IP            indirizzo pubblico del server, se diverso da quello
                            della sua scheda (NAT 1:1 che conserva la porta UDP
                            10000). Predefinito: l'indirizzo della scheda; se è
                            privato, o se i nomi DNS puntano altrove, avvisa.
                            --public-ip none torna al predefinito
  --name NOME               nome dell'installazione, per la cartella di stato
                            (predefinito: il nome del portale)
  --state-dir DIR           segreti, certificati e valori generati, fuori dal
                            repository (predefinito: ~/.config/pa-webinar/k3s/<nome>)
  --namespace NOME          (predefinito: pa-webinar)
  --release NOME            release Helm (predefinito: pa-webinar)

Certificati
  --tls acme                Traefik li chiede a Let's Encrypt (TLS-ALPN-01 sulla
                            porta 443) e li rinnova; i nomi DNS devono già
                            puntare al server, e la porta 443 essere
                            raggiungibile dal server ACME (da Internet, con
                            Let's Encrypt)
    --acme-email EMAIL        indirizzo di contatto (obbligatorio con acme)
    --acme-server URL         un altro server ACME (staging di Let's Encrypt,
                              l'ACME dell'ente)
    --acme-server-ca FILE     autorità del certificato HTTPS del server ACME
  --tls private-ca          un'autorità locale di questa installazione firma i
                            certificati (valutazione, reti interne): i browser
                            devono fidarsene (istruzioni alla fine)
  --tls own                 i certificati dell'ente
    --cert FILE --key FILE    catena e chiave, ripetibili a coppie; ogni nome
                              (portale, conferenza, storage, TURN) deve essere
                              coperto da uno dei certificati (anche wildcard)
    --cert-dir DIR            in alternativa: una cartella con coppie
                              <nome>.crt (o .pem) e <nome>.key
  --ca-file FILE            autorità in più di cui il portale si fida (relay
                            SMTP o certificati firmati dalla CA dell'ente); resta
                            per i lanci successivi (copia extra-ca.crt nella
                            cartella di stato: cancellala per toglierla)
  Rilanciato senza --cert, il modo own tiene i Secret TLS già nel cluster.

Immagini dell'applicazione
  (predefinito)             sul tag di rilascio vX.Y.Z le immagini pubblicate
                            X.Y.Z e vX.Y.Z-migrate, se il registro le dà senza
                            credenziali; altrimenti, e su ogni altro commit,
                            come --images local
  --images registry         il server le preleva da ghcr.io (Internet, --proxy
                            o un mirror in --registries)
  --images local            docker build da questo checkout, poi importate nel
                            server via ssh (le altre immagini il server le
                            preleva da sé)
  --images archive          un archivio di preload-images.sh (save o build),
    --archive FILE            con tutte le immagini: per server senza Internet
  --tag TAG                 il tag delle immagini, se non si ricava dal checkout
                            (X.Y.Z, o local-<commit> per un archivio costruito
                            altrove da quel commit): chart e immagini devono
                            venire dallo stesso commit

Email
  --smtp-file FILE          file 0600 con righe SMTP_HOST=, SMTP_PORT=,
                            SMTP_SECURE=, SMTP_USER=, SMTP_PASSWORD=, SMTP_FROM=
                            e facoltativo SMTP_FROM_NAME=: il relay vero
  --mailpit                 una casella di prova nel cluster al posto del relay
                            (le email non escono; si leggono con port-forward)
  --no-mailpit              toglie la casella di prova

Componenti facoltativi
  --storage garage          object storage nel cluster (materiali, video), con
                            un terzo nome DNS: --storage-host (predefinito
                            s3.<portale>). --storage none per non usarlo
  --turn                    TURN per chi ha la porta UDP 10000 bloccata, con un
                            quarto nome: --turn-host (predefinito
                            turn.<portale>). --no-turn per toglierlo
  --backup                  copia notturna del database su un volume del
                            server (--no-backup per toglierla). Va poi copiata
                            fuori dal server: il riepilogo dice dove

Nodo (passate a install-server.sh)
  --proxy URL               proxy HTTP(S) per scaricare k3s e le immagini
                            (--proxy none per toglierlo)
  --no-proxy LISTA          voci in più per NO_PROXY (la rete del server)
  --proxy-scope AMBITO      containerd (predefinito) o all
  --registries FILE         mirror dei registri (registries.yaml)
  --airgap-dir DIR          k3s senza download (preload-images.sh fetch-k3s)
  --node-ip IP              indirizzo del nodo, su server con più schede
  --reinstall-k3s           rilancia install-server.sh anche se nulla è cambiato

Esecuzione
  --timeout DURATA          attesa massima di helm e dei pod (predefinito: 15m)
  --dry-run                 controlla il server e mostra cosa farebbe, senza
                            cambiare niente
  --yes                     nessuna domanda di conferma
  --ignore-preflight        prosegue anche sotto il minimo di CPU, memoria e
                            disco, o con le porte occupate
  --recover-secrets         ricostruisce il file dei segreti dai Secret del
                            cluster, se è andato perso
  --verify-call             alla fine, e a ogni lancio successivo, due
                            partecipanti headless provano una chiamata
                            (scripts/verify-install.sh --call). Servono node 20
                            o più recente, Playwright (npm ci nella radice del
                            repository) e un Chromium (npx playwright install
                            chromium, o --verify-browser): si controllano
                            all'inizio, anche con --dry-run
    --verify-browser FILE     Chrome o Chromium per la prova (--verify-browser
                              none torna a quello di Playwright)
  --no-verify-call          toglie la prova di chiamata dai lanci successivi
  -h, --help                questo aiuto

Opzioni ricordate
  Le opzioni si ricordano in install.conf, nella cartella di stato: al lancio
  successivo basta --portal, e un'opzione ripassata vale da lì in poi. Valgono
  solo per il lancio in cui le passi --tag, --timeout, --dry-run, --yes,
  --ignore-preflight, --recover-secrets e --reinstall-k3s. I file di --cert,
  --key, --cert-dir, --smtp-file e --ca-file si copiano nel cluster o nella
  cartella di stato, e restano finché non ne passi altri.

Esempi
  infra/onprem/k3s/pa-webinar-up.sh --host admin@203.0.113.10 \
    --portal webinar.ente.it --meet meet.ente.it \
    --tls acme --acme-email it@ente.it --smtp-file ~/smtp-ente.env --backup
  infra/onprem/k3s/pa-webinar-up.sh --portal webinar.ente.it      # aggiornamento
FINE
}

errore() {
  printf '\n✗ %s\n' "$*" >&2
  exit 1
}
passo() { printf '\n── %s\n' "$*"; }
nota() { printf '   %s\n' "$*"; }
avviso() { printf '   ATTENZIONE: %s\n' "$*"; AVVISI+=("$*"); }
AVVISI=()

# ── Argomenti ───────────────────────────────────────────────────
# Le opzioni date sulla riga di comando stanno in O_*; quelle che mancano si
# prendono dal file delle opzioni del lancio precedente (install.conf).
O_HOST=""; O_LOCALE=""; O_SSH_CHIAVE=""; O_SSH_PORTA=""; O_SSH_OPZIONI=()
O_PORTALE=""; O_CONFERENZA=""; O_IP_PUBBLICO=""; O_NOME=""; O_STATO=""
O_NAMESPACE=""; O_RELEASE=""
O_TLS=""; O_EMAIL_ACME=""; O_SERVER_ACME=""; O_CA_SERVER_ACME=""
CERTIFICATI=(); CHIAVI=(); CARTELLA_CERT=""; O_CA_EXTRA=""
O_IMMAGINI=""; O_ARCHIVIO=""; TAG_SCELTO=""
O_MAILPIT=""; FILE_SMTP=""
O_STORAGE=""; O_HOST_STORAGE=""; O_TURN=""; O_HOST_TURN=""; O_BACKUP=""
O_PROXY=""; O_NO_PROXY=""; O_AMBITO_PROXY=""; O_REGISTRI=""; O_AIRGAP=""; O_NODE_IP=""
O_VERIFICA=""; O_BROWSER_PROVA=""; O_PORTA_TUNNEL=""
REINSTALLA_K3S="no"; DRY_RUN="no"; SI="no"; IGNORA_PREFLIGHT="no"; RECUPERA="no"

# Percorso assoluto di un file che deve esistere.
assoluto() {
  local f="$1"
  [ -e "$f" ] || errore "Non trovo $f."
  printf '%s/%s\n' "$(cd "$(dirname "$f")" && pwd -P)" "$(basename "$f")"
}

# Le O_* si leggono per nome, in scegli(): shellcheck non le vede usate.
# shellcheck disable=SC2034
while [ $# -gt 0 ]; do
  case "$1" in
    --host) O_HOST="${2:?}"; shift 2 ;;
    --local) O_LOCALE="si"; shift ;;
    --ssh-key) O_SSH_CHIAVE="$(assoluto "${2:?}")"; shift 2 ;;
    --ssh-port) O_SSH_PORTA="${2:?}"; shift 2 ;;
    --ssh-option) O_SSH_OPZIONI+=("${2:?}"); shift 2 ;;
    --tunnel-port) O_PORTA_TUNNEL="${2:?}"; shift 2 ;;
    --portal) O_PORTALE="${2:?}"; shift 2 ;;
    --meet) O_CONFERENZA="${2:?}"; shift 2 ;;
    --public-ip) O_IP_PUBBLICO="${2:?}"; shift 2 ;;
    --name) O_NOME="${2:?}"; shift 2 ;;
    --state-dir) O_STATO="${2:?}"; shift 2 ;;
    --namespace) O_NAMESPACE="${2:?}"; shift 2 ;;
    --release) O_RELEASE="${2:?}"; shift 2 ;;
    --tls) O_TLS="${2:?}"; shift 2 ;;
    --acme-email) O_EMAIL_ACME="${2:?}"; shift 2 ;;
    --acme-server) O_SERVER_ACME="${2:?}"; shift 2 ;;
    --acme-server-ca) O_CA_SERVER_ACME="$(assoluto "${2:?}")"; shift 2 ;;
    --cert) CERTIFICATI+=("$(assoluto "${2:?}")"); shift 2 ;;
    --key) CHIAVI+=("$(assoluto "${2:?}")"); shift 2 ;;
    --cert-dir) CARTELLA_CERT="$(assoluto "${2:?}")"; shift 2 ;;
    --ca-file) O_CA_EXTRA="$(assoluto "${2:?}")"; shift 2 ;;
    --images) O_IMMAGINI="${2:?}"; shift 2 ;;
    --archive) O_ARCHIVIO="$(assoluto "${2:?}")"; shift 2 ;;
    --tag) TAG_SCELTO="${2:?}"; shift 2 ;;
    --smtp-file) FILE_SMTP="$(assoluto "${2:?}")"; shift 2 ;;
    --mailpit) O_MAILPIT="si"; shift ;;
    --no-mailpit) O_MAILPIT="no"; shift ;;
    --storage) O_STORAGE="${2:?}"; shift 2 ;;
    --storage-host) O_HOST_STORAGE="${2:?}"; shift 2 ;;
    --turn) O_TURN="si"; shift ;;
    --no-turn) O_TURN="no"; shift ;;
    --turn-host) O_HOST_TURN="${2:?}"; shift 2 ;;
    --backup) O_BACKUP="si"; shift ;;
    --no-backup) O_BACKUP="no"; shift ;;
    --proxy) O_PROXY="${2:?}"; shift 2 ;;
    --no-proxy) O_NO_PROXY="${2:?}"; shift 2 ;;
    --proxy-scope) O_AMBITO_PROXY="${2:?}"; shift 2 ;;
    --registries) O_REGISTRI="$(assoluto "${2:?}")"; shift 2 ;;
    --airgap-dir) O_AIRGAP="$(assoluto "${2:?}")"; shift 2 ;;
    --node-ip) O_NODE_IP="${2:?}"; shift 2 ;;
    --reinstall-k3s) REINSTALLA_K3S="si"; shift ;;
    --timeout) ATTESA="${2:?}"; shift 2 ;;
    --dry-run) DRY_RUN="si"; shift ;;
    --yes|-y) SI="si"; shift ;;
    --ignore-preflight) IGNORA_PREFLIGHT="si"; shift ;;
    --recover-secrets) RECUPERA="si"; shift ;;
    --verify-call) O_VERIFICA="si"; shift ;;
    --no-verify-call) O_VERIFICA="no"; shift ;;
    --verify-browser)
      if [ "${2:?}" = "none" ]; then O_BROWSER_PROVA="none"; else O_BROWSER_PROVA="$(assoluto "$2")"; fi
      shift 2 ;;
    -h|--help) uso; exit 0 ;;
    *) uso >&2; errore "Opzione sconosciuta: $1" ;;
  esac
done

if [ -n "$O_HOST" ]; then
  [ "$O_LOCALE" = "si" ] && errore "--host e --local si escludono."
  O_LOCALE="no"
fi

# ── Cartella di stato e opzioni ricordate ───────────────────────
nome_dns_valido() {
  [[ "$1" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]] && [ "${#1}" -le 253 ]
}

NOME="${O_NOME:-$O_PORTALE}"
[ -n "$NOME" ] || [ -n "$O_STATO" ] || { uso >&2; errore "Serve --portal (o --name, o --state-dir) per sapere quale installazione."; }
if [ -n "$NOME" ]; then
  [[ "$NOME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || errore "--name: solo lettere, cifre, punto, trattino e trattino basso."
fi

# Percorso assoluto e senza collegamenti simbolici, anche se non esiste
# ancora (come in scripts/minikube-up.sh): il controllo sul repository avviene
# prima di creare qualunque cartella.
risolvi_percorso() {
  local p="$1" resto="" nome
  case "$p" in /*) ;; *) p="$PWD/$p" ;; esac
  while [ ! -d "$p" ]; do
    nome="$(basename "$p")"
    [ "$nome" = ".." ] && return 1
    resto="/$nome$resto"
    p="$(dirname "$p")"
  done
  printf '%s%s\n' "$(cd "$p" && pwd -P)" "$resto"
}
STATO="$(risolvi_percorso "${O_STATO:-${XDG_CONFIG_HOME:-$HOME/.config}/pa-webinar/k3s/$NOME}")" \
  || errore "--state-dir: togli i '..' dal percorso, o crea prima la cartella."
case "$STATO/" in
  "$(cd "$RADICE" && pwd -P)"/*)
    errore "--state-dir è dentro il repository: i segreti non devono finirci. Scegli una cartella fuori da $RADICE." ;;
esac
CONF="$STATO/install.conf"
SEGRETI="$STATO/secrets.env"
SMTP_STATO="$STATO/smtp.env"
SITO="$STATO/site.yaml"
KUBECONFIG_STATO="$STATO/kubeconfig"

# Opzioni del lancio precedente: una per riga, CHIAVE=valore, mai eseguite.
# Le chiavi ripetibili compaiono su più righe.
R_SSH_OPZIONI=()
if [ -r "$CONF" ]; then
  while IFS= read -r riga || [ -n "$riga" ]; do
    case "$riga" in ''|'#'*) continue ;; esac
    k="${riga%%=*}"; v="${riga#*=}"
    case "$k" in
      HOST|LOCALE|SSH_CHIAVE|SSH_PORTA|PORTALE|CONFERENZA|IP_PUBBLICO|NAMESPACE|RELEASE|TLS|EMAIL_ACME|SERVER_ACME|\
      CA_SERVER_ACME|IMMAGINI|ARCHIVIO|MAILPIT|STORAGE|HOST_STORAGE|TURN|HOST_TURN|BACKUP|PROXY|NO_PROXY|\
      AMBITO_PROXY|REGISTRI|AIRGAP|NODE_IP|VERIFICA|BROWSER_PROVA|PORTA_TUNNEL)
        printf -v "R_$k" '%s' "$v" ;;
      SSH_OPZIONE) R_SSH_OPZIONI+=("$v") ;;
    esac
  done < "$CONF"
fi
# Con il solo --state-dir, il nome è quello del portale ricordato.
NOME="${NOME:-${R_PORTALE:-}}"
[ -n "$NOME" ] || errore "In $STATO non c'è un'installazione: serve --portal."
# Il valore effettivo: la riga di comando, poi il lancio precedente, poi il predefinito.
scegli() { local o="O_$1" r="R_$1"; printf '%s' "${!o:-${!r:-$2}}"; }
HOST_SSH="$(scegli HOST "")"
LOCALE="$(scegli LOCALE "")"
SSH_CHIAVE="$(scegli SSH_CHIAVE "")"
SSH_PORTA="$(scegli SSH_PORTA "")"
PORTALE="$(scegli PORTALE "")"
CONFERENZA="$(scegli CONFERENZA "")"
IP_PUBBLICO="$(scegli IP_PUBBLICO "")"
NAMESPACE="$(scegli NAMESPACE pa-webinar)"
RELEASE="$(scegli RELEASE pa-webinar)"
TLS="$(scegli TLS "")"
EMAIL_ACME="$(scegli EMAIL_ACME "")"
SERVER_ACME="$(scegli SERVER_ACME "")"
CA_SERVER_ACME="$(scegli CA_SERVER_ACME "")"
IMMAGINI="$(scegli IMMAGINI auto)"
ARCHIVIO="$(scegli ARCHIVIO "")"
MAILPIT="$(scegli MAILPIT no)"
STORAGE="$(scegli STORAGE none)"
HOST_STORAGE_SCELTO="$(scegli HOST_STORAGE "")"
TURN="$(scegli TURN no)"
HOST_TURN_SCELTO="$(scegli HOST_TURN "")"
BACKUP="$(scegli BACKUP no)"
PROXY="$(scegli PROXY "")"
NO_PROXY_NODO="$(scegli NO_PROXY "")"
AMBITO_PROXY="$(scegli AMBITO_PROXY "")"
REGISTRI="$(scegli REGISTRI "")"
AIRGAP="$(scegli AIRGAP "")"
NODE_IP_SCELTO="$(scegli NODE_IP "")"
PROVA_CHIAMATA="$(scegli VERIFICA no)"
BROWSER_PROVA="$(scegli BROWSER_PROVA "")"
PORTA_TUNNEL_SCELTA="$(scegli PORTA_TUNNEL "")"
PORTA_TUNNEL="${PORTA_TUNNEL_SCELTA:-6443}"
# "none" riporta al predefinito un valore ricordato.
if [ "$IP_PUBBLICO" = "none" ]; then IP_PUBBLICO=""; fi
if [ "$PROXY" = "none" ]; then PROXY=""; fi
if [ "$BROWSER_PROVA" = "none" ]; then BROWSER_PROVA=""; fi
if [ "${#O_SSH_OPZIONI[@]}" -gt 0 ]; then SSH_OPZIONI=("${O_SSH_OPZIONI[@]}"); else SSH_OPZIONI=(${R_SSH_OPZIONI[@]+"${R_SSH_OPZIONI[@]}"}); fi
# --smtp-file sceglie il relay vero: la casella di prova si spegne, se non
# è stata chiesta di nuovo su questa stessa riga di comando.
if [ -n "$FILE_SMTP" ]; then
  [ "$O_MAILPIT" = "si" ] && errore "--smtp-file e --mailpit si escludono: scegli il relay vero o la casella di prova."
  MAILPIT="no"
fi
# Il file dei certificati dell'ente, se dato, porta il modo own.
if [ "${#CERTIFICATI[@]}" -gt 0 ] || [ -n "$CARTELLA_CERT" ]; then
  [ -z "$TLS" ] && TLS="own"
  [ "$TLS" = "own" ] || errore "--cert, --key e --cert-dir valgono solo con --tls own."
fi

# ── Controllo delle opzioni ─────────────────────────────────────
[ -n "$PORTALE" ] || errore "Serve --portal <nome del portale>."
[ -n "$CONFERENZA" ] || errore "Serve --meet <nome della conferenza>."
for n in "$PORTALE" "$CONFERENZA"; do
  nome_dns_valido "$n" || errore "'$n' non è un nome DNS valido (solo minuscole, cifre, trattini e punti; niente https:// né porte)."
done
[ "$PORTALE" != "$CONFERENZA" ] || errore "Portale e conferenza vogliono due nomi diversi."
if [ -z "$LOCALE" ]; then
  [ -n "$HOST_SSH" ] || errore "Serve --host utente@server (o --local sul server stesso)."
  LOCALE="no"
fi
case "$TLS" in
  acme|private-ca|own) ;;
  '') errore "Serve --tls acme, private-ca o own (vedi --help)." ;;
  *) errore "--tls vale acme, private-ca o own (non '$TLS')." ;;
esac
if [ "$TLS" = "acme" ]; then
  [ -n "$EMAIL_ACME" ] || errore "--tls acme vuole --acme-email <indirizzo di contatto>."
  [[ "$EMAIL_ACME" =~ ^[^[:space:]\"\\@]+@[^[:space:]\"\\@]+\.[^[:space:]\"\\@]+$ ]] || errore "--acme-email non sembra un indirizzo: $EMAIL_ACME"
  if [ -n "$SERVER_ACME" ]; then
    [[ "$SERVER_ACME" =~ ^https://[^[:space:]\"\\]+$ ]] || errore "--acme-server va scritto come https://<server>/<directory>."
  fi
else
  [ -z "$O_EMAIL_ACME$O_SERVER_ACME$O_CA_SERVER_ACME" ] || errore "--acme-email, --acme-server e --acme-server-ca valgono solo con --tls acme."
fi
if [ "${#CERTIFICATI[@]}" -ne "${#CHIAVI[@]}" ]; then
  errore "--cert e --key vanno a coppie: ${#CERTIFICATI[@]} certificati e ${#CHIAVI[@]} chiavi."
fi
case "$IMMAGINI" in
  auto|registry|local) ;;
  archive) [ -n "$ARCHIVIO" ] || errore "--images archive vuole --archive <file di preload-images.sh>." ;;
  *) errore "--images vale registry, local o archive (non '$IMMAGINI')." ;;
esac
[ -n "$O_ARCHIVIO" ] && [ "$IMMAGINI" != "archive" ] && errore "--archive vale solo con --images archive."
if [ -n "$ARCHIVIO" ] && [ "$IMMAGINI" = "archive" ]; then
  [ -r "$ARCHIVIO" ] || errore "Non leggo l'archivio $ARCHIVIO."
fi
case "$STORAGE" in none|garage) ;; *) errore "--storage vale none o garage (non '$STORAGE')." ;; esac
# Senza un nome scelto, derivato dal portale a ogni lancio.
HOST_STORAGE="${HOST_STORAGE_SCELTO:-s3.$PORTALE}"
HOST_TURN="${HOST_TURN_SCELTO:-turn.$PORTALE}"
nome_dns_valido "$HOST_STORAGE" || errore "--storage-host: '$HOST_STORAGE' non è un nome DNS valido."
nome_dns_valido "$HOST_TURN" || errore "--turn-host: '$HOST_TURN' non è un nome DNS valido."
if [ -n "$IP_PUBBLICO" ]; then
  [[ "$IP_PUBBLICO" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || errore "--public-ip vuole un indirizzo IPv4 (non '$IP_PUBBLICO')."
fi
if [ -n "$TAG_SCELTO" ]; then
  [[ "$TAG_SCELTO" =~ ^([0-9]+\.[0-9]+\.[0-9]+|local-[0-9a-f]{7,40})$ ]] \
    || errore "--tag vuole un rilascio X.Y.Z (senza la v) o local-<commit> (non '$TAG_SCELTO')."
fi
[[ "$NAMESPACE" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || errore "--namespace non valido: $NAMESPACE"
[[ "$RELEASE" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || errore "--release non valido: $RELEASE"
case "$AMBITO_PROXY" in ''|containerd|all) ;; *) errore "--proxy-scope vale containerd o all." ;; esac
if ! [[ "$PORTA_TUNNEL" =~ ^[0-9]{1,5}$ ]] || [ "$PORTA_TUNNEL" -lt 1 ] || [ "$PORTA_TUNNEL" -gt 65535 ]; then
  errore "--tunnel-port vuole una porta fra 1 e 65535 (non '$PORTA_TUNNEL')."
fi
if [ -n "$FILE_SMTP" ]; then
  [ -r "$FILE_SMTP" ] || errore "Non leggo $FILE_SMTP."
  # Come ssh con le chiavi: un file con una password leggibile da altri no.
  if [ -n "$(find "$FILE_SMTP" -prune \( -perm -040 -o -perm -004 \) 2>/dev/null)" ]; then
    errore "$FILE_SMTP è leggibile da altri utenti: chmod 600 '$FILE_SMTP' e rilancia."
  fi
fi
# Chi ha accesso ai dati: il file delle opzioni ricorda l'host, e --host che
# cambia su un'installazione esistente è quasi sempre un errore di battitura.
if [ -n "$O_HOST" ] && [ -n "${R_HOST:-}" ] && [ "$O_HOST" != "$R_HOST" ]; then
  errore "L'installazione '$NOME' è su ${R_HOST}, non su $O_HOST. Per un altro server usa un altro --name (o --state-dir)."
fi
if [ -n "${R_PORTALE:-}" ] && [ -n "$O_PORTALE" ] && [ "$O_PORTALE" != "$R_PORTALE" ]; then
  avviso "il portale passa da $R_PORTALE a $O_PORTALE: link e inviti già inviati puntano al nome di prima."
fi

# Nomi degli oggetti che lo script crea nel namespace.
SECRET_APP="$RELEASE-secrets"
SECRET_DATI="$RELEASE-datastore"
SECRET_JWT="$RELEASE-jitsi-jwt"
SECRET_JICOFO="$RELEASE-jicofo-xmpp"
SECRET_JVB="$RELEASE-jvb-xmpp"
TLS_PORTALE="$RELEASE-portal-tls"
TLS_CONFERENZA="$RELEASE-meet-tls"
TLS_STORAGE="$RELEASE-storage-tls"
TLS_TURN="$RELEASE-turn-tls"
CM_CA="$RELEASE-extra-ca"
# L'host del database come lo calcola il sottochart (common.names.fullname).
case "$RELEASE" in *postgresql*) HOST_DB="$RELEASE" ;; *) HOST_DB="$RELEASE-postgresql" ;; esac

# ── Strumenti sulla postazione ──────────────────────────────────
passo "Prerequisiti"
for comando in helm openssl curl; do
  command -v "$comando" >/dev/null 2>&1 || errore "Manca '$comando' nel PATH."
done
# Sul server stesso kubectl può mancare: arriva con k3s (k3s kubectl).
if [ "$LOCALE" = "no" ]; then
  command -v kubectl >/dev/null 2>&1 || errore "Manca 'kubectl' nel PATH."
fi
[ "$LOCALE" = "si" ] || command -v ssh >/dev/null 2>&1 || errore "Manca 'ssh' nel PATH."
almeno() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }
v_helm="$(helm version --template '{{.Version}}' 2>/dev/null | sed 's/^v//; s/+.*//')"
almeno "$v_helm" "$HELM_MIN" || errore "Helm $v_helm: serve almeno $HELM_MIN."
v_kubectl=""
if command -v kubectl >/dev/null 2>&1; then
  v_kubectl="$(kubectl version --client -o json 2>/dev/null | sed -n 's/.*"gitVersion": *"v\([^"]*\)".*/\1/p' | head -n1)"
fi
[ -d "$CHART" ] || errore "Chart non trovato in $CHART."
nota "helm $v_helm · kubectl ${v_kubectl:-?} · chart da $RADICE"
# kubectl è supportato fino a una versione minore di distanza dal cluster:
# oltre di solito funziona ancora, ma gli errori che ne nascono non dicono da
# dove vengono. Qui si confronta con la versione di k3s provata, che è quella
# che lo script installa; più avanti con quella del cluster, se è un'altra.
minore_di() { printf '%s' "$1" | sed -nE 's/^v?1\.([0-9]+)(\..*)?$/\1/p'; }
MINORE_KUBECTL="$(minore_di "$v_kubectl")"
KUBECTL_AVVISATO=""
controlla_kubectl() {
  local m="$1" descrizione="$2" distanza
  [ -n "$m" ] && [ -n "$MINORE_KUBECTL" ] && [ "$m" != "$KUBECTL_AVVISATO" ] || return 0
  distanza=$(( MINORE_KUBECTL - m ))
  if [ "$distanza" -gt 1 ] || [ "$distanza" -lt -1 ]; then
    KUBECTL_AVVISATO="$m"
    avviso "kubectl $v_kubectl è troppo lontano da $descrizione (Kubernetes 1.$m): serve almeno kubectl 1.$(( m - 1 )), e non oltre 1.$(( m + 1 )). Aggiornalo, o sul server usa 'sudo k3s kubectl'."
  fi
}
controlla_kubectl "$(minore_di "${K3S_VERSIONE_PROVATA%%+*}")" "k3s ${K3S_VERSIONE_PROVATA%%+*}, la versione provata"
# La prova di chiamata finale (--verify-call) vuole node, Playwright e un
# browser su questa macchina: si scopre qui se mancano, non dopo
# l'installazione. Il browser si avvia davvero, perché Playwright può avere
# la sola versione senza interfaccia o nessuna.
if [ "$PROVA_CHIAMATA" = "si" ]; then
  command -v node >/dev/null 2>&1 \
    || errore "--verify-call: manca node su questa macchina (20 o più recente). Per installare senza la prova: --no-verify-call."
  v_node="$(node -p 'process.versions.node' 2>/dev/null || true)"
  almeno "${v_node:-0}" "20.0.0" || errore "--verify-call: node ${v_node:-?}, serve 20 o più recente. Per installare senza la prova: --no-verify-call."
  # shellcheck disable=SC2016  # codice JavaScript, non variabili della shell
  prova_browser='
    const { createRequire } = require("node:module");
    const { join } = require("node:path");
    let pw;
    try {
      pw = createRequire(join(process.argv[1], "package.json"))("playwright");
    } catch {
      console.log("Playwright non trovato: npm ci nella radice del repository");
      process.exit(1);
    }
    const eseguibile = process.env.PROVA_BROWSER;
    pw.chromium.launch({ timeout: 60000, ...(eseguibile ? { executablePath: eseguibile } : {}) })
      .then((b) => b.close())
      .then(() => process.exit(0), (e) => {
        console.log(`il browser non parte: ${String(e?.message ?? e).split("\n")[0]} (npx playwright install chromium, o --verify-browser)`);
        process.exit(1);
      });'
  esito_browser="$(PROVA_BROWSER="$BROWSER_PROVA" node -e "$prova_browser" "$RADICE" 2>&1)" \
    || errore "--verify-call: ${esito_browser:-controllo del browser non riuscito}. Per installare senza la prova: --no-verify-call."
  nota "prova di chiamata: node $v_node, Playwright e ${BROWSER_PROVA:-il Chromium di Playwright} pronti"
fi

# Versione del checkout: chart, file di esempio e immagini dallo stesso tag.
if [ -n "$TAG_SCELTO" ]; then
  TAG_APP="$TAG_SCELTO"
  case "$TAG_SCELTO" in local-*) TAG_MIG="$TAG_SCELTO-migrate" ;; *) TAG_MIG="v$TAG_SCELTO-migrate" ;; esac
else
  tags="$(tag_da_checkout "$RADICE")" || errore "Non ricavo la versione del checkout (git o Chart.yaml): passala con --tag."
  read -r TAG_APP TAG_MIG <<< "$tags"
fi
RILASCIO="no"; [[ "$TAG_APP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && RILASCIO="si"
MODIFICATO="no"; checkout_modificato "$RADICE" && MODIFICATO="si"
if [ -n "$TAG_SCELTO" ]; then
  tag_checkout="$(tag_da_checkout "$RADICE" 2>/dev/null | cut -d' ' -f1 || true)"
  [ "$tag_checkout" = "$TAG_SCELTO" ] || avviso "--tag $TAG_SCELTO ma il checkout è $tag_checkout: chart e immagini devono venire dallo stesso commit."
fi
if [ "$RILASCIO" = "si" ]; then
  nota "rilascio $TAG_APP (immagini $TAG_APP e $TAG_MIG)"
else
  nota "checkout ${TAG_APP#local-} fuori da un tag di rilascio: immagini costruite da qui"
fi
[ "$MODIFICATO" = "si" ] && nota "il checkout ha modifiche non salvate: le immagini costruite le contengono"

# ── Accesso al server ───────────────────────────────────────────
# Una connessione ssh condivisa (ControlMaster) per tutto il lancio, con la
# presa in una cartella temporanea 0700; si chiude all'uscita, anche in caso
# di errore. Chi non ha la chiave inserisce la password una volta sola.
SSH=()
PRESA=""
CARTELLA_REMOTA=""
KUBECONFIG_RUN=""
TMP_LOCALE="$(mktemp -d "${TMPDIR:-/tmp}/pa-webinar-up.XXXXXX")"
chiudi() {
  local esito=$?
  if [ -n "$CARTELLA_REMOTA" ] && [ "$LOCALE" = "no" ] && [ -n "$PRESA" ]; then
    ssh "${SSH[@]}" "$HOST_SSH" rm -rf "$CARTELLA_REMOTA" >/dev/null 2>&1 || true
  fi
  if [ -n "$PRESA" ] && [ -S "$PRESA" ]; then
    ssh -o ControlPath="$PRESA" -O exit "$HOST_SSH" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_LOCALE"
  return "$esito"
}
trap chiudi EXIT

# Un comando per la shell remota, con ogni argomento tra apici.
cita() {
  local a out=""
  for a in "$@"; do out="$out$(printf '%q' "$a") "; done
  printf '%s' "$out"
}
PREFISSO_ROOT=""
# Esegue sul server, come l'utente di ssh.
remoto() {
  if [ "$LOCALE" = "si" ]; then "$@"; else ssh "${SSH[@]}" "$HOST_SSH" -- "$(cita "$@")"; fi
}
# Esegue sul server come root: sudo senza password, o root diretto.
remoto_root() {
  if [ "$LOCALE" = "si" ]; then
    if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
  else
    ssh "${SSH[@]}" "$HOST_SSH" -- "$PREFISSO_ROOT$(cita "$@")"
  fi
}

if [ "$LOCALE" = "no" ]; then
  PRESA="$TMP_LOCALE/ssh"
  # Con -o vale il primo valore dato: ControlMaster va prima delle altre.
  SSH_BASE=(-o ControlPath="$PRESA" -o ConnectTimeout=20 -o ServerAliveInterval=30)
  if [ -n "$SSH_CHIAVE" ]; then SSH_BASE+=(-i "$SSH_CHIAVE"); fi
  if [ -n "$SSH_PORTA" ]; then SSH_BASE+=(-p "$SSH_PORTA"); fi
  for o in ${SSH_OPZIONI[@]+"${SSH_OPZIONI[@]}"}; do SSH_BASE+=(-o "$o"); done
  ssh -o ControlMaster=yes -o ControlPersist=no "${SSH_BASE[@]}" -f -N "$HOST_SSH" \
    || errore "ssh verso $HOST_SSH non riuscito (chiave, utente, porta?)."
  SSH=(-o ControlMaster=no "${SSH_BASE[@]}")
  if [ "$(remoto id -u)" != "0" ]; then
    remoto sudo -n true 2>/dev/null \
      || errore "Su $HOST_SSH l'utente non ha sudo senza password. Serve per installare k3s: configuralo (o usa root), oppure lancia lo script sul server con --local."
    PREFISSO_ROOT="sudo -n "
  fi
else
  [ "$(uname -s)" = "Linux" ] || errore "--local si usa sul server Linux."
  if [ "$(id -u)" -ne 0 ]; then
    command -v sudo >/dev/null 2>&1 || errore "Serve root o sudo."
    sudo -v || errore "sudo non riuscito."
  fi
fi

# ── Controlli sul server ────────────────────────────────────────
passo "Server${HOST_SSH:+ $HOST_SSH}"
FATTI="$(remoto_root bash -s <<'REMOTO'
set -u
echo "cpu=$(nproc 2>/dev/null || echo 0)"
echo "mem_mb=$(awk '/^MemTotal:/ {print int($2/1024)}' /proc/meminfo)"
d=/var/lib/rancher; [ -d "$d" ] || d=/var/lib; [ -d "$d" ] || d=/
echo "disco_gb=$(df -Pk "$d" | awk 'NR==2 {print int($2/1048576)}')"
echo "libero_gb=$(df -Pk "$d" | awk 'NR==2 {print int($4/1048576)}')"
echo "arch=$(uname -m)"
echo "systemd=$(command -v systemctl >/dev/null 2>&1 && echo si || echo no)"
. /etc/os-release 2>/dev/null && echo "os=${PRETTY_NAME:-?}"
echo "ip_nodo=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") {print $(i + 1); exit}}')"
echo "ip_tutti=$(hostname -I 2>/dev/null)"
if [ -x /usr/local/bin/k3s ]; then echo "k3s=$(/usr/local/bin/k3s --version 2>/dev/null | awk 'NR==1 {print $3}')"; fi
echo "k3s_attivo=$(systemctl is-active k3s 2>/dev/null || true)"
occupate=""
if command -v ss >/dev/null 2>&1; then
  for p in 80 443; do
    ss -H -ltnp "sport = :$p" 2>/dev/null | grep -Eqv 'k3s|containerd|traefik|^$' && occupate="$occupate tcp/$p"
  done
  ss -H -lunp "sport = :10000" 2>/dev/null | grep -Eqv 'k3s|containerd|jvb|java|^$' && occupate="$occupate udp/10000"
fi
echo "occupate=$occupate"
echo "ntp=$(timedatectl show -p NTPSynchronized --value 2>/dev/null || echo ?)"
echo "ora=$(date +%s)"
REMOTO
)" || errore "Non riesco a leggere lo stato del server."
f_cpu=0; f_mem_mb=0; f_disco_gb=0; f_libero_gb=0; f_arch=""; f_systemd=""; f_os="?"; f_ip_nodo=""
f_ip_tutti=""; f_k3s=""; f_k3s_attivo=""; f_occupate=""; f_ntp=""; f_ora=0
while IFS='=' read -r k v; do
  case "$k" in
    cpu|mem_mb|disco_gb|libero_gb|arch|systemd|os|ip_nodo|ip_tutti|k3s|k3s_attivo|occupate|ntp|ora) printf -v "f_$k" '%s' "$v" ;;
  esac
done <<< "$FATTI"
# Numeri interi, anche se il server non ha risposto per qualche voce.
for k in cpu mem_mb disco_gb libero_gb ora; do
  v="f_$k"; v="${!v//[!0-9]/}"; printf -v "f_$k" '%s' "${v:-0}"
done
NODE_IP="${NODE_IP_SCELTO:-$f_ip_nodo}"
[ -n "$NODE_IP" ] || NODE_IP="$(printf '%s' "$f_ip_tutti" | awk '{print $1}')"
[ -n "$NODE_IP" ] || errore "Indirizzo del server non rilevato: passalo con --node-ip."
nota "$f_os · $f_arch · $f_cpu vCPU · $(( (f_mem_mb + 512) / 1024 )) GiB · disco $f_disco_gb GiB ($f_libero_gb liberi) · $NODE_IP"
if [ -n "$f_k3s" ]; then nota "k3s $f_k3s già installato ($f_k3s_attivo)"; fi

problemi=()
[ "$f_systemd" = "si" ] || problemi+=("il server non ha systemd")
case "$f_arch" in x86_64|aarch64) ;; *) problemi+=("architettura $f_arch non supportata") ;; esac
[ "$f_cpu" -ge "$CPU_MIN" ] || problemi+=("$f_cpu vCPU, il minimo è $CPU_MIN")
[ "$f_mem_mb" -ge "$MEMORIA_MIN_MB" ] || problemi+=("$f_mem_mb MiB di memoria, il minimo è 8 GiB")
[ "$f_disco_gb" -ge "$DISCO_MIN_GB" ] || problemi+=("disco di $f_disco_gb GiB, il minimo è 40 GB")
[ "$f_libero_gb" -ge "$DISCO_LIBERO_MIN_GB" ] || problemi+=("$f_libero_gb GiB liberi, ne servono almeno $DISCO_LIBERO_MIN_GB per immagini e database")
[ -z "$f_occupate" ] || problemi+=("porte già usate da altri programmi:$f_occupate (Traefik e il bridge le vogliono libere)")
if [ "${#problemi[@]}" -gt 0 ]; then
  for p in "${problemi[@]}"; do nota "✗ $p"; done
  [ "$IGNORA_PREFLIGHT" = "si" ] || errore "Il server non ha il minimo documentato (docs/install/k3s.md). Per provare comunque: --ignore-preflight."
  avviso "prosegui sotto il minimo (--ignore-preflight): capacità e stabilità non sono quelle misurate."
fi
[ "$f_ntp" = "yes" ] || avviso "l'orologio del server non risulta sincronizzato (NTP): token della conferenza e certificati dipendono dall'ora. Attiva systemd-timesyncd o chrony."
scarto=$(( $(date +%s) - f_ora )); [ "$scarto" -lt 0 ] && scarto=$(( -scarto ))
[ "$scarto" -le 60 ] || avviso "l'orologio del server differisce di ${scarto}s da questa macchina."

# Indirizzo annunciato dal bridge: quello del nodo, o --public-ip dietro NAT.
privato() {
  case "$1" in
    10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) return 0 ;;
    *) return 1 ;;
  esac
}
IP_ANNUNCIATO="${IP_PUBBLICO:-$NODE_IP}"
if [ -n "$IP_PUBBLICO" ] && [ "$IP_PUBBLICO" != "$NODE_IP" ]; then
  nota "il bridge annuncia $IP_PUBBLICO (NAT 1:1 verso $NODE_IP: la porta UDP 10000 deve restare la stessa)"
elif privato "$NODE_IP"; then
  avviso "il server ha un indirizzo privato ($NODE_IP). Va bene per partecipanti nella stessa rete; da Internet, attraverso un NAT, serve --public-ip <indirizzo pubblico>."
fi

# DNS: i nomi devono risolversi nell'indirizzo che i browser raggiungono.
risolvi() {
  local n="$1" r=""
  if command -v getent >/dev/null 2>&1; then r="$(getent ahostsv4 "$n" 2>/dev/null | awk 'NR==1 {print $1}')"; fi
  if [ -z "$r" ] && command -v dig >/dev/null 2>&1; then r="$(dig +short A "$n" 2>/dev/null | grep -E '^[0-9.]+$' | head -n1)"; fi
  if [ -z "$r" ] && command -v host >/dev/null 2>&1; then r="$(host -t A "$n" 2>/dev/null | awk '/has address/ {print $NF; exit}')"; fi
  printf '%s' "$r"
}
NOMI_DNS=("$PORTALE" "$CONFERENZA")
[ "$STORAGE" = "garage" ] && NOMI_DNS+=("$HOST_STORAGE")
[ "$TURN" = "si" ] && NOMI_DNS+=("$HOST_TURN")
DNS_MANCANTI=()
for n in "${NOMI_DNS[@]}"; do
  r="$(risolvi "$n")"
  if [ -z "$r" ]; then
    DNS_MANCANTI+=("$n")
    avviso "$n non si risolve da questa macchina: serve un record A verso $IP_ANNUNCIATO."
  elif [ "$r" != "$IP_ANNUNCIATO" ] && [ "$r" != "$NODE_IP" ]; then
    avviso "$n punta a $r, non a questo server ($IP_ANNUNCIATO). Se $r è l'indirizzo pubblico di un NAT verso il server, passa --public-ip $r."
  fi
done
if [ "$TLS" = "acme" ] && [ "${#DNS_MANCANTI[@]}" -gt 0 ]; then
  avviso "con --tls acme i certificati arrivano solo quando i nomi puntano al server e la porta 443 è raggiungibile dal server ACME."
fi

# ── Piano ───────────────────────────────────────────────────────
TRAEFIK_ACME=()
if [ "$TLS" = "acme" ]; then
  TRAEFIK_ACME=(--acme-email "$EMAIL_ACME")
  [ -n "$SERVER_ACME" ] && TRAEFIK_ACME+=(--acme-server "$SERVER_ACME")
  [ -n "$CA_SERVER_ACME" ] && TRAEFIK_ACME+=(--acme-server-ca "@CA_ACME@")
fi
if [ -z "$f_k3s" ] || [ "$f_k3s_attivo" != "active" ]; then K3S_AZIONE="installa k3s $K3S_VERSIONE_PROVATA"
else K3S_AZIONE="k3s $f_k3s già attivo (install-server.sh solo se cambiano le opzioni del nodo)"; fi
case "$IMMAGINI" in
  auto)
    if [ "$RILASCIO" = "si" ]; then testo_immagini="$TAG_APP dal registro se lo dà senza credenziali, altrimenti costruite qui"
    else testo_immagini="costruite da questo checkout ($REPO_IMMAGINE_LOCALE:$TAG_APP) e importate"; fi ;;
  registry) testo_immagini="$REPO_IMMAGINE_PUBBLICATA:$TAG_APP e $TAG_MIG, prelevate dal server" ;;
  local) testo_immagini="costruite da questo checkout ($REPO_IMMAGINE_LOCALE:$TAG_APP) e importate" ;;
  archive) testo_immagini="dall'archivio $ARCHIVIO" ;;
esac
if [ "$MAILPIT" = "si" ]; then testo_smtp="casella di prova Mailpit nel cluster"
elif [ -n "$FILE_SMTP" ] || [ -s "$SMTP_STATO" ]; then testo_smtp="relay da ${FILE_SMTP:-$SMTP_STATO}"
else testo_smtp="nessuno (nessuna email partirà: --smtp-file o --mailpit)"; fi
cat <<FINE

   Installazione   $NOME (release $RELEASE, namespace $NAMESPACE)
   Server          ${HOST_SSH:-questa macchina} · $K3S_AZIONE
   Portale         https://$PORTALE
   Conferenza      https://$CONFERENZA (bridge su $IP_ANNUNCIATO, UDP 10000)
   Certificati     $TLS
   Immagini        $testo_immagini
   Email           $testo_smtp
   Storage         $( [ "$STORAGE" = "garage" ] && printf 'Garage su https://%s' "$HOST_STORAGE" || printf 'nessuno (niente materiali né video caricati)')
   TURN            $( [ "$TURN" = "si" ] && printf 'sì, %s' "$HOST_TURN" || printf 'no')
   Backup          $( [ "$BACKUP" = "si" ] && printf 'copia notturna del database sul server' || printf 'no')
   Stato           $STATO
FINE

# Il file dei valori del sito, scritto qui sotto e mostrato con --dry-run.
scrivi_sito() {
  local dest="$1"
  {
    printf '# Scritto da infra/onprem/k3s/pa-webinar-up.sh a ogni lancio: non modificarlo a mano,\n'
    printf '# si riscrive dalle opzioni (vedi install.conf accanto). Nessun segreto qui: stanno\n'
    printf '# nei Secret %s, %s, %s, %s, %s.\n' "$SECRET_APP" "$SECRET_DATI" "$SECRET_JWT" "$SECRET_JICOFO" "$SECRET_JVB"
    printf 'site:\n  portalHost: "%s"\n  conferenceHost: "%s"\n' "$PORTALE" "$CONFERENZA"
    printf 'secrets:\n  mode: existing\n  existingSecretName: "%s"\n  datastoreSecretName: "%s"\n  jitsiJwtSecretName: ""\n' \
      "$SECRET_APP" "$SECRET_DATI"
    printf 'postgresql:\n  auth:\n    existingSecret: "%s"\n' "$SECRET_DATI"
    printf 'redis:\n  auth:\n    existingSecret: "%s"\n' "$SECRET_DATI"
    printf 'app:\n'
    printf '  image:\n    repository: %s\n    tag: "%s"\n    pullPolicy: %s\n' "$IMG_REPO" "$TAG_APP" "$IMG_POLICY"
    printf '  migration:\n    image:\n      repository: %s\n      tag: "%s"\n      pullPolicy: %s\n' "$IMG_REPO" "$TAG_MIG" "$IMG_POLICY"
    # Un tag importato o un Secret cambiato non cambiano il manifesto: le
    # impronte nelle annotazioni del pod fanno ripartire il portale solo
    # quando immagini o segreti sono cambiati davvero.
    if [ -n "$IMPRONTA_IMMAGINI$IMPRONTA_SEGRETI" ]; then
      printf '  podAnnotations:\n'
      if [ -n "$IMPRONTA_IMMAGINI" ]; then printf '    pa-webinar/images: "%s"\n' "$IMPRONTA_IMMAGINI"; fi
      if [ -n "$IMPRONTA_SEGRETI" ]; then printf '    pa-webinar/secrets: "%s"\n' "$IMPRONTA_SEGRETI"; fi
    fi
    if [ "$CA_PORTALE" = "si" ]; then
      printf '  extraCaCerts:\n    configMapName: "%s"\n    key: ca.crt\n' "$CM_CA"
    fi
    case "$TLS" in
      acme)
        printf 'ingress:\n  annotations:\n'
        printf '    traefik.ingress.kubernetes.io/router.tls: "true"\n'
        printf '    traefik.ingress.kubernetes.io/router.tls.certresolver: %s\n' "$RESOLVER_ACME"
        printf '  tls:\n    - {}\n'
        printf 'jitsi:\n  conferenceIngress:\n    annotations:\n'
        printf '      traefik.ingress.kubernetes.io/router.tls: "true"\n'
        printf '      traefik.ingress.kubernetes.io/router.tls.certresolver: %s\n' "$RESOLVER_ACME"
        printf '    tls:\n      - {}\n' ;;
      *)
        printf 'ingress:\n  tls:\n    - secretName: %s\n' "$TLS_PORTALE"
        printf 'jitsi:\n  conferenceIngress:\n    tls:\n      - secretName: %s\n' "$TLS_CONFERENZA" ;;
    esac
    printf 'jitsi-meet:\n  publicURL: "https://%s"\n' "$CONFERENZA"
    printf '  prosody:\n    jwt:\n      existingSecretName: "%s"\n' "$SECRET_JWT"
    printf '  jicofo:\n    xmpp:\n      existingSecretName: "%s"\n' "$SECRET_JICOFO"
    printf '  jvb:\n    xmpp:\n      existingSecretName: "%s"\n' "$SECRET_JVB"
    if [ -n "$IP_PUBBLICO" ] && [ "$IP_PUBBLICO" != "$NODE_IP" ]; then
      printf '    publicIPs: ["%s"]\n' "$IP_PUBBLICO"
    fi
    if [ -n "$PORTA_SMTP" ] && [ "$PORTA_SMTP" != "587" ]; then
      printf 'networkPolicy:\n  egress:\n    smtpPort: %s\n' "$PORTA_SMTP"
      if [ "$PORTA_SMTP" = "465" ]; then printf '    allowImplicitTlsSmtp: true\n'; fi
    fi
    if [ "$BACKUP" = "si" ]; then
      printf 'backup:\n  enabled: true\n'
    else
      printf 'backup:\n  enabled: false\n'
    fi
  } > "$dest"
}

# Valori provvisori per l'anteprima: quelli veri si decidono con le immagini.
IMG_REPO="$REPO_IMMAGINE_PUBBLICATA"; IMG_POLICY="IfNotPresent"; IMPRONTA_IMMAGINI=""; IMPRONTA_SEGRETI=""
if [ "$IMMAGINI" = "local" ] || { [ "$IMMAGINI" = "auto" ] && [ "$RILASCIO" = "no" ]; }; then
  IMG_REPO="$REPO_IMMAGINE_LOCALE"; IMG_POLICY="Never"
fi
CA_PORTALE="no"
if [ "$TLS" = "private-ca" ] || [ -n "$O_CA_EXTRA" ] || [ -s "$STATO/extra-ca.crt" ]; then CA_PORTALE="si"; fi
PORTA_SMTP=""
if [ "$MAILPIT" = "si" ]; then PORTA_SMTP="1025"
elif [ -n "$FILE_SMTP" ]; then PORTA_SMTP="$(sed -nE 's/^[[:space:]]*SMTP_PORT[[:space:]]*=[[:space:]]*"?([0-9]+)"?.*$/\1/p' "$FILE_SMTP" | tail -n1)"
elif [ -s "$SMTP_STATO" ]; then PORTA_SMTP="$(sed -nE 's/^SMTP_PORT=([0-9]+)$/\1/p' "$SMTP_STATO" | tail -n1)"; fi

if [ "$DRY_RUN" = "si" ]; then
  scrivi_sito "$TMP_LOCALE/site.yaml"
  printf '\n   Valori del sito che scriverei in %s:\n\n' "$SITO"
  sed 's/^/     /' "$TMP_LOCALE/site.yaml"
  # La resa del chart con quei valori, se i sottochart ci sono già: un
  # errore di resa si scopre qui, non a metà installazione.
  if [ -n "$(ls -A "$CHART/charts" 2>/dev/null)" ]; then
    if helm template "$RELEASE" "$CHART" -n "$NAMESPACE" -f "$CHART/examples/values-simple.yaml" \
        -f "$CHART/examples/values-k3s.yaml" -f "$TMP_LOCALE/site.yaml" > /dev/null 2> "$TMP_LOCALE/resa.err"; then
      nota "helm template: il chart si rende con questi valori"
    else
      sed 's/^/   /' "$TMP_LOCALE/resa.err" >&2
      errore "Il chart non si rende con questi valori (vedi sopra)."
    fi
  fi
  printf '\n✓ Prova a vuoto: nessuna modifica al server, al cluster o a %s.\n' "$STATO"
  exit 0
fi
if [ "$SI" != "si" ]; then
  [ -t 0 ] || errore "Senza terminale serve --yes per procedere."
  printf '\nProcedo? [s/N] '
  read -r risposta
  case "$risposta" in s|S|si|sì|y|yes) ;; *) errore "Annullato: nessuna modifica." ;; esac
fi

# Da qui si scrive: la cartella di stato nasce 0700, i file 0600.
umask 077
mkdir -p "$STATO"

# Le opzioni effettive, per il prossimo lancio. Si salvano subito: un lancio
# fermato a metà si riprende con la stessa riga di comando o con il solo --portal.
salva_opzioni() {
  local tmp="$CONF.tmp" o
  {
    printf '# Opzioni di pa-webinar-up.sh per %s, scritte a ogni lancio. Contiene il proxy,\n' "$NOME"
    printf '# con le sue eventuali credenziali: resta 0600.\n'
    printf 'HOST=%s\nLOCALE=%s\nSSH_CHIAVE=%s\nSSH_PORTA=%s\n' "$HOST_SSH" "$LOCALE" "$SSH_CHIAVE" "$SSH_PORTA"
    for o in ${SSH_OPZIONI[@]+"${SSH_OPZIONI[@]}"}; do printf 'SSH_OPZIONE=%s\n' "$o"; done
    printf 'PORTALE=%s\nCONFERENZA=%s\nIP_PUBBLICO=%s\n' "$PORTALE" "$CONFERENZA" "$IP_PUBBLICO"
    printf 'NAMESPACE=%s\nRELEASE=%s\n' "$NAMESPACE" "$RELEASE"
    printf 'TLS=%s\nEMAIL_ACME=%s\nSERVER_ACME=%s\nCA_SERVER_ACME=%s\n' "$TLS" "$EMAIL_ACME" "$SERVER_ACME" "$CA_SERVER_ACME"
    printf 'IMMAGINI=%s\nARCHIVIO=%s\n' "$IMMAGINI" "$ARCHIVIO"
    printf 'MAILPIT=%s\nSTORAGE=%s\nHOST_STORAGE=%s\nTURN=%s\nHOST_TURN=%s\nBACKUP=%s\n' \
      "$MAILPIT" "$STORAGE" "$HOST_STORAGE_SCELTO" "$TURN" "$HOST_TURN_SCELTO" "$BACKUP"
    printf 'PROXY=%s\nNO_PROXY=%s\nAMBITO_PROXY=%s\nREGISTRI=%s\nAIRGAP=%s\nNODE_IP=%s\n' \
      "$PROXY" "$NO_PROXY_NODO" "$AMBITO_PROXY" "$REGISTRI" "$AIRGAP" "$NODE_IP_SCELTO"
    printf 'VERIFICA=%s\nBROWSER_PROVA=%s\nPORTA_TUNNEL=%s\n' "$PROVA_CHIAMATA" "$BROWSER_PROVA" "$PORTA_TUNNEL_SCELTA"
  } > "$tmp"
  mv "$tmp" "$CONF"
}
salva_opzioni

# ── k3s ─────────────────────────────────────────────────────────
# I file degli script sul server: una cartella temporanea, tolta all'uscita.
if [ "$LOCALE" = "si" ]; then
  DIR_SCRIPT="$CARTELLA"
else
  CARTELLA_REMOTA="$(remoto mktemp -d /tmp/pa-webinar-k3s.XXXXXX)"
  tar -C "$CARTELLA" -cf - common.sh install-server.sh preload-images.sh traefik-config.yaml 90-pa-webinar-jvb.conf \
    | remoto tar -C "$CARTELLA_REMOTA" -xf - || errore "Copia degli script sul server non riuscita."
  DIR_SCRIPT="$CARTELLA_REMOTA"
fi
# Porta un file locale nella cartella degli script sul server; stampa il percorso remoto.
porta_file() {
  local sorgente="$1" nome="$2"
  if [ "$LOCALE" = "si" ]; then printf '%s' "$sorgente"; return 0; fi
  remoto sh -c "umask 077; cat > $(printf '%q' "$CARTELLA_REMOTA/$nome")" < "$sorgente" || errore "Copia di $sorgente sul server non riuscita."
  printf '%s' "$CARTELLA_REMOTA/$nome"
}

argomenti_k3s=(--node-ip "$NODE_IP")
[ -n "$NO_PROXY_NODO" ] && argomenti_k3s+=(--no-proxy "$NO_PROXY_NODO")
[ -n "$AMBITO_PROXY" ] && argomenti_k3s+=(--proxy-scope "$AMBITO_PROXY")
# Un'impronta di tutto ciò che install-server.sh scrive sul nodo: se non
# cambia, non lo si rilancia (riavvierebbe k3s senza motivo).
impronta_k3s="$( {
  printf '%s\n' "$K3S_VERSIONE_PROVATA" "${argomenti_k3s[@]}" ${TRAEFIK_ACME[@]+"${TRAEFIK_ACME[@]}"} "$PROXY"
  cat "$CARTELLA/traefik-config.yaml" "$CARTELLA/90-pa-webinar-jvb.conf" "$CARTELLA/install-server.sh" "$CARTELLA/common.sh"
  [ -n "$REGISTRI" ] && cat "$REGISTRI"
  [ -n "$CA_SERVER_ACME" ] && cat "$CA_SERVER_ACME"
  true
} | openssl dgst -sha256 | awk '{print $NF}')"
impronta_prima="$(cat "$STATO/k3s.sha256" 2>/dev/null || true)"
if [ -z "$f_k3s" ] || [ "$f_k3s_attivo" != "active" ] || [ "$impronta_k3s" != "$impronta_prima" ] || [ "$REINSTALLA_K3S" = "si" ]; then
  passo "k3s (install-server.sh)"
  if [ -n "$REGISTRI" ]; then argomenti_k3s+=(--registries "$(porta_file "$REGISTRI" registries.yaml)"); fi
  if [ -n "$AIRGAP" ]; then
    if [ "$LOCALE" = "si" ]; then argomenti_k3s+=(--airgap-dir "$AIRGAP")
    else
      tar -C "$AIRGAP" -cf - . | remoto sh -c "mkdir -p $(printf '%q' "$CARTELLA_REMOTA/airgap") && tar -C $(printf '%q' "$CARTELLA_REMOTA/airgap") -xf -" \
        || errore "Copia di $AIRGAP sul server non riuscita."
      argomenti_k3s+=(--airgap-dir "$CARTELLA_REMOTA/airgap")
    fi
  fi
  for a in ${TRAEFIK_ACME[@]+"${TRAEFIK_ACME[@]}"}; do
    if [ "$a" = "@CA_ACME@" ]; then argomenti_k3s+=("$(porta_file "$CA_SERVER_ACME" acme-ca.crt)"); else argomenti_k3s+=("$a"); fi
  done
  inizio=$(date +%s)
  # Il proxy passa dall'ingresso standard: può contenere credenziali, che non
  # devono finire sulla riga di comando (visibile a chiunque sul server).
  # shellcheck disable=SC2016  # le variabili le espande la shell remota
  printf '%s\n' "$PROXY" | remoto_root bash -c 'IFS= read -r p || true; if [ -n "$p" ]; then export HTTPS_PROXY="$p"; else unset HTTPS_PROXY HTTP_PROXY https_proxy http_proxy; fi; exec bash "$0" "$@"' \
      "$DIR_SCRIPT/install-server.sh" "${argomenti_k3s[@]}" 2>&1 | sed '/^Fatto\. Prossimi passi:/,$d; s/^/   /' \
    || errore "install-server.sh non riuscito (vedi sopra)."
  printf '%s\n' "$impronta_k3s" > "$STATO/k3s.sha256"
  nota "k3s pronto in $(( $(date +%s) - inizio )) s"
fi

# ── Kubeconfig ──────────────────────────────────────────────────
# Quello del server, nella cartella di stato (0600), con l'indirizzo del nodo:
# mai unito a ~/.kube/config. Durante il lancio l'API si raggiunge da un
# tunnel ssh, così la porta 6443 può restare chiusa verso la postazione.
passo "Accesso al cluster"
remoto_root cat /etc/rancher/k3s/k3s.yaml > "$TMP_LOCALE/k3s.yaml" || errore "Non leggo /etc/rancher/k3s/k3s.yaml sul server."
sed "s#https://127.0.0.1:6443#https://$NODE_IP:6443#" "$TMP_LOCALE/k3s.yaml" > "$KUBECONFIG_STATO"
chmod 600 "$KUBECONFIG_STATO"
# Dalla postazione l'API si raggiunge con il tunnel ssh del riepilogo, dalla
# porta PORTA_TUNNEL di questa macchina alla 6443 del server: kubeconfig.tunnel
# è il kubeconfig da usare con il tunnel aperto. Sul server stesso vale quello
# con l'indirizzo del nodo.
KUBECONFIG_TUNNEL="$STATO/kubeconfig.tunnel"
if [ "$LOCALE" = "no" ]; then
  sed "s#https://127.0.0.1:6443#https://127.0.0.1:$PORTA_TUNNEL#" "$TMP_LOCALE/k3s.yaml" > "$KUBECONFIG_TUNNEL"
  chmod 600 "$KUBECONFIG_TUNNEL"
  KUBECONFIG_UTENTE="$KUBECONFIG_TUNNEL"
else
  KUBECONFIG_UTENTE="$KUBECONFIG_STATO"
fi
KUBECONFIG_RUN="$TMP_LOCALE/kubeconfig"
if [ "$LOCALE" = "si" ]; then
  cp "$TMP_LOCALE/k3s.yaml" "$KUBECONFIG_RUN"
else
  porta_api=""
  for p in $(seq 16443 16543); do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then porta_api="$p"; break; fi
  done
  [ -n "$porta_api" ] || errore "Nessuna porta locale libera per il tunnel verso l'API (16443-16543)."
  ssh "${SSH[@]}" -O forward -L "127.0.0.1:$porta_api:127.0.0.1:6443" "$HOST_SSH" >/dev/null 2>&1 \
    || errore "Tunnel ssh verso l'API di k3s non riuscito."
  sed "s#https://127.0.0.1:6443#https://127.0.0.1:$porta_api#" "$TMP_LOCALE/k3s.yaml" > "$KUBECONFIG_RUN"
fi
rm -f "$TMP_LOCALE/k3s.yaml"
chmod 600 "$KUBECONFIG_RUN"
KUBECTL=(kubectl)
if ! command -v kubectl >/dev/null 2>&1; then KUBECTL=(/usr/local/bin/k3s kubectl); fi
kc() { "${KUBECTL[@]}" --kubeconfig "$KUBECONFIG_RUN" "$@"; }
hm() { helm --kubeconfig "$KUBECONFIG_RUN" "$@"; }
kc get --raw /readyz >/dev/null 2>&1 || errore "L'API di k3s non risponde."
v_cluster="$(kc version -o json 2>/dev/null | sed -n '/serverVersion/,$ s/.*"minor": *"\([0-9]*\).*/\1/p' | head -n1)"
# Un k3s già sul server può essere di un'altra versione: l'avviso vale per quella.
[ "${#KUBECTL[@]}" -gt 1 ] || controlla_kubectl "$v_cluster" "il cluster"
nota "API raggiungibile; kubeconfig in $KUBECONFIG_UTENTE"
# Traefik risponde sulla 443 (con il suo certificato) appena ServiceLB apre
# la porta, qualche secondo dopo k3s: da questa macchina si prova l'indirizzo
# che usano i browser; se non si raggiunge (NAT senza hairpin, postazione
# nella rete interna), quello del nodo.
IP_CONTROLLI="$IP_ANNUNCIATO"
raggiungibile() {
  local ip="$1" esito
  for _ in $(seq 1 30); do
    esito=0
    curl -sk -o /dev/null --connect-timeout 5 --max-time 10 "https://$ip/" || esito=$?
    case "$esito" in 7|28) sleep 2 ;; *) return 0 ;; esac
  done
  return 1
}
if ! raggiungibile "$IP_ANNUNCIATO"; then
  if [ "$IP_ANNUNCIATO" != "$NODE_IP" ] && raggiungibile "$NODE_IP"; then
    IP_CONTROLLI="$NODE_IP"
    nota "$IP_ANNUNCIATO:443 non si raggiunge da qui: i controlli passano da $NODE_IP"
  else
    avviso "$IP_ANNUNCIATO:443 non si raggiunge da questa macchina (firewall?): i controlli finali falliranno."
  fi
fi

# ── Segreti ─────────────────────────────────────────────────────
passo "Segreti"
CHIAVI_SEGRETI="APP_SECRET JITSI_JWT_SECRET PII_ENCRYPTION_KEY CRON_API_KEY ADMIN_API_KEY POSTGRES_PASSWORD POSTGRES_ADMIN_PASSWORD REDIS_PASSWORD JICOFO_AUTH_PASSWORD JVB_AUTH_PASSWORD"
esiste_release() { hm status "$RELEASE" -n "$NAMESPACE" >/dev/null 2>&1; }
# Un valore di un Secret del cluster, decodificato.
valore_secret() {
  kc -n "$NAMESPACE" get secret "$1" -o "jsonpath={.data.$2}" 2>/dev/null | base64 --decode 2>/dev/null || true
}
if [ ! -s "$SEGRETI" ]; then
  if kc -n "$NAMESPACE" get secret "$SECRET_APP" >/dev/null 2>&1 || esiste_release; then
    if [ "$RECUPERA" != "si" ]; then
      errore "L'installazione esiste già nel cluster ma manca $SEGRETI.
  Il database è inizializzato con password che non vanno rigenerate. Rimetti il file al suo
  posto, oppure ricostruiscilo dai Secret del cluster con --recover-secrets."
    fi
    {
      printf '# Ricostruito da pa-webinar-up.sh --recover-secrets il %s dai Secret del cluster.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      for k in APP_SECRET JITSI_JWT_SECRET PII_ENCRYPTION_KEY CRON_API_KEY ADMIN_API_KEY; do
        printf '%s=%s\n' "$k" "$(valore_secret "$SECRET_APP" "$k")"
      done
      for k in POSTGRES_PASSWORD POSTGRES_ADMIN_PASSWORD REDIS_PASSWORD; do
        printf '%s=%s\n' "$k" "$(valore_secret "$SECRET_DATI" "$k")"
      done
      printf 'JICOFO_AUTH_PASSWORD=%s\n' "$(valore_secret "$SECRET_JICOFO" JICOFO_AUTH_PASSWORD)"
      printf 'JVB_AUTH_PASSWORD=%s\n' "$(valore_secret "$SECRET_JVB" JVB_AUTH_PASSWORD)"
    } > "$SEGRETI.tmp"
    mv "$SEGRETI.tmp" "$SEGRETI"
    nota "ricostruiti dai Secret del cluster in $SEGRETI"
  else
    hex() { openssl rand -hex "$1"; }
    {
      printf '# Generato da infra/onprem/k3s/pa-webinar-up.sh il %s per %s.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$NOME"
      printf '# Conservalo, con una copia fuori da questa macchina, finché esiste l'"'"'installazione:\n'
      printf '# il database è inizializzato con queste password, e senza PII_ENCRYPTION_KEY i dati\n'
      printf '# personali cifrati non si leggono più. Lo script non lo riscrive mai.\n'
      printf 'APP_SECRET=%s\nJITSI_JWT_SECRET=%s\nPII_ENCRYPTION_KEY=%s\n' "$(hex 32)" "$(hex 32)" "$(hex 32)"
      printf 'CRON_API_KEY=%s\nADMIN_API_KEY=%s\n' "$(hex 32)" "$(hex 32)"
      printf 'POSTGRES_PASSWORD=%s\nPOSTGRES_ADMIN_PASSWORD=%s\nREDIS_PASSWORD=%s\n' "$(hex 24)" "$(hex 24)" "$(hex 24)"
      printf 'JICOFO_AUTH_PASSWORD=%s\nJVB_AUTH_PASSWORD=%s\n' "$(hex 16)" "$(hex 16)"
    } > "$SEGRETI.tmp"
    # Mai sopra un file che esiste: `ln` fallisce se la destinazione c'è già.
    ln "$SEGRETI.tmp" "$SEGRETI" 2>/dev/null || errore "$SEGRETI esiste già: non lo sovrascrivo."
    rm -f "$SEGRETI.tmp"
    nota "generati in $SEGRETI"
  fi
else
  nota "riusati da $SEGRETI"
fi
chmod 600 "$SEGRETI"
# Un valore del file dei segreti (o di un altro file KEY=VALUE).
leggi() { sed -n "s/^$2=//p" "$1" | tail -n1; }
for k in $CHIAVI_SEGRETI; do
  [[ "$(leggi "$SEGRETI" "$k")" =~ ^[0-9a-f]{16,}$ ]] || errore "In $SEGRETI manca $k, o non è esadecimale: completalo a mano (non rigenerare le password del database)."
done

# SMTP: il file dell'operatore, copiato nella cartella di stato; ai lanci
# successivi vale la copia, finché non se ne passa un altro.
if [ -n "$FILE_SMTP" ]; then
  {
    printf '# Copiato da %s da pa-webinar-up.sh il %s.\n' "$FILE_SMTP" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    while IFS= read -r riga || [ -n "$riga" ]; do
      case "$riga" in ''|'#'*) continue ;; esac
      riga="${riga#export }"
      k="$(printf '%s' "${riga%%=*}" | tr -d '[:space:]')"
      v="${riga#*=}"
      v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"
      case "$v" in \"*\") v="${v#\"}"; v="${v%\"}" ;; \'*\') v="${v#\'}"; v="${v%\'}" ;; esac
      case "$k" in
        SMTP_HOST|SMTP_PORT|SMTP_SECURE|SMTP_USER|SMTP_PASSWORD|SMTP_FROM|SMTP_FROM_NAME) printf '%s=%s\n' "$k" "$v" ;;
        *) errore "$FILE_SMTP: chiave sconosciuta '$k' (valgono SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_FROM_NAME)." ;;
      esac
    done < "$FILE_SMTP"
  } > "$SMTP_STATO.tmp"
  mv "$SMTP_STATO.tmp" "$SMTP_STATO"
  for k in SMTP_HOST SMTP_PORT SMTP_FROM; do
    [ -n "$(leggi "$SMTP_STATO" "$k")" ] || errore "$FILE_SMTP: manca $k."
  done
  nota "SMTP da $FILE_SMTP (copia in $SMTP_STATO)"
fi
# L'autorità in più per il portale, copiata allo stesso modo.
if [ -n "$O_CA_EXTRA" ]; then
  grep -q -- '-----BEGIN CERTIFICATE-----' "$O_CA_EXTRA" || errore "$O_CA_EXTRA non contiene un certificato PEM."
  cp "$O_CA_EXTRA" "$STATO/extra-ca.crt"
fi

# ── Namespace e Secret ──────────────────────────────────────────
# Applicati lato server: nessuna copia dei valori nell'annotazione
# last-applied-configuration, e le chiavi tolte dal file spariscono dal Secret.
kc get namespace "$NAMESPACE" >/dev/null 2>&1 || kc create namespace "$NAMESPACE" >/dev/null
applica() { kc apply --server-side --force-conflicts --field-manager=pa-webinar-up -f - >/dev/null; }
secret_da_file() {
  kc -n "$NAMESPACE" create secret generic "$1" --from-env-file="$2" --dry-run=client -o yaml | applica
}
ENV_APP="$TMP_LOCALE/app.env"
{
  for k in APP_SECRET JITSI_JWT_SECRET PII_ENCRYPTION_KEY CRON_API_KEY ADMIN_API_KEY; do
    printf '%s=%s\n' "$k" "$(leggi "$SEGRETI" "$k")"
  done
  printf 'JITSI_JWT_APP_ID=pa_webinar\nJITSI_JWT_ISSUER=pa-webinar\nJITSI_JWT_AUDIENCE=jitsi\n'
  # Lo stesso indirizzo che il chart comporrebbe in modalità generate.
  printf 'DATABASE_URL=postgresql://eventi:%s@%s:5432/pa_webinar\n' "$(leggi "$SEGRETI" POSTGRES_PASSWORD)" "$HOST_DB"
  if [ "$MAILPIT" = "si" ]; then
    printf 'SMTP_HOST=mailpit\nSMTP_PORT=1025\nSMTP_SECURE=false\nSMTP_FROM=no-reply@%s\n' "$PORTALE"
  elif [ -s "$SMTP_STATO" ]; then
    grep -E '^SMTP_[A-Z_]+=' "$SMTP_STATO"
  fi
  if [ "$STORAGE" = "garage" ] && [ -s "$STATO/storage.env" ]; then
    grep -E '^(STORAGE_FILES|RECORDING)_S3_[A-Z_]+=' "$STATO/storage.env" || true
  fi
} > "$ENV_APP"
secret_da_file "$SECRET_APP" "$ENV_APP"
{
  for k in POSTGRES_PASSWORD POSTGRES_ADMIN_PASSWORD REDIS_PASSWORD; do printf '%s=%s\n' "$k" "$(leggi "$SEGRETI" "$k")"; done
} > "$TMP_LOCALE/dati.env"
secret_da_file "$SECRET_DATI" "$TMP_LOCALE/dati.env"
printf 'JWT_APP_SECRET=%s\n' "$(leggi "$SEGRETI" JITSI_JWT_SECRET)" > "$TMP_LOCALE/jwt.env"
secret_da_file "$SECRET_JWT" "$TMP_LOCALE/jwt.env"
printf 'JICOFO_AUTH_PASSWORD=%s\n' "$(leggi "$SEGRETI" JICOFO_AUTH_PASSWORD)" > "$TMP_LOCALE/jicofo.env"
secret_da_file "$SECRET_JICOFO" "$TMP_LOCALE/jicofo.env"
printf 'JVB_AUTH_USER=jvb\nJVB_AUTH_PASSWORD=%s\n' "$(leggi "$SEGRETI" JVB_AUTH_PASSWORD)" > "$TMP_LOCALE/jvb.env"
secret_da_file "$SECRET_JVB" "$TMP_LOCALE/jvb.env"
rm -f "$ENV_APP" "$TMP_LOCALE"/*.env
nota "Secret $SECRET_APP, $SECRET_DATI, $SECRET_JWT, $SECRET_JICOFO, $SECRET_JVB nel namespace $NAMESPACE"

# ── Certificati ─────────────────────────────────────────────────
passo "Certificati ($TLS)"
NOMI_TLS=("portale:$PORTALE:$TLS_PORTALE" "conferenza:$CONFERENZA:$TLS_CONFERENZA")
[ "$STORAGE" = "garage" ] && NOMI_TLS+=("storage:$HOST_STORAGE:$TLS_STORAGE")
[ "$TURN" = "si" ] && NOMI_TLS+=("turn:$HOST_TURN:$TLS_TURN")
valido_per() { openssl x509 -in "$1" -noout -checkend $(( $2 * 86400 )) >/dev/null 2>&1; }
coppia() {
  local a b
  a="$(openssl pkey -in "$1" -pubout 2>/dev/null)"; b="$(openssl x509 -in "$2" -pubkey -noout 2>/dev/null)"
  [ -n "$b" ] && [ "$a" = "$b" ]
}
copre() { openssl x509 -in "$1" -noout -checkhost "$2" 2>/dev/null | grep -q 'does match'; }
secret_tls() {
  kc -n "$NAMESPACE" create secret tls "$1" --cert="$2" --key="$3" --dry-run=client -o yaml | applica
}
CA_CRT=""
case "$TLS" in
  private-ca)
    # Come scripts/minikube-up.sh: un'autorità tutta di questa installazione,
    # che può firmare solo sotto i nomi scelti (nameConstraints): chi ne
    # ottenesse la chiave non potrebbe spacciarsi per nessun altro sito.
    CA_KEY="$STATO/ca.key"; CA_CRT="$STATO/ca.crt"; TLS_DIR="$STATO/tls"
    mkdir -p "$TLS_DIR"
    # I nomi permessi sono il portale e la conferenza, ciascuno con i suoi
    # sottodomini (s3.<portale> e turn.<portale> compresi); uno storage o un
    # TURN con un nome fuori da questi si aggiunge a parte.
    permessi_dns=("$PORTALE" "$CONFERENZA")
    for voce in "${NOMI_TLS[@]}"; do
      resto="${voce#*:}"; h="${resto%%:*}"
      case "$h" in "$PORTALE"|*".$PORTALE"|"$CONFERENZA"|*".$CONFERENZA") ;; *) permessi_dns+=("$h") ;; esac
    done
    ca_copre() {
      local n="$1" d
      for d in $(openssl x509 -in "$CA_CRT" -noout -text 2>/dev/null | grep -E '^ *DNS:' | sed 's/^ *DNS://'); do
        case "$n" in "$d"|*".$d") return 0 ;; esac
      done
      return 1
    }
    nuova_ca="no"
    if [ -s "$CA_KEY" ] && [ -s "$CA_CRT" ] && coppia "$CA_KEY" "$CA_CRT" && valido_per "$CA_CRT" 30; then
      for voce in "${NOMI_TLS[@]}"; do
        h="$(printf '%s' "$voce" | cut -d: -f2)"
        ca_copre "$h" || errore "L'autorità in $CA_CRT non può firmare $h (creata per altri nomi).
  Per crearne una nuova: rm '$CA_KEY' '$CA_CRT' e rilancia; poi togli la vecchia dai browser e
  aggiungi la nuova."
      done
      nota "autorità locale riusata: $CA_CRT"
    else
      permessi=""
      for d in "${permessi_dns[@]}"; do permessi="${permessi:+$permessi,}permitted;DNS:$d"; done
      cat > "$TMP_LOCALE/ca.cnf" <<FINE
[req]
distinguished_name = dn
prompt = no
[dn]
CN = PA Webinar CA ($NOME, $(date -u +%Y-%m-%d))
[v3_ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
nameConstraints = critical, $permessi
FINE
      openssl ecparam -name prime256v1 -genkey -noout -out "$CA_KEY" 2>/dev/null
      chmod 600 "$CA_KEY"
      openssl req -new -x509 -key "$CA_KEY" -config "$TMP_LOCALE/ca.cnf" -extensions v3_ca -sha256 \
        -days 3650 -set_serial "0x$(openssl rand -hex 16)" -out "$CA_CRT" \
        || errore "openssl non ha creato l'autorità locale."
      rm -f "$TLS_DIR"/*.crt "$TLS_DIR"/*.key
      nuova_ca="si"
      nota "autorità locale creata: $CA_CRT (10 anni, solo per nomi sotto: ${permessi_dns[*]})"
    fi
    for voce in "${NOMI_TLS[@]}"; do
      ruolo="${voce%%:*}"; resto="${voce#*:}"; h="${resto%%:*}"; nome_secret="${resto#*:}"
      chiave="$TLS_DIR/$ruolo.key"; cert="$TLS_DIR/$ruolo.crt"
      if ! { [ -s "$chiave" ] && [ -s "$cert" ] && coppia "$chiave" "$cert" && valido_per "$cert" 30 \
             && openssl verify -CAfile "$CA_CRT" "$cert" >/dev/null 2>&1 && copre "$cert" "$h"; }; then
        cat > "$TMP_LOCALE/leaf.cnf" <<FINE
[v3_leaf]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = DNS:$h
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
FINE
        openssl ecparam -name prime256v1 -genkey -noout -out "$chiave" 2>/dev/null
        chmod 600 "$chiave"
        openssl req -new -key "$chiave" -subj "/CN=$h" -out "$TMP_LOCALE/leaf.csr" 2>/dev/null
        # 397 giorni: il massimo che i browser accettano per il certificato di un sito.
        openssl x509 -req -in "$TMP_LOCALE/leaf.csr" -CA "$CA_CRT" -CAkey "$CA_KEY" -set_serial "0x$(openssl rand -hex 16)" \
          -days 397 -sha256 -extfile "$TMP_LOCALE/leaf.cnf" -extensions v3_leaf -out "$cert" 2>/dev/null \
          || errore "openssl non ha firmato il certificato di $h."
        nota "certificato per $h"
      fi
      secret_tls "$nome_secret" "$cert" "$chiave"
    done
    ;;
  own)
    # Ogni nome va coperto da una delle coppie date (anche wildcard). Senza
    # coppie nuove si tengono i Secret già nel cluster.
    coppie=()
    i=0
    while [ "$i" -lt "${#CERTIFICATI[@]}" ]; do coppie+=("${CERTIFICATI[$i]}|${CHIAVI[$i]}"); i=$((i + 1)); done
    if [ -n "$CARTELLA_CERT" ]; then
      for c in "$CARTELLA_CERT"/*.crt "$CARTELLA_CERT"/*.pem; do
        [ -e "$c" ] || continue
        k="${c%.*}.key"
        if [ -r "$k" ]; then coppie+=("$c|$k"); fi
      done
      [ "${#coppie[@]}" -gt 0 ] || errore "In $CARTELLA_CERT non trovo coppie <nome>.crt (o .pem) e <nome>.key."
    fi
    for voce in "${NOMI_TLS[@]}"; do
      resto="${voce#*:}"; h="${resto%%:*}"; nome_secret="${resto#*:}"
      if [ "${#coppie[@]}" -eq 0 ]; then
        kc -n "$NAMESPACE" get secret "$nome_secret" >/dev/null 2>&1 \
          || errore "Manca il certificato di $h: passalo con --cert/--key o --cert-dir."
        kc -n "$NAMESPACE" get secret "$nome_secret" -o jsonpath='{.data.tls\.crt}' | base64 --decode > "$TMP_LOCALE/esistente.crt"
        valido_per "$TMP_LOCALE/esistente.crt" 30 || avviso "il certificato di $h (Secret $nome_secret) scade entro 30 giorni: rilancia con --cert/--key nuovi."
        nota "$h: Secret $nome_secret già nel cluster"
        continue
      fi
      scelta=""
      for cp in "${coppie[@]}"; do
        c="${cp%%|*}"; k="${cp#*|}"
        if copre "$c" "$h"; then scelta="$cp"; break; fi
      done
      [ -n "$scelta" ] || errore "Nessun certificato dato copre $h."
      c="${scelta%%|*}"; k="${scelta#*|}"
      coppia "$k" "$c" || errore "$k non è la chiave del certificato $c."
      valido_per "$c" 0 || errore "Il certificato $c è scaduto."
      valido_per "$c" 30 || avviso "il certificato di $h scade entro 30 giorni."
      # Verifica con le autorità di sistema (e con --ca-file): i browser
      # vogliono anche i certificati intermedi nel file.
      verifica=(openssl verify -untrusted "$c")
      if [ -s "$STATO/extra-ca.crt" ]; then verifica+=(-CAfile "$STATO/extra-ca.crt"); fi
      "${verifica[@]}" "$c" >/dev/null 2>&1 \
        || avviso "il certificato di $h non si verifica$( [ -s "$STATO/extra-ca.crt" ] && printf ' nemmeno con --ca-file' ): manca un intermedio nel file, o i browser devono fidarsi dell'autorità dell'ente."
      secret_tls "$nome_secret" "$c" "$k"
      nota "$h: $(basename "$c") nel Secret $nome_secret"
    done
    ;;
  acme)
    if [ -n "$SERVER_ACME" ]; then server_acme="$SERVER_ACME"; else server_acme="Let's Encrypt"; fi
    nota "Traefik chiede i certificati a $server_acme (resolver $RESOLVER_ACME)"
    ;;
esac
# Le autorità di cui il portale si fida in più: quella locale e --ca-file.
if [ -n "$CA_CRT" ] || [ -s "$STATO/extra-ca.crt" ]; then
  : > "$TMP_LOCALE/ca-bundle.crt"
  if [ -n "$CA_CRT" ]; then cat "$CA_CRT" >> "$TMP_LOCALE/ca-bundle.crt"; fi
  if [ -s "$STATO/extra-ca.crt" ]; then cat "$STATO/extra-ca.crt" >> "$TMP_LOCALE/ca-bundle.crt"; fi
  kc -n "$NAMESPACE" create configmap "$CM_CA" --from-file=ca.crt="$TMP_LOCALE/ca-bundle.crt" --dry-run=client -o yaml | applica
  CA_PORTALE="si"
else
  CA_PORTALE="no"
fi
# Il certificato con cui controllare i nomi da questa macchina.
CA_CONTROLLI="${CA_CRT:-}"
if [ -z "$CA_CONTROLLI" ] && [ -s "$STATO/extra-ca.crt" ]; then CA_CONTROLLI="$STATO/extra-ca.crt"; fi

# ── Casella di prova per le email ───────────────────────────────
if [ "$MAILPIT" = "si" ]; then
  passo "Mailpit (casella di prova)"
  applica <<FINE
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mailpit
  namespace: $NAMESPACE
  labels: { app.kubernetes.io/name: mailpit, app.kubernetes.io/part-of: pa-webinar-k3s }
spec:
  replicas: 1
  selector:
    matchLabels: { app.kubernetes.io/name: mailpit }
  template:
    metadata:
      labels: { app.kubernetes.io/name: mailpit }
    spec:
      containers:
        - name: mailpit
          image: $MAILPIT_IMMAGINE
          env:
            - { name: MP_SMTP_AUTH_ACCEPT_ANY, value: "1" }
            - { name: MP_SMTP_AUTH_ALLOW_INSECURE, value: "1" }
            - { name: MP_MAX_MESSAGES, value: "500" }
          ports:
            - { name: smtp, containerPort: 1025 }
            - { name: http, containerPort: 8025 }
          resources:
            requests: { cpu: 10m, memory: 32Mi }
            limits: { memory: 128Mi }
---
apiVersion: v1
kind: Service
metadata:
  name: mailpit
  namespace: $NAMESPACE
  labels: { app.kubernetes.io/name: mailpit, app.kubernetes.io/part-of: pa-webinar-k3s }
spec:
  selector: { app.kubernetes.io/name: mailpit }
  ports:
    - { name: smtp, port: 1025, targetPort: smtp }
    - { name: http, port: 8025, targetPort: http }
FINE
  # Nessun Ingress: i messaggi contengono link di accesso, e la casella non
  # ha password. Si legge con port-forward (vedi il riepilogo).
  nota "servizio mailpit:1025 nel namespace (nessun indirizzo pubblico)"
else
  if kc -n "$NAMESPACE" get deployment mailpit >/dev/null 2>&1; then
    kc -n "$NAMESPACE" delete deployment,service mailpit --ignore-not-found >/dev/null
    nota "casella di prova Mailpit tolta"
  fi
fi

# ── Componenti facoltativi (infra/onprem/k3s/addons) ────────────
# Stessi argomenti per storage e TURN: kubeconfig del lancio, cartella di
# stato, e il certificato secondo il modo scelto.
argomenti_addon() {
  local host="$1" nome_secret="$2"
  printf '%s\n' --kubeconfig "$KUBECONFIG_RUN" --namespace "$NAMESPACE" --release "$RELEASE" --state-dir "$STATO" --host "$host"
  if [ "$TLS" = "acme" ]; then printf '%s\n' --cert-resolver "$RESOLVER_ACME"; else printf '%s\n' --tls-secret "$nome_secret"; fi
  printf '%s\n' --resolve "$IP_CONTROLLI"
  [ -n "$CA_CONTROLLI" ] && printf '%s\n' --cacert "$CA_CONTROLLI"
  return 0
}
VALORI_EXTRA=()
if [ "$STORAGE" = "garage" ]; then
  passo "Object storage (Garage su $HOST_STORAGE)"
  addon="$CARTELLA/addons/storage.sh"
  [ -x "$addon" ] || errore "--storage garage: $addon non c'è in questo checkout."
  args=(); while IFS= read -r a; do args+=("$a"); done < <(argomenti_addon "$HOST_STORAGE" "$TLS_STORAGE")
  # Le istruzioni finali dello script (helm, file da aggiungere) le esegue
  # questo script: non si mostrano.
  if ! "$addon" "${args[@]}" --portal-url "https://$PORTALE" 2>&1 | sed '/^Fatto\./,$d; s/^/   /'; then
    errore "storage.sh non riuscito (vedi sopra)."
  fi
  if [ -f "$CHART/examples/values-k3s-storage.yaml" ]; then VALORI_EXTRA+=(-f "$CHART/examples/values-k3s-storage.yaml"); fi
fi
if [ "$TURN" = "si" ]; then
  passo "TURN ($HOST_TURN)"
  addon="$CARTELLA/addons/turn.sh"
  [ -x "$addon" ] || errore "--turn: $addon non c'è in questo checkout."
  args=(); while IFS= read -r a; do args+=("$a"); done < <(argomenti_addon "$HOST_TURN" "$TLS_TURN")
  if ! "$addon" "${args[@]}" 2>&1 | sed '/^Fatto\./,$d; s/^/   /'; then
    errore "turn.sh non riuscito (vedi sopra)."
  fi
  if [ -f "$CHART/examples/values-k3s-turn.yaml" ]; then VALORI_EXTRA+=(-f "$CHART/examples/values-k3s-turn.yaml"); fi
fi

# ── Immagini ────────────────────────────────────────────────────
passo "Immagini"
K3S_BIN=/usr/local/bin/k3s
# Chiede a ghcr.io il manifesto di repository:tag senza credenziali (come
# scripts/minikube-up.sh): 0 se il prelievo anonimo è concesso, 1 se il
# registro lo rifiuta, 2 se ghcr.io non risponde da qui.
prelievo_anonimo() {
  local repo="${1%%:*}" tag="${1#*:}" risposta token codice
  risposta="$(curl -sS --max-time 20 "https://ghcr.io/token?scope=repository:$repo:pull" 2>/dev/null)" || return 2
  token="$(printf '%s' "$risposta" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  [ -n "$token" ] || return 1
  codice="$(printf 'Authorization: Bearer %s\n' "$token" \
    | curl -sS --max-time 20 --head -o /dev/null -w '%{http_code}' -H @- \
        -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json' \
        "https://ghcr.io/v2/$repo/manifests/$tag" 2>/dev/null)" || return 2
  [ "$codice" = "200" ]
}
if [ "$IMMAGINI" = "auto" ]; then
  if [ "$RILASCIO" = "si" ] && [ "$MODIFICATO" = "no" ] \
     && prelievo_anonimo "${REPO_IMMAGINE_PUBBLICATA#ghcr.io/}:$TAG_APP" \
     && prelievo_anonimo "${REPO_IMMAGINE_PUBBLICATA#ghcr.io/}:$TAG_MIG"; then
    IMMAGINI_ORA="registry"
    nota "ghcr.io dà $TAG_APP senza credenziali: il server le preleva da sé"
  else
    IMMAGINI_ORA="local"
    if [ "$RILASCIO" = "si" ] && [ "$MODIFICATO" = "no" ]; then
      nota "ghcr.io non dà $REPO_IMMAGINE_PUBBLICATA:$TAG_APP senza credenziali: le costruisco da questo checkout"
    fi
  fi
else
  IMMAGINI_ORA="$IMMAGINI"
fi
IMPRONTA_IMMAGINI=""
# Un'etichetta nel containerd del server ricorda da quale immagine docker
# viene la copia importata: la seconda volta si salta il trasferimento.
etichetta_nodo() {
  remoto_root "$K3S_BIN" ctr -n k8s.io images ls "name==$1" 2>/dev/null \
    | awk 'NR > 1' | tr ',' '\n' | sed -n 's/.*io\.pa-webinar\.docker-id=\(sha256:[0-9a-f]*\).*/\1/p' | head -n1
}
case "$IMMAGINI_ORA" in
  registry)
    IMG_REPO="$REPO_IMMAGINE_PUBBLICATA"; IMG_POLICY="IfNotPresent"
    [ "$RILASCIO" = "si" ] || errore "--images registry vuole un rilascio: il checkout non è su un tag vX.Y.Z (git checkout del tag, o --tag X.Y.Z)."
    # Il server le preleva da sé: senza prelievo anonimo servono le
    # credenziali in --registries, altrimenti helm aspetterebbe un quarto
    # d'ora di ImagePullBackOff.
    esito=0
    prelievo_anonimo "${REPO_IMMAGINE_PUBBLICATA#ghcr.io/}:$TAG_APP" || esito=$?
    if [ "$esito" = "1" ] && [ -z "$REGISTRI" ]; then
      errore "ghcr.io non dà $IMG_REPO:$TAG_APP senza credenziali, e non hai passato --registries.
  Alternative: --images local (costruite da questo checkout), --images archive, oppure le
  credenziali di lettura del registro in un registries.yaml (vedi registries.yaml.example)."
    fi
    [ "$esito" = "2" ] && avviso "ghcr.io non risponde da questa macchina: non so se il server potrà prelevare $IMG_REPO:$TAG_APP."
    nota "$IMG_REPO:$TAG_APP e $TAG_MIG, prelevate dal server"
    ;;
  local)
    if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
      errore "Per costruire le immagini serve docker su questa macchina. Alternative: --images archive
  (un archivio di preload-images.sh build fatto altrove) o --images registry."
    fi
    IMG_REPO="$REPO_IMMAGINE_LOCALE"; IMG_POLICY="Never"
    nota "docker build da $RADICE (la prima volta alcuni minuti; registro in $STATO/build.log)…"
    : > "$STATO/build.log"
    costruisci_immagini "$RADICE" "$IMG_REPO:$TAG_APP" "$IMG_REPO:$TAG_MIG" "$STATO/build.log" \
      || { tail -n 30 "$STATO/build.log" >&2; errore "docker build non riuscito (le ultime righe qui sopra, tutto in $STATO/build.log)."; }
    # Le immagini costruite su questa macchina, una per riga: le toglie
    # pa-webinar-down.sh --purge-images.
    for img in "$IMG_REPO:$TAG_APP" "$IMG_REPO:$TAG_MIG"; do
      grep -qxF "$img" "$STATO/images.built" 2>/dev/null || printf '%s\n' "$img" >> "$STATO/images.built"
    done
    ids=""
    for img in "$IMG_REPO:$TAG_APP" "$IMG_REPO:$TAG_MIG"; do
      arch_img="$(docker image inspect --format '{{.Architecture}}' "$img")"
      case "$f_arch:$arch_img" in x86_64:amd64|aarch64:arm64) ;; *) errore "$img è $arch_img, il server è $f_arch." ;; esac
      id="$(docker image inspect --format '{{.Id}}' "$img")"
      ids="$ids $id"
      nome_ctr="docker.io/library/$img"
      if [ "$(etichetta_nodo "$nome_ctr")" = "$id" ] && remoto_root "$K3S_BIN" crictl inspecti "$nome_ctr" >/dev/null 2>&1; then
        nota "$img già sul server"
        continue
      fi
      nota "importo $img sul server…"
      docker save "$img" | remoto_root "$K3S_BIN" ctr -n k8s.io images import - >/dev/null \
        || errore "Importazione di $img sul server non riuscita."
      # Fissata contro la pulizia del kubelet: il server non potrebbe riprelevarla.
      remoto_root "$K3S_BIN" ctr -n k8s.io images label "$nome_ctr" io.cri-containerd.pinned=pinned "io.pa-webinar.docker-id=$id" >/dev/null \
        || errore "Etichette su $nome_ctr non riuscite."
      remoto_root "$K3S_BIN" crictl inspecti "$nome_ctr" >/dev/null 2>&1 || errore "$nome_ctr non risulta sul server dopo l'importazione."
    done
    IMPRONTA_IMMAGINI="$(printf '%s' "$ids" | openssl dgst -sha256 | awk '{print substr($NF, 1, 16)}')"
    ;;
  archive)
    # Il repository delle immagini dell'applicazione è quello registrato
    # nell'archivio (pubblicate o costruite con preload-images.sh build).
    indice="$(tar -xOf "$ARCHIVIO" index.json 2>/dev/null)" || errore "$ARCHIVIO non è un archivio di preload-images.sh."
    riferimenti="$(printf '%s' "$indice" | sed -nE 's/.*"io\.pa-webinar\.chart-ref": *"([^"]+)".*/\1/p')"
    trova() { printf '%s\n' "$riferimenti" | grep -E "(^|/)pa-webinar:$1\$" | head -n1; }
    ref_app="$(trova "$TAG_APP")"; ref_mig="$(trova "$TAG_MIG")"
    if [ -z "$ref_app" ] || [ -z "$ref_mig" ]; then
      errore "L'archivio non ha $TAG_APP e $TAG_MIG (il checkout li vuole). Ha:
$(printf '%s\n' "$riferimenti" | grep -E '(^|/)pa-webinar:' | sed 's/^/    /')
  Rifallo da questo checkout (preload-images.sh build o save), o passa --tag."
    fi
    IMG_REPO="${ref_app%:*}"; IMG_REPO="${IMG_REPO#docker.io/library/}"
    case "$IMG_REPO" in */*.*/*|*.*/*) IMG_POLICY="IfNotPresent" ;; *) IMG_POLICY="Never" ;; esac
    impronta_arch="$(openssl dgst -sha256 < "$ARCHIVIO" | awk '{print $NF}')"
    IMPRONTA_IMMAGINI="${impronta_arch:0:16}"
    presenti="si"
    for r in $riferimenti; do
      remoto_root "$K3S_BIN" crictl inspecti "$r" >/dev/null 2>&1 || { presenti="no"; break; }
    done
    if [ "$presenti" = "si" ] && [ "$(cat "$STATO/archive.sha256" 2>/dev/null || true)" = "$impronta_arch" ]; then
      nota "archivio già importato sul server"
    else
      nota "copio e importo $ARCHIVIO ($(du -h "$ARCHIVIO" | cut -f1))…"
      remoto_archivio="$(porta_file "$ARCHIVIO" images.tar)"
      if ! remoto_root bash "$DIR_SCRIPT/preload-images.sh" import "$remoto_archivio" 2>&1 | sed 's/^/   /'; then
        errore "Importazione dell'archivio non riuscita (vedi sopra)."
      fi
      if [ "$LOCALE" = "no" ]; then remoto rm -f "$remoto_archivio"; fi
      printf '%s\n' "$impronta_arch" > "$STATO/archive.sha256"
    fi
    ;;
esac
# Dopo i componenti facoltativi, che aggiungono le loro chiavi al Secret.
IMPRONTA_SEGRETI="$(kc -n "$NAMESPACE" get secret "$SECRET_APP" -o jsonpath='{.data}' | openssl dgst -sha256 | awk '{print substr($NF, 1, 16)}')"

# ── Valori del sito ─────────────────────────────────────────────
scrivi_sito "$SITO"
nota "valori del sito: $SITO"

# ── Sottocharts ─────────────────────────────────────────────────
# Non sono versionati. Si scaricano con un elenco di repository temporaneo,
# per non toccare quello di chi lancia lo script.
if [ -z "$(ls -A "$CHART/charts" 2>/dev/null)" ]; then
  passo "Sottocharts"
  repo_tmp="$TMP_LOCALE/helm"
  helm repo add bitnami https://charts.bitnami.com/bitnami \
    --repository-config "$repo_tmp/repositories.yaml" --repository-cache "$repo_tmp/cache" >/dev/null
  helm repo add jitsi-contrib https://jitsi-contrib.github.io/jitsi-helm/ \
    --repository-config "$repo_tmp/repositories.yaml" --repository-cache "$repo_tmp/cache" >/dev/null
  helm dependency build "$CHART" \
    --repository-config "$repo_tmp/repositories.yaml" --repository-cache "$repo_tmp/cache" >/dev/null
fi

# ── Installazione ───────────────────────────────────────────────
# Un solo modello, per la prima installazione e per ogni aggiornamento: il
# profilo e l'overlay del rilascio del checkout, poi i valori del sito (e dei
# componenti facoltativi); i segreti sono già nei Secret.
if esiste_release; then operazione="aggiornamento"; else operazione="prima installazione"; fi
passo "Helm: $operazione di '$RELEASE' in $NAMESPACE (attesa massima $ATTESA)"
VALORI=(-f "$CHART/examples/values-simple.yaml" -f "$CHART/examples/values-k3s.yaml")
VALORI+=(${VALORI_EXTRA[@]+"${VALORI_EXTRA[@]}"})
VALORI+=(-f "$SITO")
[ "$STORAGE" = "garage" ] && [ -f "$STATO/values-storage.yaml" ] && VALORI+=(-f "$STATO/values-storage.yaml")
[ "$TURN" = "si" ] && [ -f "$STATO/values-turn.yaml" ] && VALORI+=(-f "$STATO/values-turn.yaml")
[ "$operazione" = "prima installazione" ] && nota "le migrazioni ripartono qualche volta finché PostgreSQL non è pronto: è normale."
inizio=$(date +%s)
# Senza --wait: l'attesa di helm pretende anche i volumi legati, e con
# local-path un volume si lega solo quando un pod lo usa (quello del backup,
# la prima notte). Si aspettano invece, qui sotto, Deployment e StatefulSet,
# comprese le migrazioni (initContainer del portale) e i riavvii che gli hook
# del chart fanno dopo helm (il front end della conferenza).
if ! hm upgrade --install "$RELEASE" "$CHART" -n "$NAMESPACE" "${VALORI[@]}" \
    --timeout "$ATTESA" > "$STATO/helm-notes.txt"; then
  errore "helm non ha completato (vedi sopra)."
fi
# L'hook del chart dopo ogni installazione o aggiornamento (web-config-reload)
# riavvia il front end della conferenza. Helm aspetta che il suo Job finisca;
# se un'altra versione di Helm non lo facesse, lo si aspetta qui, perché il
# ciclo sotto deve vedere il riavvio già chiesto. Poi il ciclo aspetta ogni
# rollout, compreso quel riavvio: fino ad allora la conferenza risponde 502.
kc -n "$NAMESPACE" wait --for=condition=complete job -l app.kubernetes.io/component=config-reload \
  --timeout=120s >/dev/null 2>&1 || true
for risorsa in $(kc -n "$NAMESPACE" get deployment,statefulset -o name); do
  if ! kc -n "$NAMESPACE" rollout status "$risorsa" --timeout="$ATTESA" >/dev/null; then
    printf '\n' >&2
    kc -n "$NAMESPACE" get pods >&2 || true
    kc -n "$NAMESPACE" get events --sort-by=.lastTimestamp 2>/dev/null | tail -n 15 >&2 || true
    errore "$risorsa non è pronto dopo $ATTESA. Stato dei pod ed eventi recenti qui sopra."
  fi
done
nota "pronta in $(( $(date +%s) - inizio )) s"
# Il volume delle copie notturne (--backup): local-path lo crea solo quando un
# pod lo usa, e fino alla prima notte resta Pending, così un `helm --wait` a
# mano si fermerebbe ad aspettarlo. La prima copia, subito, lega il volume e
# prova che le copie funzionano.
if [ "$BACKUP" = "si" ]; then
  filtro_copie="app.kubernetes.io/component=backup,app.kubernetes.io/instance=$RELEASE"
  stato_pvc="$(kc -n "$NAMESPACE" get pvc -l "$filtro_copie" -o jsonpath='{range .items[*]}{.status.phase}{" "}{end}' 2>/dev/null || true)"
  cj_copie="$(kc -n "$NAMESPACE" get cronjob -l "$filtro_copie" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  case "$stato_pvc" in *Pending*) ;; *) cj_copie="" ;; esac
  if [ -n "$cj_copie" ]; then
    job_copia="${cj_copie:0:50}-$(date +%s)"
    nota "prima copia del database ($job_copia): lega il volume delle copie e prova che funzionano…"
    esito_copia=""
    if kc -n "$NAMESPACE" create job "$job_copia" --from="cronjob/$cj_copie" >/dev/null; then
      for _ in $(seq 1 120); do
        condizioni="$(kc -n "$NAMESPACE" get job "$job_copia" -o jsonpath='{range .status.conditions[*]}{.type}={.status}{" "}{end}' 2>/dev/null || true)"
        case "$condizioni" in *Complete=True*) esito_copia="ok"; break ;; *Failed=True*) esito_copia="no"; break ;; esac
        sleep 5
      done
    fi
    if [ "$esito_copia" = "ok" ]; then
      riga_copia="$(kc -n "$NAMESPACE" logs "job/$job_copia" 2>/dev/null | sed -n 's/^copia: //p' | tail -n1 || true)"
      nota "prima copia fatta${riga_copia:+: $riga_copia}"
    else
      avviso "la prima copia del database non è riuscita, e il volume delle copie può restare Pending: kubectl --kubeconfig $KUBECONFIG_UTENTE -n $NAMESPACE logs job/$job_copia"
    fi
  fi
fi
# Le note del chart: solo la sezione di ciò che resta da controllare.
if grep -q "Da controllare" "$STATO/helm-notes.txt"; then
  awk '/─── Da controllare/ { on = 1; print; next } on && /^─── / { exit } on { print }' "$STATO/helm-notes.txt" | sed 's/^/   /'
fi

# ── Controlli ───────────────────────────────────────────────────
passo "Controlli"
# --resolve: il controllo vale anche prima che il DNS punti al server.
curl_nome() {
  local h="$1"; shift
  local ca=()
  [ -n "$CA_CONTROLLI" ] && ca=(--cacert "$CA_CONTROLLI")
  curl -s ${ca[@]+"${ca[@]}"} --max-time 20 --resolve "$h:443:$IP_CONTROLLI" --resolve "$h:80:$IP_CONTROLLI" "$@"
}
if [ "$TLS" = "acme" ]; then
  # Il primo certificato arriva qualche secondo dopo che Traefik vede gli
  # Ingress: finché non c'è, serve il suo certificato predefinito.
  nota "attendo i certificati ACME (fino a 5 minuti)…"
  for h in "$PORTALE" "$CONFERENZA"; do
    emesso="no"
    for _ in $(seq 1 60); do
      emittente="$(openssl s_client -connect "$IP_CONTROLLI:443" -servername "$h" </dev/null 2>/dev/null \
        | openssl x509 -noout -issuer 2>/dev/null || true)"
      case "$emittente" in *TRAEFIK*|'') sleep 5 ;; *) emesso="si"; break ;; esac
    done
    if [ "$emesso" = "si" ]; then
      nota "$h: certificato di ${emittente#issuer=}"
    else
      errore "$h: nessun certificato ACME dopo 5 minuti. Controlla che $h punti a questo server, che la porta 443
  sia raggiungibile dal server ACME, e i log: kubectl --kubeconfig $KUBECONFIG_STATO -n kube-system logs deploy/traefik"
    fi
  done
fi
# Ogni aggiornamento fa ripartire il front end della conferenza (hook del
# chart): per qualche secondo dopo il cambio di pod Traefik risponde ancora
# 502. Si aspetta che portale e conferenza rispondano cinque volte di fila,
# per al massimo due minuti.
salute=""; codice=""; di_fila=0
for _ in $(seq 1 120); do
  salute="$(curl_nome "$PORTALE" "https://$PORTALE/api/health" 2>&1 || true)"
  codice="$(curl_nome "$CONFERENZA" -o /dev/null -w '%{http_code}' "https://$CONFERENZA/config.js" 2>&1 || true)"
  case "$salute:$codice" in
    *'"status":"ok"'*:200) di_fila=$((di_fila + 1)); [ "$di_fila" -ge 5 ] && break ;;
    *) di_fila=0 ;;
  esac
  sleep 1
done
case "$salute" in
  *'"status":"ok"'*) nota "portale: /api/health ok, certificato verificato" ;;
  *) errore "il portale non risponde come atteso su https://$PORTALE/api/health: ${salute:-nessuna risposta (certificato non verificato?)}" ;;
esac
[ "$codice" = "200" ] || errore "la conferenza risponde '$codice' su https://$CONFERENZA/config.js"
nota "conferenza: config.js 200, certificato verificato"
for h in "$PORTALE" "$CONFERENZA"; do
  rinvio="$(curl_nome "$h" -o /dev/null -w '%{http_code} %{redirect_url}' "http://$h/" || true)"
  case "$rinvio" in
    30[178]" https://$h/"*) ;;
    *) errore "http://$h/ non rimanda a https (risposta: $rinvio)" ;;
  esac
done
nota "http rimanda a https su portale e conferenza"
VERIFICA="$RADICE/scripts/verify-install.sh"
if [ -x "$VERIFICA" ]; then
  nota "scripts/verify-install.sh…"
  argomenti_verifica=(--kubeconfig "$KUBECONFIG_RUN" --namespace "$NAMESPACE" --release "$RELEASE"
    --url "https://$PORTALE" --meet-url "https://$CONFERENZA" --secrets-file "$SEGRETI" --resolve "$IP_CONTROLLI")
  if [ -n "$CA_CONTROLLI" ]; then argomenti_verifica+=(--ca-file "$CA_CONTROLLI"); fi
  if [ "$PROVA_CHIAMATA" = "si" ]; then argomenti_verifica+=(--call); fi
  if [ "$PROVA_CHIAMATA" = "si" ] && [ -n "$BROWSER_PROVA" ]; then argomenti_verifica+=(--browser "$BROWSER_PROVA"); fi
  if ! "$VERIFICA" "${argomenti_verifica[@]}" 2>&1 | sed 's/^/   /'; then
    errore "scripts/verify-install.sh ha trovato problemi (vedi sopra)."
  fi
fi

# ── Riepilogo ───────────────────────────────────────────────────
cat <<FINE

✓ PA Webinar è su ${HOST_SSH:-questo server} (k3s, namespace $NAMESPACE, $( [ "$RILASCIO" = "si" ] && printf 'rilascio %s' "$TAG_APP" || printf 'checkout %s' "${TAG_APP#local-}")).

  Portale              https://$PORTALE
  Amministrazione      https://$PORTALE/it/admin/login
  Conferenza           https://$CONFERENZA
FINE
[ "$STORAGE" = "garage" ] && printf '  Object storage       https://%s\n' "$HOST_STORAGE"
[ "$TURN" = "si" ] && printf '  TURN                 %s (UDP 3478, TCP 443)\n' "$HOST_TURN"
cat <<FINE

  Chiave di amministrazione: ADMIN_API_KEY in $SEGRETI
    (grep ADMIN_API_KEY '$SEGRETI'). Serve al primo accesso: poi crea un
    amministratore nominale (Persone > Account) e custodisci la chiave.
  Segreti, certificati e opzioni: $STATO. Tienine una copia cifrata fuori da
  questa macchina: senza secrets.env i dati non si recuperano.
FINE
# I comandi del riepilogo, pronti da copiare: gli argomenti con spazi o
# caratteri speciali escono tra apici (cita).
argomenti_cluster=(--kubeconfig "$KUBECONFIG_UTENTE")
[ "$NAMESPACE" = "pa-webinar" ] || argomenti_cluster+=(--namespace "$NAMESPACE")
[ "$RELEASE" = "pa-webinar" ] || argomenti_cluster+=(--release "$RELEASE")
cmd_verifica=(--secrets-file "$SEGRETI")
if [ -n "$CA_CONTROLLI" ]; then cmd_verifica+=(--ca-file "$CA_CONTROLLI"); fi
# --resolve solo se da questa macchina i nomi non portano già al server.
if [ "$(risolvi "$PORTALE")" != "$IP_CONTROLLI" ] || [ "$(risolvi "$CONFERENZA")" != "$IP_CONTROLLI" ]; then
  cmd_verifica+=(--resolve "$IP_CONTROLLI")
fi
if [ "$PROVA_CHIAMATA" = "si" ]; then
  cmd_verifica+=(--call)
  if [ -n "$BROWSER_PROVA" ]; then cmd_verifica+=(--browser "$BROWSER_PROVA"); fi
fi
printf '\nAccesso al cluster\n'
if [ "$LOCALE" = "no" ]; then
  # Una sola ricetta, con chiave, porta e opzioni ssh ricordate. In primo
  # piano: si vede che è aperto, e Ctrl-C lo chiude.
  cmd_ssh=(ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30)
  if [ -n "$SSH_CHIAVE" ]; then cmd_ssh+=(-i "$SSH_CHIAVE"); fi
  if [ -n "$SSH_PORTA" ]; then cmd_ssh+=(-p "$SSH_PORTA"); fi
  for o in ${SSH_OPZIONI[@]+"${SSH_OPZIONI[@]}"}; do cmd_ssh+=(-o "$o"); done
  cmd_ssh+=(-L "$PORTA_TUNNEL:127.0.0.1:6443" "$HOST_SSH")
  printf '  La porta 6443 del server non va aperta verso Internet: da questa macchina\n'
  printf "  l'API si raggiunge con un tunnel ssh. Aprilo in un altro terminale (Ctrl-C lo chiude):\n"
  printf '    %s\n' "$(cita "${cmd_ssh[@]}")"
  printf '  Con il tunnel aperto vale %s (mai unito a ~/.kube/config):\n' "$KUBECONFIG_TUNNEL"
  printf '    %s\n' "$(cita kubectl --kubeconfig "$KUBECONFIG_TUNNEL" -n "$NAMESPACE" get pods)"
  printf "  Controllo dell'installazione, ora e dopo ogni aggiornamento, con il tunnel aperto:\n"
else
  printf '    %s\n' "$(cita kubectl --kubeconfig "$KUBECONFIG_STATO" -n "$NAMESPACE" get pods)   (o sudo k3s kubectl -n $NAMESPACE get pods)"
  printf "  Controllo dell'installazione, ora e dopo ogni aggiornamento%s:\n" \
    "$( [ "${#KUBECTL[@]}" -gt 1 ] && printf ' (vuole kubectl nel PATH)')"
fi
printf '    %s\\\n      %s\n' "$(cita "$RADICE/scripts/verify-install.sh" "${argomenti_cluster[@]}")" "$(cita "${cmd_verifica[@]}")"
printf '\nAncora da fare\n'
i=1
voce() { printf '  %d. %s\n' "$i" "$1"; shift; for r in "$@"; do printf '     %s\n' "$r"; done; i=$((i + 1)); }
if [ "${#DNS_MANCANTI[@]}" -gt 0 ]; then
  voce "DNS: record A verso $IP_ANNUNCIATO per ${DNS_MANCANTI[*]}."
fi
if [ "$TLS" = "private-ca" ]; then
  voce "Rendi fidata nei browser l'autorità locale $CA_CRT" \
       "(impronta SHA-256 $(openssl x509 -in "$CA_CRT" -noout -fingerprint -sha256 | sed 's/^[^=]*=//'))." \
       "$( [ "${nuova_ca:-no}" = "si" ] && printf 'È appena stata creata: se ne avevi resa fidata una prima, sostituiscila.' || printf 'È la stessa dei lanci precedenti.')" \
       "Firefox: Impostazioni > Privacy e sicurezza > Certificati > Importa; Chrome su Linux:" \
       "certutil -d sql:\$HOME/.pki/nssdb -A -t 'C,,' -n 'PA Webinar $NOME' -i '$CA_CRT'." \
       "Per un evento pubblico servono certificati riconosciuti: --tls acme o --tls own."
fi
if [ "$TLS" = "own" ]; then
  voce "Prima che i certificati scadano, rilancia con i file nuovi (--cert/--key o --cert-dir):" \
       "Traefik li prende senza riavvii."
elif [ "$TLS" = "acme" ]; then
  voce "Traefik rinnova i certificati da sé: la porta 443 deve restare raggiungibile dal server ACME."
fi
if [ "$MAILPIT" = "si" ]; then
  voce "Le email restano nella casella di prova. Per leggerle$( [ "$LOCALE" = "no" ] && printf ', con il tunnel aperto'):" \
       "$(cita kubectl --kubeconfig "$KUBECONFIG_UTENTE" -n "$NAMESPACE" port-forward svc/mailpit 8025:8025)" \
       "e apri http://127.0.0.1:8025. Prima degli eventi veri: --smtp-file <relay>."
elif [ ! -s "$SMTP_STATO" ]; then
  voce "Nessun relay SMTP: iscrizioni, promemoria e accessi dello staff non partono. Rilancia con --smtp-file."
else
  voce "Controlla che il relay SMTP accetti il mittente $(leggi "$SMTP_STATO" SMTP_FROM) (SPF, DKIM, DMARC del dominio)."
fi
# La copia fuori dal server: scripts/backup.sh da questa macchina, cifrata,
# con la cartella di stato e, con Garage, i file caricati.
cmd_backup=("$RADICE/scripts/backup.sh" "${argomenti_cluster[@]}" --state-dir "$STATO")
if [ "$STORAGE" = "garage" ]; then cmd_backup+=(--include-storage); fi
if [ "$BACKUP" = "si" ]; then
  testo_backup="La copia notturna del database resta sul disco del server, accanto al database."
else
  testo_backup="Nessuna copia notturna del database sul server (--backup per averla)."
fi
voce "$testo_backup Una copia cifrata fuori dal server, da questa macchina$( [ "$LOCALE" = "no" ] && printf ' con il tunnel aperto'):" \
     "$(cita "${cmd_backup[@]}")--age-recipient <chiave pubblica age>" \
     "$( [ "$STORAGE" = "garage" ] && printf -- "--include-storage copia anche i file caricati (Garage), fermando lo storage per la durata della copia. ")Prova un ripristino (scripts/restore.sh --dry-run) prima del primo evento."
if [ "$TURN" = "no" ]; then
  voce "Senza TURN chi ha la porta UDP 10000 bloccata (reti di molti enti) entra senza audio né video:" \
       "prova da una rete così, e se serve rilancia con --turn."
else
  voce "Apri UDP 3478 verso il server per il TURN, e prova da una rete che blocca UDP."
fi
if [ "$IMMAGINI_ORA" = "archive" ] && { [ "$STORAGE" = "garage" ] || [ "$MAILPIT" = "si" ]; }; then
  voce "Server senza Internet: l'archivio contiene solo le immagini del chart. Aggiungici" \
       "$( [ "$MAILPIT" = "si" ] && printf '%s ' "$MAILPIT_IMMAGINE")$( [ "$STORAGE" = "garage" ] && printf 'quella di Garage (addons/storage.sh --print-images)')" \
       "con preload-images.sh save --list."
fi
voce "Firewall: TCP 80 e 443, UDP 10000 verso il server; 6443 mai da Internet."
voce "Prova una chiamata con due dispositivi su reti diverse: audio e video in entrambe le direzioni."
if [ "${#AVVISI[@]}" -gt 0 ]; then
  printf '\nAvvisi di questo lancio\n'
  for a in "${AVVISI[@]}"; do printf '  - %s\n' "$a"; done
fi
# Le righe di comando per i prossimi lanci: --state-dir va ripetuto, se dato.
ARG_STATO=""
if [ -n "$O_STATO" ]; then ARG_STATO=" --state-dir '$STATO'"; fi
cat <<FINE

Per aggiornare: git checkout del nuovo tag vX.Y.Z, poi
  $0 --portal $PORTALE$ARG_STATO
(le altre opzioni sono ricordate in $CONF). Per togliere tutto:
  $CARTELLA/pa-webinar-down.sh --portal $PORTALE$ARG_STATO
FINE
