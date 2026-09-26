#!/usr/bin/env bash
#
# Installa PA Webinar su minikube, su una sola macchina, per valutarlo: avvia
# un profilo dedicato con ingress e metrics-server, genera i segreti una volta
# sola, installa il chart con il profilo semplice e controlla che portale e
# conferenza rispondano. Rilanciato, aggiorna la stessa installazione
# (`helm upgrade`) con gli stessi segreti.
#
# Uso:  scripts/minikube-up.sh [opzioni]        (--help per l'elenco)
# Da:   qualunque cartella; il chart è quello del repository dello script.
#
# Cosa NON fa: non crea eventi, utenti o impostazioni nel portale, e non tocca
# altri cluster. Il contesto di kubectl attivo non cambia: `minikube start`
# parte con --keep-context, ogni comando indica il contesto del profilo in modo
# esplicito, e all'uscita, anche in caso di errore, si rimette comunque quello
# di prima.

set -euo pipefail

RADICE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART="$RADICE/infra/helm/pa-webinar"

# ── Valori predefiniti ──────────────────────────────────────────
# Le dimensioni sono quelle provate: 4 CPU e 6 GB reggono dieci partecipanti
# in video usando meno della metà del nodo; 2 CPU e 3 GB sono il minimo
# provato, al limite con venti partecipanti in video (vedi
# docs/INFRASTRUCTURE.md, "Evaluation: minikube").
PROFILO="pa-webinar"
NAMESPACE="pa-webinar"
RELEASE="pa-webinar"
DRIVER="docker"
CPUS="4"
MEMORIA="6g"
DISCO="30g"
KUBERNETES="v1.35.1"
IMMAGINI="auto"
TAG="dev"
TAG_MIGRAZIONE=""
FILE_SECRET_PULL=""
DOMINIO="nip.io"
MAILPIT="si"
ATTESA="15m"
STATO=""

# Versioni minime: minikube 1.38.1 è la versione provata, e la prima che ha
# Kubernetes v1.35.1 come predefinito (la 1.38.0 si ferma a v1.35.0); Helm
# 3.16.3 è la versione su cui la CI rende il chart. Sotto i 3 GB di memoria
# il nodo non regge: è il minimo provato.
MINIKUBE_MIN="1.38.1"
HELM_MIN="3.16.3"
MEMORIA_MIN_MB=3072
MAILPIT_IMMAGINE="docker.io/axllent/mailpit:v1.31.2"
SECRET_PULL="ghcr-pull"

uso() {
  cat <<'FINE'
Uso: scripts/minikube-up.sh [opzioni]

Profilo minikube
  --profile NOME            profilo e contesto kubectl (predefinito: pa-webinar)
  --driver NOME             driver di minikube (predefinito: docker)
  --cpus N                  CPU del nodo (predefinito: 4; minimo di minikube: 2)
  --memory DIM              memoria del nodo, es. 6g (predefinito: 6g). Sotto
                            3g lo script avvisa: con 2g il nodo lavora al
                            limite già a riposo e cede con 20 partecipanti
  --disk-size DIM           disco del nodo (predefinito: 30g)
  --kubernetes-version V    versione di Kubernetes (predefinito: v1.35.1)
  Le dimensioni valgono alla creazione del profilo: per cambiarle,
  scripts/minikube-down.sh e di nuovo questo script.

Installazione
  --namespace NOME          (predefinito: pa-webinar)
  --release NOME            nome della release Helm (predefinito: pa-webinar)
  --domain SUFFISSO         DNS che risolve <nome>.<ip>.SUFFISSO nell'IP
                            (predefinito: nip.io; alternativa: sslip.io)
  --no-mailpit              niente casella di prova per le email del portale
  --timeout DURATA          attesa massima di helm (predefinito: 15m)
  --state-dir DIR           dove tenere segreti e valori generati, fuori dal
                            repository (predefinito:
                            ~/.config/pa-webinar/minikube/<profilo>)

Immagini dell'applicazione
  (predefinito)             quelle pubblicate su ghcr.io se il nodo può
                            prelevarle (con credenziali, o senza se i
                            pacchetti sono pubblici); altrimenti le costruisce
                            dai sorgenti, come --images local
  --images registry         il nodo le preleva da ghcr.io; senza accesso si
                            ferma subito
  --images host             le preleva il docker di questa macchina (con il
                            suo `docker login ghcr.io`) e le carica nel nodo
  --images local            le costruisce dai sorgenti di questo repository,
                            modifiche non salvate comprese, e le carica nel
                            nodo (serve docker; la prima volta alcuni minuti)
  --tag TAG                 tag pubblicato (predefinito: dev). Il tag delle
                            migrazioni si ricava: dev -> dev-migrate,
                            dev-<sha> -> dev-migrate-<sha>, X.Y.Z -> vX.Y.Z-migrate
  --migrate-tag TAG         tag delle migrazioni, se non si ricava dal primo
  --pull-secret-file FILE   file .dockerconfigjson con le credenziali del
                            registro (campo `auth` per ghcr.io), da cui
                            creare il Secret di prelievo
  Credenziali anche da ambiente: GHCR_USERNAME e GHCR_TOKEN (token con
  permesso read:packages), senza lasciare il token nella cronologia:
    export GHCR_USERNAME=<utente>; read -rs GHCR_TOKEN; export GHCR_TOKEN
  Lo script prova le credenziali su ghcr.io prima di usarle. Con un Secret di
  prelievo anche l'immagine web della conferenza torna quella patchata del
  chart. Il Secret resta nel namespace: ai lanci successivi le credenziali
  non servono più.

  -h, --help                questo aiuto
FINE
}

errore() {
  printf '\n✗ %s\n' "$*" >&2
  exit 1
}

passo() {
  printf '\n── %s\n' "$*"
}

nota() {
  printf '   %s\n' "$*"
}

# ── Argomenti ───────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILO="${2:?}"; shift 2 ;;
    --driver) DRIVER="${2:?}"; shift 2 ;;
    --cpus) CPUS="${2:?}"; shift 2 ;;
    --memory) MEMORIA="${2:?}"; shift 2 ;;
    --disk-size) DISCO="${2:?}"; shift 2 ;;
    --kubernetes-version) KUBERNETES="${2:?}"; shift 2 ;;
    --namespace) NAMESPACE="${2:?}"; shift 2 ;;
    --release) RELEASE="${2:?}"; shift 2 ;;
    --domain) DOMINIO="${2:?}"; shift 2 ;;
    --no-mailpit) MAILPIT="no"; shift ;;
    --timeout) ATTESA="${2:?}"; shift 2 ;;
    --state-dir) STATO="${2:?}"; shift 2 ;;
    --images) IMMAGINI="${2:?}"; shift 2 ;;
    --tag) TAG="${2:?}"; shift 2 ;;
    --migrate-tag) TAG_MIGRAZIONE="${2:?}"; shift 2 ;;
    --pull-secret-file) FILE_SECRET_PULL="${2:?}"; shift 2 ;;
    -h|--help) uso; exit 0 ;;
    *) uso >&2; errore "Opzione sconosciuta: $1" ;;
  esac
done

case "$IMMAGINI" in
  auto|registry|host|local) ;;
  *) errore "--images accetta registry, host o local (non '$IMMAGINI')." ;;
esac
case "$CPUS" in
  ''|*[!0-9]*) errore "--cpus vuole un numero intero (non '$CPUS')." ;;
esac
[ "$CPUS" -ge 2 ] || errore "--cpus: minikube ne vuole almeno 2."

if [ -z "$TAG_MIGRAZIONE" ]; then
  case "$TAG" in
    dev) TAG_MIGRAZIONE="dev-migrate" ;;
    dev-*) TAG_MIGRAZIONE="dev-migrate-${TAG#dev-}" ;;
    [0-9]*.[0-9]*.[0-9]*) TAG_MIGRAZIONE="v${TAG}-migrate" ;;
    *) errore "Non so ricavare il tag delle migrazioni da '$TAG': passalo con --migrate-tag." ;;
  esac
fi

# Percorso assoluto e senza collegamenti simbolici, anche se non esiste
# ancora: si risolve il primo antenato esistente e si riattacca il resto. Così
# il controllo qui sotto avviene prima di creare qualunque cartella. Un `..`
# nella parte che non esiste non si può risolvere senza crearla: rifiutato.
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

STATO="$(risolvi_percorso "${STATO:-${XDG_CONFIG_HOME:-$HOME/.config}/pa-webinar/minikube/$PROFILO}")" \
  || errore "--state-dir: togli i '..' dal percorso, o crea prima la cartella."
RADICE_FISICA="$(cd "$RADICE" && pwd -P)"
case "$STATO/" in
  "$RADICE_FISICA"/*)
    errore "--state-dir è dentro il repository: i segreti non devono finirci. Scegli una cartella fuori da $RADICE." ;;
esac
# Le cartelle create qui nascono 0700; una cartella che esiste già si lascia
# com'è (il file dei segreti è comunque 0600).
(umask 077 && mkdir -p "$STATO")
SEGRETI="$STATO/secrets.yaml"
LOCALI="$STATO/values-local.yaml"

# ── Contesto kubectl: rete di sicurezza all'uscita ─────────────
# `minikube start --keep-context` non tocca il contesto attivo. Se qualche
# versione di minikube lo rendesse comunque quello del profilo, all'uscita,
# anche a metà, si rimette quello di prima; un cambio fatto da chi lancia,
# verso un altro contesto, non si tocca.
CONTESTO_PRECEDENTE="$(kubectl config current-context 2>/dev/null || true)"
tmp_cfg=""
ripristina_contesto() {
  local ora
  # Le credenziali del registro scritte per creare il Secret non restano su
  # disco nemmeno se lo script si ferma a metà.
  if [ -n "$tmp_cfg" ]; then rm -f "$tmp_cfg"; fi
  ora="$(kubectl config current-context 2>/dev/null || true)"
  [ "$ora" = "$CONTESTO_PRECEDENTE" ] && return 0
  [ "$ora" = "$PROFILO" ] || return 0
  if [ -n "$CONTESTO_PRECEDENTE" ]; then
    kubectl config use-context "$CONTESTO_PRECEDENTE" >/dev/null 2>&1 || true
  else
    kubectl config unset current-context >/dev/null 2>&1 || true
  fi
}
trap ripristina_contesto EXIT

kc() { kubectl --context "$PROFILO" "$@"; }
mk() { minikube -p "$PROFILO" "$@"; }

# Confronto di versioni "X.Y.Z" con sort -V: vero se $1 >= $2.
almeno() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

# ── Prerequisiti ────────────────────────────────────────────────
passo "Prerequisiti"
for comando in minikube kubectl helm openssl curl; do
  command -v "$comando" >/dev/null 2>&1 || errore "Manca '$comando' nel PATH."
done
docker_pronto() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}
# Con le immagini scelte da sé (auto) docker serve solo se si finisce a
# costruirle: lì lo si controlla al momento della scelta.
if [ "$DRIVER" = "docker" ] || [ "$IMMAGINI" = "host" ] || [ "$IMMAGINI" = "local" ]; then
  command -v docker >/dev/null 2>&1 || errore "Manca 'docker' (serve al driver docker e alle modalità host e local)."
  docker info >/dev/null 2>&1 || errore "Il demone docker non risponde (docker info): avvialo, o controlla i permessi dell'utente."
fi

v_minikube="$(minikube version --short 2>/dev/null | sed 's/^v//')"
almeno "$v_minikube" "$MINIKUBE_MIN" || errore "minikube $v_minikube: serve almeno $MINIKUBE_MIN."
v_helm="$(helm version --template '{{.Version}}' 2>/dev/null | sed 's/^v//; s/+.*//')"
almeno "$v_helm" "$HELM_MIN" || errore "Helm $v_helm: serve almeno $HELM_MIN."
v_kubectl="$(kubectl version --client -o json 2>/dev/null | sed -n 's/.*"gitVersion": *"v\([^"]*\)".*/\1/p' | head -n1)"
nota "minikube $v_minikube · helm $v_helm · kubectl ${v_kubectl:-?} · Kubernetes $KUBERNETES · driver $DRIVER"
# kubectl è supportato fino a una versione minore di distanza dal cluster.
# Oltre di solito funziona ancora, ma gli errori che ne nascono non dicono
# da dove vengono.
minore_kubectl="$(printf '%s' "$v_kubectl" | cut -d. -f2)"
minore_cluster="$(printf '%s' "${KUBERNETES#v}" | cut -d. -f2)"
case "$minore_kubectl$minore_cluster" in
  *[!0-9]*|'') ;;
  *)
    distanza=$(( minore_kubectl - minore_cluster ))
    if [ "$distanza" -gt 1 ] || [ "$distanza" -lt -1 ]; then
      nota "ATTENZIONE: kubectl $v_kubectl e Kubernetes $KUBERNETES distano più di una versione"
      nota "minore. Se un comando si comporta in modo strano, usa quello del profilo:"
      nota "  minikube -p $PROFILO kubectl -- <argomenti>"
    fi ;;
esac

if [ "$(uname -s)" = "Darwin" ] && [ "$DRIVER" = "docker" ]; then
  nota "ATTENZIONE: su macOS il driver docker non rende raggiungibile l'IP del nodo:"
  nota "il portale si apre con 'minikube tunnel', ma l'audio e il video della"
  nota "conferenza (UDP 10000 sull'IP del nodo) non arrivano. Usa un driver a"
  nota "macchina virtuale (--driver vfkit o qemu). Percorso non provato."
fi

cpu_macchina="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 0)"
if [ "$cpu_macchina" -gt 0 ] && [ "$CPUS" -gt "$cpu_macchina" ]; then
  errore "Chiedi $CPUS CPU ma la macchina ne ha $cpu_macchina."
fi
richiesta_mb="$(printf '%s' "$MEMORIA" | awk '
  /^[0-9]+[gG][bB]?$/ { print int($0) * 1024; exit }
  /^[0-9]+[mM][bB]?$/ { print int($0); exit }
  /^[0-9]+$/          { print int($0); exit }
  { print 0 }')"
# Le dimensioni contano solo alla creazione del profilo: su uno esistente non
# si avvisa di niente.
stato_profilo="$(minikube -p "$PROFILO" status --format '{{.Host}}' 2>/dev/null || true)"
memoria_scarsa="no"
case "$stato_profilo" in
  Running|Stopped) ;;
  *)
    if [ "$richiesta_mb" -gt 0 ] && [ "$richiesta_mb" -lt "$MEMORIA_MIN_MB" ]; then
      memoria_scarsa="si"
      nota "ATTENZIONE: --memory $MEMORIA è sotto i 3 GB, il minimo provato. Con 2 GB"
      nota "l'installazione riesce, ma il nodo lavora al limite già a riposo, e con 20"
      nota "partecipanti in video la conferenza si è fermata e API server, database e"
      nota "portale sono ripartiti. Va bene solo per aprire le pagine del portale."
    fi
    if [ -r /proc/meminfo ]; then
      disponibile_mb=$(( $(awk '/^MemAvailable:/ {print $2}' /proc/meminfo) / 1024 ))
      if [ "$richiesta_mb" -gt 0 ] && [ "$disponibile_mb" -lt $(( richiesta_mb + 2048 )) ]; then
        nota "ATTENZIONE: memoria disponibile ${disponibile_mb} MB, il nodo ne chiede ${richiesta_mb}:"
        nota "restano meno di 2 GB alla macchina, e ai browser che si collegano."
      fi
    fi ;;
esac

[ -d "$CHART" ] || errore "Chart non trovato in $CHART."

# ── Segreti: generati una volta, poi riusati ────────────────────
passo "Segreti"
umask 077
esiste_release() {
  helm --kube-context "$PROFILO" status "$RELEASE" -n "$NAMESPACE" >/dev/null 2>&1
}
profilo_attivo() {
  [ "$(mk status --format '{{.Host}}' 2>/dev/null || true)" = "Running" ]
}
if [ ! -s "$SEGRETI" ]; then
  # Un'installazione esistente senza il suo file di segreti ha il database
  # inizializzato con una password che non conosciamo più: generarne una nuova
  # lo renderebbe inaccessibile.
  if profilo_attivo && esiste_release; then
    errore "La release $RELEASE esiste già nel profilo $PROFILO ma manca $SEGRETI.
  Rimetti il file al suo posto, oppure riparti da zero con
  scripts/minikube-down.sh --profile $PROFILO e di nuovo questo script."
  fi
  # Su un profilo fermo non si può chiedere a helm: il database, se c'è, è
  # sul disco del nodo con le password di prima.
  if [ "$(mk status --format '{{.Host}}' 2>/dev/null || true)" = "Stopped" ]; then
    errore "Il profilo $PROFILO esiste ma è fermo, e manca $SEGRETI.
  Rimetti il file al suo posto, oppure riparti da zero con
  scripts/minikube-down.sh --profile $PROFILO e di nuovo questo script."
  fi
  hex() { openssl rand -hex "$1"; }
  {
    printf '# Generato da scripts/minikube-up.sh il %s.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '# Conservalo finché esiste il profilo %s: il database è inizializzato con\n' "$PROFILO"
    printf '# queste password, e ogni aggiornamento deve ripassarle identiche.\n'
    printf 'secrets:\n  generate:\n'
    printf '    APP_SECRET: "%s"\n' "$(hex 32)"
    printf '    JITSI_JWT_SECRET: "%s"\n' "$(hex 32)"
    printf '    PII_ENCRYPTION_KEY: "%s"\n' "$(hex 32)"
    printf '    CRON_API_KEY: "%s"\n' "$(hex 32)"
    printf '    ADMIN_API_KEY: "%s"\n' "$(hex 32)"
    printf '    POSTGRES_PASSWORD: "%s"\n' "$(hex 24)"
    printf '    POSTGRES_ADMIN_PASSWORD: "%s"\n' "$(hex 24)"
    printf '    REDIS_PASSWORD: "%s"\n' "$(hex 24)"
    printf 'jitsi-meet:\n'
    printf '  jicofo:\n    xmpp:\n      password: "%s"\n' "$(hex 16)"
    printf '  jvb:\n    xmpp:\n      password: "%s"\n' "$(hex 16)"
  } > "$SEGRETI.tmp"
  mv "$SEGRETI.tmp" "$SEGRETI"
  nota "generati in $SEGRETI"
else
  for chiave in APP_SECRET JITSI_JWT_SECRET PII_ENCRYPTION_KEY CRON_API_KEY ADMIN_API_KEY \
                POSTGRES_PASSWORD POSTGRES_ADMIN_PASSWORD REDIS_PASSWORD; do
    grep -Eq "^    $chiave: \"[0-9a-f]+\"" "$SEGRETI" || errore "In $SEGRETI manca $chiave: completalo a mano (non rigenerare le password del database)."
  done
  [ "$(grep -Ec '^      password: "[0-9a-f]+"' "$SEGRETI")" -ge 2 ] || errore "In $SEGRETI mancano le password XMPP di jicofo e jvb."
  nota "riusati da $SEGRETI"
fi
chmod 600 "$SEGRETI"

# ── Profilo minikube ────────────────────────────────────────────
passo "Profilo minikube '$PROFILO'"
nuovo_profilo="no"
if profilo_attivo; then
  nota "già avviato: --cpus, --memory e --disk-size valgono solo alla creazione."
else
  case "$(mk status --format '{{.Host}}' 2>/dev/null || true)" in
    Stopped) nota "profilo esistente e fermo: lo riavvio con le dimensioni con cui è stato creato." ;;
    *) nuovo_profilo="si" ;;
  esac
  # --keep-context: il contesto attivo di chi lancia non cambia nemmeno per
  # la durata dello script (un kubectl senza --context in un'altra shell
  # continua a puntare dove puntava).
  mk start \
    --keep-context \
    --driver="$DRIVER" \
    --container-runtime=docker \
    --cpus="$CPUS" \
    --memory="$MEMORIA" \
    --disk-size="$DISCO" \
    --kubernetes-version="$KUBERNETES"
fi

# Con il driver docker, su alcuni host cgroup v2, minikube avvisa "Your kernel
# does not support CPU cfs period/quota" e ignora --cpus: il nodo userebbe
# tutte le CPU della macchina. Il limite si mette sul container del nodo, e
# resta anche dopo uno stop. Su un profilo creato prima non si sa con quante
# CPU fosse pensato: lì si avvisa soltanto.
if [ "$DRIVER" = "docker" ]; then
  cpu_max="$(docker exec "$PROFILO" cat /sys/fs/cgroup/cpu.max 2>/dev/null || true)"
  if [ "${cpu_max%% *}" = "max" ]; then
    if [ "$nuovo_profilo" = "si" ]; then
      docker update --cpus="$CPUS" "$PROFILO" >/dev/null
      nota "limite di $CPUS CPU applicato al container del nodo (minikube non l'aveva messo)"
    else
      nota "ATTENZIONE: il nodo non ha un limite di CPU e usa tutte quelle della macchina."
      nota "Per metterlo: docker update --cpus=<N> $PROFILO"
    fi
  fi
fi

mk addons enable ingress >/dev/null
mk addons enable metrics-server >/dev/null
# Il controller di ingress ha un webhook di ammissione: finché non è pronto
# ogni Ingress del chart viene rifiutato.
kc -n ingress-nginx rollout status deployment/ingress-nginx-controller --timeout=300s >/dev/null
IP="$(mk ip)"
APP_HOST="app.$IP.$DOMINIO"
JITSI_HOST="jitsi.$IP.$DOMINIO"
MAIL_HOST="mail.$IP.$DOMINIO"
nota "nodo $IP, ingress pronto"

if command -v getent >/dev/null 2>&1 && ! getent hosts "$APP_HOST" >/dev/null 2>&1; then
  nota "ATTENZIONE: $APP_HOST non si risolve da questa macchina (alcuni DNS"
  nota "bloccano i nomi che puntano a indirizzi privati). Prova --domain sslip.io,"
  nota "oppure aggiungi a /etc/hosts: $IP $APP_HOST $JITSI_HOST $MAIL_HOST"
fi

# ── Immagini ────────────────────────────────────────────────────
passo "Immagini"
kc get namespace "$NAMESPACE" >/dev/null 2>&1 || kc create namespace "$NAMESPACE" >/dev/null
extra=()
REPO_IMMAGINE="ghcr.io/italia/pa-webinar"

# Immagine web patchata del chart (jitsi-meet.web.image in values.yaml): la si
# rimette solo se il nodo può prelevarla.
web_patchata() {
  awk '
    /^jitsi-meet:/ { jm = 1; next }
    jm && /^[^ #]/ { jm = 0 }
    jm && /^  web:/ { web = 1; next }
    web && /^  [^ #]/ { web = 0 }
    web && /^    image:/ { img = 1; next }
    img && /^    [^ #]/ { img = 0 }
    img && /^      repository:/ { r = $2 }
    img && /^      tag:/ { t = $2 }
    END { if (r != "" && t != "") print r " " t }
  ' "$CHART/values.yaml"
}
read -r web_repo web_tag <<<"$(web_patchata)" || true

# Il campo `auth` (base64 di "utente:token") della voce ghcr.io di un
# .dockerconfigjson letto da stdin, compatto o su più righe. Vuoto se manca:
# ad esempio in un ~/.docker/config.json con `credsStore`, dove le credenziali
# stanno nel portachiavi del sistema e non nel file.
auth_ghcr() {
  tr -d '\n\r' | sed -n 's/.*"\(https:\/\/\)\{0,1\}ghcr\.io\/\{0,1\}"[[:space:]]*:[[:space:]]*{[^}]*"auth"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\2/p'
}

# Chiede a ghcr.io i manifesti delle immagini indicate (repository:tag), con
# le credenziali in $1 (auth base64; vuoto = senza credenziali). Esce con 0 se
# il nodo potrà prelevarle tutte, 1 se il registro rifiuta (credenziali
# sbagliate o scadute, token senza read:packages, tag inesistente), 2 se
# ghcr.io non risponde. Credenziali e token passano a curl da stdin: sulla riga
# di comando chiunque sulla macchina li leggerebbe con ps.
prova_prelievo() {
  local auth="$1" ref repo tag risposta token codice
  shift
  for ref in "$@"; do
    repo="${ref%%:*}"
    tag="${ref#*:}"
    if [ -n "$auth" ]; then
      risposta="$(printf 'Authorization: Basic %s\n' "$auth" \
        | curl -sS --max-time 20 -H @- "https://ghcr.io/token?scope=repository:$repo:pull" 2>/dev/null)" || return 2
    else
      risposta="$(curl -sS --max-time 20 "https://ghcr.io/token?scope=repository:$repo:pull" 2>/dev/null)" || return 2
    fi
    token="$(printf '%s' "$risposta" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
    [ -n "$token" ] || return 1
    codice="$(printf 'Authorization: Bearer %s\n' "$token" \
      | curl -sS --max-time 20 --head -o /dev/null -w '%{http_code}' -H @- \
          -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json' \
          "https://ghcr.io/v2/$repo/manifests/$tag" 2>/dev/null)" || return 2
    [ "$codice" = "200" ] || return 1
  done
}

# Le immagini che il nodo preleverà con il Secret: quelle dell'applicazione
# se la modalità è registry (o se si sceglierà da sé), e la web patchata.
riferimenti_da_provare() {
  if [ "$IMMAGINI" = "registry" ] || [ "$IMMAGINI" = "auto" ]; then
    printf '%s\n' "italia/pa-webinar:$TAG" "italia/pa-webinar:$TAG_MIGRAZIONE"
  fi
  case "${web_repo:-}" in
    ghcr.io/*) [ -n "${web_tag:-}" ] && printf '%s\n' "${web_repo#ghcr.io/}:$web_tag" ;;
  esac
  return 0
}

ALTERNATIVE="  Le strade:
    - credenziali per ghcr.io (token con read:packages), senza lasciarle nella cronologia:
        export GHCR_USERNAME=<utente>; read -rs GHCR_TOKEN; export GHCR_TOKEN
      poi di nuovo $0
    - --pull-secret-file <file .dockerconfigjson con il campo auth per ghcr.io>
    - --images host    preleva con il docker di questa macchina (dopo docker login ghcr.io)
    - --images local   costruisce le immagini dai sorgenti di questo repository"

# Un Secret di prelievo, se ci sono credenziali: nuove (file o ambiente) o
# quelle di un Secret creato a un lancio precedente. Prima di usarle si
# provano: un Secret che non vale si scoprirebbe solo dopo il quarto d'ora di
# attesa di helm, tra pod fermi in ImagePullBackOff.
secret_pull="no"
auth=""
origine=""
if [ -n "$FILE_SECRET_PULL" ]; then
  [ -r "$FILE_SECRET_PULL" ] || errore "Non leggo $FILE_SECRET_PULL."
  auth="$(auth_ghcr < "$FILE_SECRET_PULL")"
  [ -n "$auth" ] || errore "$FILE_SECRET_PULL non ha il campo \"auth\" per ghcr.io.
  Un ~/.docker/config.json con \"credsStore\" o \"credHelpers\" tiene le credenziali nel
  portachiavi del sistema, non nel file: usa GHCR_USERNAME e GHCR_TOKEN.
$ALTERNATIVE"
  origine="file"
elif [ -n "${GHCR_USERNAME:-}" ] && [ -n "${GHCR_TOKEN:-}" ]; then
  auth="$(printf '%s:%s' "$GHCR_USERNAME" "$GHCR_TOKEN" | base64 | tr -d '\n')"
  origine="ambiente"
elif kc -n "$NAMESPACE" get secret "$SECRET_PULL" >/dev/null 2>&1; then
  auth="$(kc -n "$NAMESPACE" get secret "$SECRET_PULL" -o jsonpath='{.data.\.dockerconfigjson}' \
    | base64 --decode 2>/dev/null | auth_ghcr || true)"
  origine="secret"
  [ -n "$auth" ] || errore "Il Secret di prelievo '$SECRET_PULL' nel namespace $NAMESPACE non ha credenziali per ghcr.io.
  Cancellalo (kubectl --context $PROFILO -n $NAMESPACE delete secret $SECRET_PULL) e rilancia,
  con credenziali nuove o senza."
fi

if [ -n "$auth" ]; then
  esito=0
  riferimenti=()
  while IFS= read -r r; do riferimenti+=("$r"); done < <(riferimenti_da_provare)
  if [ "${#riferimenti[@]}" -gt 0 ]; then
    prova_prelievo "$auth" "${riferimenti[@]}" || esito=$?
  fi
  case "$esito" in
    0) nota "credenziali per ghcr.io provate: il nodo può prelevare le immagini" ;;
    2) nota "ATTENZIONE: ghcr.io non risponde, le credenziali non si possono provare: le uso così." ;;
    *)
      if [ "$origine" = "secret" ]; then
        errore "ghcr.io rifiuta le credenziali del Secret '$SECRET_PULL' già nel namespace (token scaduto o revocato?).
  Cancellalo (kubectl --context $PROFILO -n $NAMESPACE delete secret $SECRET_PULL) e rilancia,
  con credenziali nuove o senza."
      fi
      errore "ghcr.io rifiuta le credenziali ($origine) per ${riferimenti[*]}:
  credenziali sbagliate o scadute, token senza read:packages, o tag inesistente.
$ALTERNATIVE" ;;
  esac
  if [ "$origine" = "secret" ]; then
    nota "riuso il Secret di prelievo '$SECRET_PULL' già nel namespace"
  else
    fonte="$FILE_SECRET_PULL"
    if [ "$origine" = "ambiente" ]; then
      # Il file temporaneo sta nella cartella di stato (0700) e si cancella
      # subito dopo, o all'uscita se lo script si ferma prima.
      tmp_cfg="$(mktemp "$STATO/dockerconfig.XXXXXX")"
      printf '{"auths":{"ghcr.io":{"auth":"%s"}}}' "$auth" > "$tmp_cfg"
      fonte="$tmp_cfg"
    fi
    kc -n "$NAMESPACE" create secret generic "$SECRET_PULL" \
      --type=kubernetes.io/dockerconfigjson \
      --from-file=.dockerconfigjson="$fonte" \
      --dry-run=client -o yaml | kc apply -f - >/dev/null
    if [ -n "$tmp_cfg" ]; then rm -f "$tmp_cfg"; tmp_cfg=""; fi
    nota "Secret di prelievo '$SECRET_PULL' nel namespace $NAMESPACE (resta per i prossimi lanci)"
  fi
  secret_pull="si"
fi
auth=""

# Scelta da sé: le immagini pubblicate se il nodo può prelevarle, altrimenti
# costruite dai sorgenti.
if [ "$IMMAGINI" = "auto" ]; then
  if [ "$secret_pull" = "si" ]; then
    IMMAGINI="registry"
  else
    esito=0
    prova_prelievo "" "italia/pa-webinar:$TAG" "italia/pa-webinar:$TAG_MIGRAZIONE" || esito=$?
    if [ "$esito" = "0" ]; then
      IMMAGINI="registry"
      nota "ghcr.io concede il prelievo senza credenziali: uso $REPO_IMMAGINE:$TAG"
    else
      docker_pronto || errore "ghcr.io non concede il prelievo di $REPO_IMMAGINE senza credenziali, e per
  costruire le immagini dai sorgenti serve docker, che qui manca o non risponde.
$ALTERNATIVE"
      IMMAGINI="local"
      nota "ghcr.io non concede il prelievo di $REPO_IMMAGINE senza credenziali:"
      nota "costruisco le immagini dai sorgenti di questo repository (--images local)."
      nota "Per usare quelle pubblicate: GHCR_USERNAME e GHCR_TOKEN, --pull-secret-file"
      nota "o --images host (vedi --help)."
    fi
  fi
fi
nota "modalità: $IMMAGINI"

carica_nel_nodo() {
  # Carica solo se il nodo non ha già la stessa immagine (stesso ID): la
  # seconda volta si risparmia il minuto e mezzo dell'immagine da 2,4 GB.
  local img="$1" id_host id_nodo
  id_host="$(docker image inspect --format '{{.Id}}' "$img")"
  id_nodo="$(mk ssh -- docker image inspect --format '{{.Id}}' "$img" 2>/dev/null | tr -d '\r' || true)"
  if [ "$id_host" = "$id_nodo" ]; then
    nota "$img già nel nodo"
  else
    nota "carico $img nel nodo…"
    # Dall'archivio in ingresso, non per nome: per nome minikube riusa la
    # copia che tiene in cache (~/.minikube/cache/images) e, con lo stesso
    # tag, lascia nel nodo l'immagine del lancio precedente.
    docker save "$img" | mk image load - \
      || errore "caricamento di $img nel nodo non riuscito."
    id_nodo="$(mk ssh -- docker image inspect --format '{{.Id}}' "$img" 2>/dev/null | tr -d '\r' || true)"
    [ "$id_host" = "$id_nodo" ] \
      || errore "dopo il caricamento il nodo ha ancora un'altra versione di $img ($id_nodo invece di $id_host)."
  fi
}

case "$IMMAGINI" in
  registry)
    # Senza Secret il registro deve concedere il prelievo anonimo. Lo si
    # scopre qui, non dopo un quarto d'ora di ImagePullBackOff.
    if [ "$secret_pull" = "no" ]; then
      esito=0
      prova_prelievo "" "italia/pa-webinar:$TAG" "italia/pa-webinar:$TAG_MIGRAZIONE" || esito=$?
      case "$esito" in
        0) nota "ghcr.io concede il prelievo senza credenziali" ;;
        2) errore "ghcr.io non risponde: il nodo non potrebbe prelevare le immagini." ;;
        *) errore "ghcr.io non concede il prelievo di $REPO_IMMAGINE:$TAG senza credenziali.
$ALTERNATIVE" ;;
      esac
    fi
    extra+=(--set-string "app.image.tag=$TAG" --set-string "app.migration.image.tag=$TAG_MIGRAZIONE")
    ;;
  host)
    for img in "$REPO_IMMAGINE:$TAG" "$REPO_IMMAGINE:$TAG_MIGRAZIONE"; do
      docker pull -q "$img" >/dev/null || errore "docker pull $img non riuscito: serve 'docker login ghcr.io' con un token read:packages."
      carica_nel_nodo "$img"
    done
    id_app="$(docker image inspect --format '{{.Id}}' "$REPO_IMMAGINE:$TAG")"
    id_mig="$(docker image inspect --format '{{.Id}}' "$REPO_IMMAGINE:$TAG_MIGRAZIONE")"
    extra+=(
      --set-string "app.image.tag=$TAG" --set-string "app.migration.image.tag=$TAG_MIGRAZIONE"
      --set "app.image.pullPolicy=IfNotPresent" --set "app.migration.image.pullPolicy=IfNotPresent"
    )
    ;;
  local)
    nota "docker build dai sorgenti, modifiche non salvate comprese (la prima volta alcuni minuti)…"
    docker build -q -t pa-webinar:local "$RADICE" >/dev/null \
      || errore "docker build dell'applicazione non riuscito (l'errore è qui sopra)."
    # Le migrazioni girano dallo stadio `builder`, come nell'immagine pubblicata.
    docker build -q --target builder -t pa-webinar:local-migrate "$RADICE" >/dev/null \
      || errore "docker build dell'immagine delle migrazioni non riuscito (l'errore è qui sopra)."
    for img in pa-webinar:local pa-webinar:local-migrate; do
      carica_nel_nodo "$img"
    done
    id_app="$(docker image inspect --format '{{.Id}}' pa-webinar:local)"
    id_mig="$(docker image inspect --format '{{.Id}}' pa-webinar:local-migrate)"
    extra+=(
      --set "app.image.repository=pa-webinar" --set-string "app.image.tag=local" --set "app.image.pullPolicy=Never"
      --set "app.migration.image.repository=pa-webinar" --set-string "app.migration.image.tag=local-migrate"
      --set "app.migration.image.pullPolicy=Never"
    )
    ;;
esac

# Un tag caricato nel nodo non cambia nome quando cambia contenuto: l'impronta
# delle due immagini nell'annotazione del pod fa ripartire l'applicazione solo
# quando è cambiata davvero.
if [ "$IMMAGINI" != "registry" ]; then
  impronta="$(printf '%s %s' "$id_app" "$id_mig" | openssl dgst -sha256 | awk '{print substr($NF, 1, 16)}')"
  extra+=(--set-string "app.podAnnotations.pa-webinar/images=$impronta")
fi

if [ "$secret_pull" = "si" ]; then
  extra+=(--set "app.imagePullSecrets[0].name=$SECRET_PULL" --set "jitsi-meet.imagePullSecrets[0].name=$SECRET_PULL")
  if [ -n "${web_repo:-}" ] && [ -n "${web_tag:-}" ]; then
    extra+=(--set "jitsi-meet.web.image.repository=$web_repo" --set-string "jitsi-meet.web.image.tag=$web_tag"
            --set "jitsi-meet.web.image.pullPolicy=Always")
    nota "conferenza con l'immagine web patchata $web_repo:$web_tag"
  fi
fi

# ── Certificati: un'autorità locale, creata una volta ───────────
# Un'autorità di certificazione tutta di questa installazione, nella cartella
# di stato (chiave 0600, mai nel repository), firma i certificati del portale,
# della conferenza e della casella di prova. Chi la aggiunge una volta alle
# autorità fidate del browser apre i tre indirizzi senza avvisi; la conferenza,
# che gira in un riquadro dentro il portale, non si blocca più su un
# certificato mai accettato. Il portale la riceve in un ConfigMap
# (app.extraCaCerts), per le connessioni che fa verso i propri nomi pubblici.
#
# L'autorità può firmare solo nomi sotto i domini indicati alla creazione
# (nameConstraints): chi ne ottenesse la chiave non potrebbe spacciarsi per
# nessun altro sito. Si rigenera solo se manca, scade o non copre il dominio
# scelto; i certificati dei nomi si rifanno quando cambia l'IP del nodo o si
# avvicina la scadenza. Rilanciare lo script non cambia l'autorità.
passo "Certificati"
CA_KEY="$STATO/ca.key"
CA_CRT="$STATO/ca.crt"
TLS_DIR="$STATO/tls"
SECRET_CA="local-ca"
(umask 077 && mkdir -p "$TLS_DIR")

# Vero se il file PEM di un certificato scade fra più di $2 giorni.
valido_per() {
  openssl x509 -in "$1" -noout -checkend $(( $2 * 86400 )) >/dev/null 2>&1
}
# Vero se chiave privata ($1) e certificato ($2) sono una coppia.
coppia() {
  [ "$(openssl pkey -in "$1" -pubout 2>/dev/null)" = "$(openssl x509 -in "$2" -pubkey -noout 2>/dev/null)" ] \
    && [ -n "$(openssl x509 -in "$2" -pubkey -noout 2>/dev/null)" ]
}
# Vero se l'autorità può firmare nomi sotto il dominio $1.
ca_copre() {
  openssl x509 -in "$CA_CRT" -noout -text 2>/dev/null | sed 's/^ *//' | grep -qxF "DNS:$1"
}

nuova_ca="no"
if [ -s "$CA_KEY" ] && [ -s "$CA_CRT" ] && coppia "$CA_KEY" "$CA_CRT" && valido_per "$CA_CRT" 30; then
  if ! ca_copre "$DOMINIO"; then
    errore "L'autorità locale in $CA_CRT non copre il dominio '$DOMINIO' (creata per un altro --domain).
  Per crearne una nuova: rm '$CA_KEY' '$CA_CRT' e rilancia; poi togli la vecchia dalle
  autorità fidate del browser e aggiungi la nuova (le istruzioni arrivano alla fine)."
  fi
  nota "autorità locale riusata: $CA_CRT"
else
  domini="nip.io sslip.io"
  case " $domini " in *" $DOMINIO "*) ;; *) domini="$domini $DOMINIO" ;; esac
  permessi=""
  for d in $domini; do permessi="${permessi:+$permessi,}permitted;DNS:$d"; done
  cfg="$(mktemp "$STATO/ca.cnf.XXXXXX")"
  cat > "$cfg" <<FINE
[req]
distinguished_name = dn
prompt = no
[dn]
CN = PA Webinar minikube CA ($PROFILO, $(date -u +%Y-%m-%d))
[v3_ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
nameConstraints = critical, $permessi
FINE
  openssl ecparam -name prime256v1 -genkey -noout -out "$CA_KEY" 2>/dev/null
  chmod 600 "$CA_KEY"
  openssl req -new -x509 -key "$CA_KEY" -config "$cfg" -extensions v3_ca -sha256 \
    -days 3650 -set_serial "0x$(openssl rand -hex 16)" -out "$CA_CRT" \
    || { rm -f "$cfg"; errore "openssl non ha creato l'autorità locale."; }
  rm -f "$cfg"
  # Certificati firmati da un'autorità precedente: si rifanno tutti.
  rm -f "$TLS_DIR"/*.crt "$TLS_DIR"/*.key
  nuova_ca="si"
  nota "autorità locale creata: $CA_CRT (valida 10 anni, solo per nomi sotto: $domini)"
fi

# Il certificato di un nome, rifatto solo quando serve.
certificato() {
  local nome="$1" host="$2" chiave="$TLS_DIR/$1.key" cert="$TLS_DIR/$1.crt" est csr
  if [ -s "$chiave" ] && [ -s "$cert" ] && coppia "$chiave" "$cert" && valido_per "$cert" 30 \
     && openssl verify -CAfile "$CA_CRT" "$cert" >/dev/null 2>&1 \
     && openssl x509 -in "$cert" -noout -text | sed 's/^ *//' | grep -qxF "DNS:$host"; then
    return 0
  fi
  est="$(mktemp "$STATO/leaf.cnf.XXXXXX")"
  csr="$(mktemp "$STATO/leaf.csr.XXXXXX")"
  cat > "$est" <<FINE
[v3_leaf]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = DNS:$host
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
FINE
  openssl ecparam -name prime256v1 -genkey -noout -out "$chiave" 2>/dev/null
  chmod 600 "$chiave"
  openssl req -new -key "$chiave" -subj "/CN=$host" -out "$csr" 2>/dev/null
  # 397 giorni: il massimo che i browser accettano per un certificato di un
  # sito, anche se firmato da un'autorità aggiunta a mano.
  openssl x509 -req -in "$csr" -CA "$CA_CRT" -CAkey "$CA_KEY" -set_serial "0x$(openssl rand -hex 16)" \
    -days 397 -sha256 -extfile "$est" -extensions v3_leaf -out "$cert" 2>/dev/null \
    || { rm -f "$est" "$csr"; errore "openssl non ha firmato il certificato di $host."; }
  rm -f "$est" "$csr"
  nota "certificato per $host"
}

# Secret TLS e ConfigMap dell'autorità nel namespace: stessi nomi a ogni lancio,
# riscritti con `apply`. Il controller di ingresso li ricarica da sé.
secret_tls() {
  kc -n "$NAMESPACE" create secret tls "$1" --cert="$TLS_DIR/$2.crt" --key="$TLS_DIR/$2.key" \
    --dry-run=client -o yaml | kc apply -f - >/dev/null
}
certificato app "$APP_HOST"
certificato jitsi "$JITSI_HOST"
secret_tls app-tls app
secret_tls jitsi-tls jitsi
if [ "$MAILPIT" = "si" ]; then
  certificato mail "$MAIL_HOST"
  secret_tls mail-tls mail
fi
kc -n "$NAMESPACE" create configmap "$SECRET_CA" --from-file=ca.crt="$CA_CRT" \
  --dry-run=client -o yaml | kc apply -f - >/dev/null
IMPRONTA_CA="$(openssl x509 -in "$CA_CRT" -noout -fingerprint -sha256 | sed 's/^[^=]*=//')"

# ── Casella di prova per le email ───────────────────────────────
if [ "$MAILPIT" = "si" ]; then
  passo "Mailpit (email del portale)"
  kc -n "$NAMESPACE" apply -f - >/dev/null <<FINE
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mailpit
  labels: { app.kubernetes.io/name: mailpit, app.kubernetes.io/part-of: pa-webinar-minikube }
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
  labels: { app.kubernetes.io/name: mailpit, app.kubernetes.io/part-of: pa-webinar-minikube }
spec:
  selector: { app.kubernetes.io/name: mailpit }
  ports:
    - { name: smtp, port: 1025, targetPort: smtp }
    - { name: http, port: 8025, targetPort: http }
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mailpit
  labels: { app.kubernetes.io/name: mailpit, app.kubernetes.io/part-of: pa-webinar-minikube }
  annotations:
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
    - hosts: ["$MAIL_HOST"]
      secretName: mail-tls
  rules:
    - host: $MAIL_HOST
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: mailpit, port: { name: http } }
FINE
  nota "https://$MAIL_HOST"
fi

# ── Valori di questa macchina ───────────────────────────────────
{
  printf '# Generato da scripts/minikube-up.sh: indirizzi del nodo %s. Si riscrive a ogni lancio.\n' "$IP"
  printf 'app:\n  env:\n'
  printf '    NEXT_PUBLIC_APP_URL: "https://%s"\n' "$APP_HOST"
  printf '    NEXT_PUBLIC_JITSI_DOMAIN: "%s"\n' "$JITSI_HOST"
  printf '  extraCaCerts:\n    configMapName: "%s"\n    key: ca.crt\n' "$SECRET_CA"
  printf 'ingress:\n  hosts:\n    - host: "%s"\n      paths:\n        - path: /\n          pathType: Prefix\n' "$APP_HOST"
  printf '  tls:\n    - secretName: app-tls\n      hosts: ["%s"]\n' "$APP_HOST"
  printf 'jitsi-meet:\n  publicURL: "https://%s"\n' "$JITSI_HOST"
  printf '  web:\n    ingress:\n      hosts:\n        - host: "%s"\n          paths: ["/"]\n' "$JITSI_HOST"
  printf '      tls:\n        - secretName: jitsi-tls\n          hosts: ["%s"]\n' "$JITSI_HOST"
  if [ "$MAILPIT" = "si" ]; then
    printf 'secrets:\n  generate:\n'
    printf '    SMTP_HOST: "mailpit"\n    SMTP_PORT: "1025"\n    SMTP_SECURE: "false"\n'
    printf '    SMTP_FROM: "eventi@%s"\n' "$APP_HOST"
  fi
} > "$LOCALI"

# ── Sottocharts ─────────────────────────────────────────────────
# Non sono versionati. Si scaricano con un elenco di repository temporaneo,
# per non toccare quello di chi lancia lo script.
if [ -z "$(ls -A "$CHART/charts" 2>/dev/null)" ]; then
  passo "Sottocharts"
  repo_tmp="$(mktemp -d)"
  helm repo add bitnami https://charts.bitnami.com/bitnami \
    --repository-config "$repo_tmp/repositories.yaml" --repository-cache "$repo_tmp/cache" >/dev/null
  helm repo add jitsi-contrib https://jitsi-contrib.github.io/jitsi-helm/ \
    --repository-config "$repo_tmp/repositories.yaml" --repository-cache "$repo_tmp/cache" >/dev/null
  helm dependency build "$CHART" \
    --repository-config "$repo_tmp/repositories.yaml" --repository-cache "$repo_tmp/cache" >/dev/null
  rm -rf "$repo_tmp"
fi

# ── Installazione ───────────────────────────────────────────────
if esiste_release; then operazione="aggiornamento"; else operazione="prima installazione"; fi
passo "Helm: $operazione di '$RELEASE' in $NAMESPACE (attesa massima $ATTESA)"
[ "$operazione" = "prima installazione" ] && nota "le migrazioni ripartono qualche volta finché PostgreSQL non è pronto: è normale."
inizio=$(date +%s)
if ! helm --kube-context "$PROFILO" upgrade --install "$RELEASE" "$CHART" \
    -n "$NAMESPACE" \
    -f "$CHART/examples/values-simple.yaml" \
    -f "$CHART/examples/values-minikube.yaml" \
    -f "$LOCALI" \
    -f "$SEGRETI" \
    ${extra[@]+"${extra[@]}"} \
    --wait --timeout "$ATTESA" > "$STATO/helm-notes.txt"; then
  printf '\n' >&2
  kc -n "$NAMESPACE" get pods >&2 || true
  kc -n "$NAMESPACE" get events --sort-by=.lastTimestamp 2>/dev/null | tail -n 15 >&2 || true
  errore "helm non ha completato. Stato dei pod ed eventi recenti qui sopra."
fi
nota "pronta in $(( $(date +%s) - inizio )) s"
# Le note del chart segnalano ciò che resta da controllare (credenziali non
# fissate, STUN di terzi, indirizzi di esempio): se ci sono, le si mostra.
if grep -q "Da controllare" "$STATO/helm-notes.txt"; then
  sed -n '/Da controllare/,/Prossimi passi/p' "$STATO/helm-notes.txt" | sed '$d; s/^/   /'
  if grep -q "publicIPs" "$STATO/helm-notes.txt"; then
    nota "(su minikube l'avviso sul bridge è atteso: i browser stanno su questa"
    nota " macchina e raggiungono direttamente l'IP del nodo)"
  fi
fi

# ── Controlli ───────────────────────────────────────────────────
passo "Controlli"
# --resolve: il controllo vale anche quando il DNS locale non risolve nip.io.
# --cacert: i certificati devono verificarsi con l'autorità locale, come
# succederà nel browser che la considera fidata.
salute="$(curl -s --cacert "$CA_CRT" --max-time 20 --resolve "$APP_HOST:443:$IP" "https://$APP_HOST/api/health" 2>&1 || true)"
case "$salute" in
  *'"status":"ok"'*) nota "portale: /api/health ok, certificato verificato" ;;
  *) errore "il portale non risponde come atteso su https://$APP_HOST/api/health: $salute" ;;
esac
codice="$(curl -s --cacert "$CA_CRT" --max-time 20 -o /dev/null -w '%{http_code}' --resolve "$JITSI_HOST:443:$IP" "https://$JITSI_HOST/config.js" 2>&1 || true)"
[ "$codice" = "200" ] || errore "la conferenza risponde $codice su https://$JITSI_HOST/config.js"
nota "conferenza: config.js 200, certificato verificato"
# In http:// la pagina non è un contesto sicuro: il browser non dà microfono né
# videocamera, e la sala resta a caricare. Il controller deve rimandare a https.
for h in "$APP_HOST" "$JITSI_HOST"; do
  rinvio="$(curl -s --max-time 20 -o /dev/null -w '%{http_code} %{redirect_url}' --resolve "$h:80:$IP" "http://$h/" || true)"
  case "$rinvio" in
    30[178]" https://$h/"*) ;;
    *) errore "http://$h/ non rimanda a https (risposta: $rinvio)" ;;
  esac
done
nota "http rimanda a https su portale e conferenza"

# ── Riepilogo ───────────────────────────────────────────────────
cat <<FINE

✓ PA Webinar è su minikube (profilo $PROFILO, namespace $NAMESPACE).

  Portale              https://$APP_HOST
  Amministrazione      https://$APP_HOST/it/admin/login
  Conferenza           https://$JITSI_HOST
FINE
[ "$MAILPIT" = "si" ] && printf '  Email inviate        https://%s\n' "$MAIL_HOST"
case "$IMMAGINI" in
  registry) printf '  Immagini             %s:%s, prelevate dal nodo\n' "$REPO_IMMAGINE" "$TAG" ;;
  host) printf '  Immagini             %s:%s, caricate nel nodo\n' "$REPO_IMMAGINE" "$TAG" ;;
  local) printf '  Immagini             costruite dai sorgenti di %s\n' "$RADICE" ;;
esac
if [ "$secret_pull" = "si" ]; then
  printf '  Credenziali ghcr.io  nel Secret %s del namespace, finché esiste il profilo\n' "$SECRET_PULL"
fi
if [ "$memoria_scarsa" = "si" ]; then
  printf '\n  ATTENZIONE: nodo da %s, sotto i 3 GB provati come minimo (vedi sopra).\n' "$MEMORIA"
fi
cat <<FINE

  Chiave di amministrazione: secrets.generate.ADMIN_API_KEY in
    $SEGRETI
  (grep ADMIN_API_KEY '$SEGRETI')

Prossimi passi
  1. Rendi fidata, una volta sola, l'autorità locale che firma i certificati:
       $CA_CRT
       impronta SHA-256 $IMPRONTA_CA
     $( [ "$nuova_ca" = "si" ] && printf '%s' "È stata appena creata: se ne avevi resa fidata una prima, sostituiscila." || printf '%s' "È la stessa dei lanci precedenti: se l'hai già resa fidata, non serve altro.")
     Firma solo nomi sotto nip.io e sslip.io (e il dominio scelto). Una delle
     strade, poi riapri il browser:
     - Chrome, Chromium, Edge su Linux (serve certutil: pacchetto nss-tools su
       Fedora, libnss3-tools su Debian e Ubuntu):
         certutil -d sql:\$HOME/.pki/nssdb -A -t "C,," -n "PA Webinar minikube" -i '$CA_CRT'
     - Firefox, ogni sistema: Impostazioni > Privacy e sicurezza > Certificati >
       Mostra certificati > Autorità > Importa, e spunta l'identificazione dei siti.
     - Sistema (curl e gli altri programmi della macchina), su Fedora:
         sudo cp '$CA_CRT' /etc/pki/ca-trust/source/anchors/pa-webinar-minikube.crt && sudo update-ca-trust
       su Debian e Ubuntu:
         sudo cp '$CA_CRT' /usr/local/share/ca-certificates/pa-webinar-minikube.crt && sudo update-ca-certificates
       su macOS (vale per Chrome e Safari):
         sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain '$CA_CRT'
     Senza: apri una volta https://$JITSI_HOST e accetta l'avviso, poi fai lo
     stesso con il portale. Solo il portale non basta: la sala non si carica.
  2. Entra nell'amministrazione con la chiave e crea un evento.
  3. I browser devono girare su questa macchina: l'IP del nodo ($IP) non è
     raggiungibile da altre.
  4. I comandi usano il contesto del profilo in modo esplicito, ad esempio
       kubectl --context $PROFILO -n $NAMESPACE get pods
     Il contesto attivo resta quello di prima${CONTESTO_PRECEDENTE:+ ($CONTESTO_PRECEDENTE)}.
  5. Rilancia questo script per aggiornare; scripts/minikube-down.sh per spegnere o cancellare.
FINE
if [ "$IMMAGINI" = "registry" ] && [ "$TAG" = "dev" ]; then
  # Un tag mobile non cambia nel manifesto: helm non ha niente da aggiornare.
  # Con --images host lo script confronta le immagini e riavvia da sé.
  case "$RELEASE" in
    *pa-webinar*) deployment="$RELEASE" ;;
    *) deployment="$RELEASE-pa-webinar" ;;
  esac
  cat <<FINE
  6. Il tag $TAG si sposta a ogni pubblicazione, e rilanciare lo script non
     preleva l'immagine nuova. Per prenderla (o usa un tag fisso, dev-<sha>):
       kubectl --context $PROFILO -n $NAMESPACE rollout restart deployment/$deployment
FINE
fi
