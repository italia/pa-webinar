#!/usr/bin/env bash
#
# Controlla che un'installazione di PA Webinar funzioni: dopo la prima
# installazione, dopo un aggiornamento o un ripristino, e periodicamente da
# cron o da un timer di systemd. Vale per ogni piattaforma (minikube, k3s,
# cluster gestiti): legge lo stato dal cluster con kubectl e prova il portale e
# la conferenza dall'esterno, come un browser.
#
# Uso:  scripts/verify-install.sh [opzioni]        (--help per l'elenco)
#
# Esce con 0 se tutti i controlli passano (gli avvisi non contano, salvo
# --strict), 1 se almeno un controllo fallisce, 2 se non può controllare
# (opzioni sbagliate, strumenti mancanti).
#
# Cosa NON fa: non cambia niente nel cluster e non crea dati, salvo con --call,
# che crea una chiamata di prova e la cancella alla fine.

set -euo pipefail

RADICE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib/ops-common.sh
source "$RADICE/scripts/lib/ops-common.sh"

URL=""
MEET_URL=""
RESOLVE_IP=""
CA_FILE=""
INSECURE="no"
CERT_MIN_DAYS=14
SECRETS_FILE=""
KEYS_FROM_CLUSTER="no"
NO_CLUSTER="no"
DISK_WARN=80
DISK_FAIL=90
OUTBOX_MAX_AGE=30
CALL="no"
BROWSER=""
CALL_TIMEOUT=180
ATTESA_CONFERENZA=90
QUIET="no"
STRICT="no"

uso() {
  cat <<'FINE'
Uso: scripts/verify-install.sh [opzioni]

Controlla un'installazione di PA Webinar: stato nel cluster, portale e
conferenza da fuori, certificati, lavori pianificati, coda delle email, disco
del database e, a richiesta, una chiamata vera fra due partecipanti.

Esito: 0 tutto a posto (anche con avvisi, salvo --strict), 1 almeno un errore,
2 impossibile controllare (opzioni, strumenti mancanti).

Cluster (kubectl riceve sempre kubeconfig e contesto espliciti: il contesto
attivo non cambia)
  --kubeconfig FILE     predefinito: $KUBECONFIG, poi ~/.kube/config, poi
                        /etc/rancher/k3s/k3s.yaml (nodo k3s)
  --context NOME        predefinito: il contesto corrente di quel kubeconfig
  --namespace NOME      predefinito: pa-webinar
  --release NOME        release Helm, predefinito: pa-webinar
  --no-cluster          solo i controlli da fuori (da una macchina senza
                        accesso al cluster): servono --url e --meet-url

Indirizzi (predefinito: quelli della ConfigMap del portale)
  --url URL             portale, es. https://webinar.example.org
  --meet-url URL        conferenza, es. https://meet.example.org
  --resolve IP          raggiunge portale e conferenza a questo IP, come
                        curl --resolve (DNS non ancora propagato, nip.io)
  --ca-file FILE        autorità con cui verificare i certificati, oltre a
                        quelle di sistema (autorità privata, minikube)
  --insecure            certificato non verificabile = avviso, non errore
                        (solo per la valutazione)
  --cert-min-days N     giorni di validità residua sotto cui è un errore:
                        il rinnovo non è avvenuto (predefinito: 14)
  --conference-wait S   ogni aggiornamento fa ripartire il front end della
                        conferenza (qualche secondo di 502): i controlli
                        della conferenza si ripetono fino a S secondi prima
                        di dare errore (predefinito: 90)

Chiave di amministrazione (mai sulla riga di comando). Serve a leggere lo
stato dei componenti quando la pagina di stato non è pubblica, e a --call.
  --secrets-file FILE   file con ADMIN_API_KEY, come KEY=valore (.env) o come
                        valori Helm (KEY: "valore"); "-" legge da standard input
  --keys-from-cluster   legge ADMIN_API_KEY dal Secret del portale
  Ogni accesso con la chiave resta nel registro delle azioni amministrative.

Soglie
  --disk-warn PCT       disco del database oltre cui avvisare (predefinito: 80)
  --disk-fail PCT       ... oltre cui è un errore (predefinito: 90)
  --outbox-max-age MIN  email in attesa oltre il loro orario da più di MIN
                        minuti = la coda non si svuota (predefinito: 30)

Chiamata di prova
  --call                due partecipanti headless entrano in una chiamata
                        istantanea creata per la prova, si controlla che audio
                        e video arrivino in entrambe le direzioni, poi la
                        chiamata si chiude e si cancella. Servono node e
                        Playwright (npm ci nella radice del repository) e un
                        Chromium: npx playwright install chromium, o --browser
  --browser PATH        Chrome o Chromium da usare
  --call-timeout S      attesa massima per entrare (predefinito: 180)

Uscita
  --quiet               stampa solo avvisi ed errori, niente se va tutto bene
                        (per cron, che invia per email solo l'output)
  --strict              gli avvisi contano come errori
  -h, --help            questo aiuto

Esempi
  # minikube (scripts/minikube-up.sh)
  scripts/verify-install.sh --context pa-webinar \
    --ca-file ~/.config/pa-webinar/minikube/pa-webinar/ca.crt \
    --secrets-file ~/.config/pa-webinar/minikube/pa-webinar/secrets.yaml --call
  # nodo k3s, da cron ogni 15 minuti
  */15 * * * * /opt/pa-webinar/scripts/verify-install.sh --quiet --keys-from-cluster
FINE
}

uscita_uso() {
  printf '✗ %s\n' "$*" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --kubeconfig) OPS_KUBECONFIG="${2:?--kubeconfig vuole un file}"; shift 2 ;;
    --context) OPS_CONTEXT="${2:?--context vuole un nome}"; shift 2 ;;
    --namespace) OPS_NAMESPACE="${2:?--namespace vuole un nome}"; shift 2 ;;
    --release) OPS_RELEASE="${2:?--release vuole un nome}"; shift 2 ;;
    --no-cluster) NO_CLUSTER="si"; shift ;;
    --url) URL="${2:?--url vuole un indirizzo}"; shift 2 ;;
    --meet-url) MEET_URL="${2:?--meet-url vuole un indirizzo}"; shift 2 ;;
    --resolve) RESOLVE_IP="${2:?--resolve vuole un IP}"; shift 2 ;;
    --ca-file) CA_FILE="${2:?--ca-file vuole un file}"; shift 2 ;;
    --insecure) INSECURE="si"; shift ;;
    --cert-min-days) CERT_MIN_DAYS="${2:?}"; shift 2 ;;
    --secrets-file) SECRETS_FILE="${2:?--secrets-file vuole un file}"; shift 2 ;;
    --keys-from-cluster) KEYS_FROM_CLUSTER="si"; shift ;;
    --disk-warn) DISK_WARN="${2:?}"; shift 2 ;;
    --disk-fail) DISK_FAIL="${2:?}"; shift 2 ;;
    --outbox-max-age) OUTBOX_MAX_AGE="${2:?}"; shift 2 ;;
    --call) CALL="si"; shift ;;
    --browser) BROWSER="${2:?--browser vuole un percorso}"; shift 2 ;;
    --call-timeout) CALL_TIMEOUT="${2:?}"; shift 2 ;;
    --conference-wait) ATTESA_CONFERENZA="${2:?}"; shift 2 ;;
    --quiet) QUIET="si"; shift ;;
    --strict) STRICT="si"; shift ;;
    -h|--help) uso; exit 0 ;;
    *) uscita_uso "Opzione sconosciuta: $1 (--help per l'elenco)" ;;
  esac
done

for n in "$CERT_MIN_DAYS" "$DISK_WARN" "$DISK_FAIL" "$OUTBOX_MAX_AGE" "$CALL_TIMEOUT" "$ATTESA_CONFERENZA"; do
  [[ "$n" =~ ^[0-9]+$ ]] || uscita_uso "Le soglie sono numeri interi (non '$n')."
done
[ -z "$CA_FILE" ] || [ -r "$CA_FILE" ] || uscita_uso "--ca-file: $CA_FILE non leggibile."
if [ -n "$SECRETS_FILE" ] && [ "$SECRETS_FILE" != "-" ] && [ ! -r "$SECRETS_FILE" ]; then
  uscita_uso "--secrets-file: $SECRETS_FILE non leggibile."
fi
if [ "$NO_CLUSTER" = "si" ]; then
  [ -n "$URL" ] || uscita_uso "--no-cluster vuole --url (e --meet-url per la conferenza)."
  [ "$KEYS_FROM_CLUSTER" = "no" ] || uscita_uso "--keys-from-cluster non si combina con --no-cluster."
fi

strumenti=(curl openssl awk)
[ "$NO_CLUSTER" = "si" ] || strumenti+=(kubectl)
for c in "${strumenti[@]}"; do
  command -v "$c" >/dev/null 2>&1 || uscita_uso "Manca '$c'."
done
if [ "$CALL" = "si" ]; then
  command -v node >/dev/null 2>&1 || uscita_uso "--call richiede node (20 o più recente)."
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
chmod 700 "$TMP"

# curl --cacert sostituisce le autorità di sistema: con --ca-file si passa un
# elenco con entrambe, così un certificato pubblico si verifica anche quando
# il file indicato è quello di un'autorità privata.
CA_BUNDLE=""
if [ -n "$CA_FILE" ]; then
  CA_BUNDLE="$TMP/autorita.pem"
  : > "$CA_BUNDLE"
  for f in "${SSL_CERT_FILE:-}" /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt \
    /etc/ssl/cert.pem "$(openssl version -d 2>/dev/null | sed -n 's/^OPENSSLDIR: "\(.*\)"$/\1/p')/cert.pem"; do
    if [ -n "$f" ] && [ -s "$f" ]; then cat "$f" >> "$CA_BUNDLE"; break; fi
  done
  cat "$CA_FILE" >> "$CA_BUNDLE"
fi

# ── Uscita ──────────────────────────────────────────────────────
N_OK=0
N_AVVISI=0
N_ERRORI=0
INTESTAZIONE_FATTA="no"

descrizione_installazione() {
  if [ "$NO_CLUSTER" = "si" ]; then
    printf 'PA Webinar su %s' "$URL"
  else
    printf 'PA Webinar, release %s nel namespace %s (contesto %s)' "$OPS_RELEASE" "$OPS_NAMESPACE" "$OPS_CONTEXT"
  fi
}

intestazione() {
  [ "$INTESTAZIONE_FATTA" = "si" ] && return 0
  INTESTAZIONE_FATTA="si"
  printf '%s\n' "$(descrizione_installazione)"
}

sezione() {
  [ "$QUIET" = "si" ] && return 0
  printf '\n── %s\n' "$*"
}

ok() {
  N_OK=$((N_OK + 1))
  [ "$QUIET" = "si" ] && return 0
  printf '  ok      %s\n' "$*"
}

avviso() {
  N_AVVISI=$((N_AVVISI + 1))
  [ "$QUIET" = "si" ] && intestazione
  printf '  AVVISO  %s\n' "$*"
}

errore() {
  N_ERRORI=$((N_ERRORI + 1))
  [ "$QUIET" = "si" ] && intestazione
  printf '  ERRORE  %s\n' "$*"
}

info() {
  [ "$QUIET" = "si" ] && return 0
  printf '          %s\n' "$*"
}

# ── Cluster ─────────────────────────────────────────────────────
DEPLOYMENT=""
CONFIGMAP=""
SECRET_APP=""
POD_PG=""

controlla_cluster() {
  if ! ops_fissa_contesto; then
    errore "nessun contesto kubectl: indica --kubeconfig e --context (o --no-cluster)"
    return 1
  fi
  [ "$QUIET" = "si" ] || intestazione
  sezione "Cluster"
  if ! kc_cluster get namespace "$OPS_NAMESPACE" >/dev/null 2>"$TMP/kerr"; then
    errore "cluster non raggiungibile o namespace $OPS_NAMESPACE assente: $(head -c 300 "$TMP/kerr" | tr '\n' ' ')"
    return 1
  fi
  ok "API del cluster raggiungibile ($(ops_server_api)), namespace $OPS_NAMESPACE presente"

  local trovati
  trovati="$(ops_deployment_portale)"
  if [ -z "$trovati" ]; then
    errore "nessun Deployment del portale per la release $OPS_RELEASE (initContainer db-migrate)"
    return 1
  fi
  if [ "$(printf '%s\n' "$trovati" | wc -l)" -gt 1 ]; then
    errore "più Deployment del portale per la release $OPS_RELEASE: $(printf '%s' "$trovati" | tr '\n' ' ')"
    return 1
  fi
  DEPLOYMENT="$trovati"

  local riga voluti pronti in_ripristino
  riga="$(kc get deployment "$DEPLOYMENT" -o jsonpath='{.spec.replicas}{"|"}{.status.readyReplicas}{"|"}{.metadata.annotations.pa-webinar/restore-replicas}')"
  IFS='|' read -r voluti pronti in_ripristino <<< "$riga"
  pronti="${pronti:-0}"
  if [ -n "$in_ripristino" ]; then
    errore "portale ($DEPLOYMENT) fermato da un ripristino non concluso (scripts/restore.sh --resume)"
  elif [ "${voluti:-0}" = "0" ]; then
    errore "portale ($DEPLOYMENT) scalato a zero repliche"
  elif [ "$pronti" = "0" ]; then
    errore "portale ($DEPLOYMENT): nessuna replica pronta su $voluti"
  elif [ "$pronti" -lt "$voluti" ]; then
    avviso "portale ($DEPLOYMENT): $pronti repliche pronte su $voluti"
  else
    ok "portale ($DEPLOYMENT): $pronti/$voluti repliche pronte"
  fi

  CONFIGMAP="$(kc get deployment "$DEPLOYMENT" -o jsonpath='{.spec.template.spec.containers[?(@.name=="pa-webinar")].envFrom[*].configMapRef.name}' | awk '{print $1}')"
  SECRET_APP="$(kc get deployment "$DEPLOYMENT" -o jsonpath='{.spec.template.spec.containers[?(@.name=="pa-webinar")].envFrom[*].secretRef.name}' | awk '{print $1}')"

  controlla_pod
  controlla_immagini
  controlla_storage
  return 0
}

# Object storage su volume (l'add-on Garage), se la release lo ha: fermato da
# un backup o da un ripristino, o spento. I suoi pod li guarda controlla_pod.
controlla_storage() {
  local d riga voluti pronti fermo p
  for d in $(ops_deployment_storage); do
    riga="$(kc get deployment "$d" -o jsonpath='{.spec.replicas}{"|"}{.status.readyReplicas}{"|"}{.metadata.annotations.pa-webinar/restore-replicas}' 2>/dev/null || true)"
    IFS='|' read -r voluti pronti fermo <<< "$riga"
    if [ -n "$fermo" ]; then
      errore "object storage ($d) fermato da un backup o da un ripristino con --include-storage (in corso, o interrotto: scripts/restore.sh --resume)"
    elif [ "${voluti:-0}" = "0" ]; then
      errore "object storage ($d) a zero repliche: materiali e registrazioni non si caricano né si leggono"
    elif [ "${pronti:-0}" -gt 0 ]; then
      ok "object storage ($d): $pronti/$voluti repliche pronte"
    fi
  done
  for p in $(kc get pods -l "app.kubernetes.io/instance=$OPS_RELEASE,app.kubernetes.io/component=storage-copy" -o name 2>/dev/null || true); do
    avviso "${p#pod/}: pod di appoggio di un backup o di un ripristino dello storage; se nessuno è in corso, kubectl -n $OPS_NAMESPACE delete ${p}"
  done
  return 0
}

controlla_pod() {
  # Pod della release non pronti. Quelli dei lavori pianificati si guardano
  # nella loro sezione: un lavoro finito è un pod "Succeeded", non un guasto.
  local righe nome fase padre pronti attese creato eta ora problemi=0 totale=0
  righe="$(kc get pods -l "app.kubernetes.io/instance=$OPS_RELEASE" \
    -o jsonpath='{range .items[*]}{.metadata.name}{"|"}{.status.phase}{"|"}{.metadata.ownerReferences[0].kind}{"|"}{range .status.containerStatuses[*]}{.ready}{","}{end}{"|"}{range .status.containerStatuses[*]}{.state.waiting.reason}{","}{end}{"|"}{.metadata.creationTimestamp}{"\n"}{end}' 2>/dev/null || true)"
  ora="$(date -u +%s)"
  # Separatore "|": con una tabulazione `read` fonderebbe i campi vuoti.
  while IFS='|' read -r nome fase padre pronti attese creato; do
    [ -n "$nome" ] || continue
    [ "$padre" = "Job" ] && continue
    totale=$((totale + 1))
    if [ "$fase" != "Running" ] || [[ "$pronti" == *false* ]]; then
      problemi=$((problemi + 1))
      attese="$(printf '%s' "$attese" | tr -s ',' ' ' | sed 's/^ *//; s/ *$//')"
      eta=$(( ora - $(ops_epoca "$creato" || echo 0) ))
      # Un pod appena creato (aggiornamento, riavvio dopo un cambio di
      # configurazione) non è ancora pronto per definizione.
      if [ "$eta" -lt 180 ] && [[ "$attese" != *CrashLoopBackOff* ]] && [[ "$attese" != *ImagePull* ]] && [[ "$attese" != *ErrImage* ]]; then
        avviso "pod $nome in avvio da $eta s (fase $fase${attese:+, $attese})"
      else
        errore "pod $nome non pronto (fase $fase${attese:+, $attese})"
      fi
    fi
  done <<< "$righe"
  if [ "$problemi" -eq 0 ]; then
    ok "$totale pod della release, tutti pronti"
  fi
}

# Tag di un riferimento d'immagine (repository:tag[@digest]); vuoto se c'è
# solo il digest.
tag_immagine() {
  local rif="${1%%@*}" ultimo
  ultimo="${rif##*/}"
  case "$ultimo" in
    *:*) printf '%s' "${ultimo##*:}" ;;
    *) printf '' ;;
  esac
}

controlla_immagini() {
  local riga versione img_app img_mig tag_app tag_mig atteso
  riga="$(kc get deployment "$DEPLOYMENT" -o jsonpath='{.metadata.labels.app\.kubernetes\.io/version}{"|"}{.spec.template.spec.containers[?(@.name=="pa-webinar")].image}{"|"}{.spec.template.spec.initContainers[?(@.name=="db-migrate")].image}')"
  IFS='|' read -r versione img_app img_mig <<< "$riga"
  tag_app="$(tag_immagine "$img_app")"
  tag_mig="$(tag_immagine "$img_mig")"
  if [ -z "$tag_app" ] || [ -z "$tag_mig" ]; then
    info "immagini fissate per digest: confronto dei tag saltato ($img_app, $img_mig)"
    return 0
  fi
  # Il rilascio pubblica l'applicazione come X.Y.Z e le migrazioni come
  # vX.Y.Z-migrate; il valore calcolato dal chart è X.Y.Z-migrate.
  if [ "$tag_app" = "$versione" ] && { [ "$tag_mig" = "v$versione-migrate" ] || [ "$tag_mig" = "$versione-migrate" ]; }; then
    ok "immagini dell'appVersion del chart, $versione (portale $tag_app, migrazioni $tag_mig)"
    return 0
  fi
  atteso="no"
  case "$tag_mig" in
    "$tag_app-migrate"|"v$tag_app-migrate"|"v${tag_app#v}-migrate") atteso="si" ;;
  esac
  case "$tag_app" in
    dev-*) [ "$tag_mig" = "dev-migrate-${tag_app#dev-}" ] && atteso="si" ;;
  esac
  if [ "$atteso" = "si" ]; then
    avviso "immagini $tag_app e $tag_mig, ma l'appVersion del chart è $versione: chart e immagini devono venire dallo stesso tag git (build locale o di sviluppo: va bene solo per la valutazione)"
  else
    errore "portale ($tag_app) e migrazioni ($tag_mig) non sono della stessa versione (appVersion del chart $versione)"
  fi
}

# ── Indirizzi ───────────────────────────────────────────────────
PORTALE_HOST=""
MEET_HOST=""

host_da_url() {
  local u="${1#*://}"
  u="${u%%/*}"
  printf '%s' "${u%%:*}"
}

ricava_indirizzi() {
  if [ "$NO_CLUSTER" = "no" ] && [ -n "$CONFIGMAP" ]; then
    local app_url jitsi
    app_url="$(kc get configmap "$CONFIGMAP" -o jsonpath='{.data.NEXT_PUBLIC_APP_URL}' 2>/dev/null || true)"
    jitsi="$(kc get configmap "$CONFIGMAP" -o jsonpath='{.data.NEXT_PUBLIC_JITSI_DOMAIN}' 2>/dev/null || true)"
    [ -n "$URL" ] || URL="$app_url"
    if [ -z "$MEET_URL" ] && [ -n "$jitsi" ]; then
      case "$jitsi" in
        http://*|https://*) MEET_URL="$jitsi" ;;
        *) MEET_URL="https://$jitsi" ;;
      esac
    fi
  fi
  URL="${URL%/}"
  MEET_URL="${MEET_URL%/}"
  [ -n "$URL" ] && PORTALE_HOST="$(host_da_url "$URL")"
  [ -n "$MEET_URL" ] && MEET_HOST="$(host_da_url "$MEET_URL")"
  return 0
}

# ── HTTP ────────────────────────────────────────────────────────
# Host il cui certificato non si verifica: le prove di contenuto vanno avanti
# senza verifica, e il problema del certificato si segnala una volta sola.
SENZA_VERIFICA=" "

curl_base() {
  local host="$1"
  local a=(-sS --max-time 20)
  [ -n "$CA_BUNDLE" ] && a+=(--cacert "$CA_BUNDLE")
  if [ "$INSECURE" = "si" ] || [[ "$SENZA_VERIFICA" == *" $host "* ]]; then a+=(-k); fi
  if [ -n "$RESOLVE_IP" ]; then
    a+=(--resolve "$host:443:$RESOLVE_IP" --resolve "$host:80:$RESOLVE_IP")
  fi
  printf '%s\0' "${a[@]}"
}

# Uso: http_get HOST URL FILE_CORPO [altri argomenti di curl] -> codice HTTP.
# Un 502, 503 o 504 o una connessione mancata si riprovano due volte a due
# secondi di distanza: subito dopo un aggiornamento il proxy risponde 502 per
# qualche istante mentre un pod si sostituisce, e non è un guasto.
http_get() {
  local host="$1" url="$2" corpo="$3"; shift 3
  local a=() codice tentativo
  while IFS= read -r -d '' x; do a+=("$x"); done < <(curl_base "$host")
  for tentativo in 1 2 3; do
    codice="$(curl "${a[@]}" -o "$corpo" -w '%{http_code}' "$@" "$url" 2>"$TMP/curl.err" || true)"
    case "$codice" in
      000|502|503|504) [ "$tentativo" -lt 3 ] && sleep 2 ;;
      *) break ;;
    esac
  done
  printf '%s' "$codice"
}

# Validità del certificato: la catena e il nome li verifica curl (fiducia di
# sistema, o solo --ca-file se indicato: la stessa delle prove di contenuto);
# openssl serve solo a leggere la scadenza del certificato presentato.
controlla_certificato() {
  local host="$1" connetti out cert fine fine_s ora giorni verificato="si" motivo=""
  connetti="${RESOLVE_IP:-$host}:443"
  if command -v timeout >/dev/null 2>&1; then
    out="$(timeout 20 openssl s_client -connect "$connetti" -servername "$host" </dev/null 2>/dev/null || true)"
  else
    out="$(openssl s_client -connect "$connetti" -servername "$host" </dev/null 2>/dev/null || true)"
  fi
  cert="$(printf '%s\n' "$out" | awk '/-----BEGIN CERTIFICATE-----/{p=1} p{print} /-----END CERTIFICATE-----/{exit}')"
  if [ -z "$cert" ]; then
    errore "$host: nessun certificato sulla porta 443 (TLS non raggiungibile da qui)"
    SENZA_VERIFICA+="$host "
    return 0
  fi
  local c=(-sS --max-time 20 -o /dev/null)
  [ -n "$CA_BUNDLE" ] && c+=(--cacert "$CA_BUNDLE")
  [ -n "$RESOLVE_IP" ] && c+=(--resolve "$host:443:$RESOLVE_IP")
  if ! curl "${c[@]}" "https://$host/" 2>"$TMP/tls.err"; then
    verificato="no"
    motivo="$(sed -n 's/^curl: ([0-9]*) //p' "$TMP/tls.err" | head -n 1)"
  fi
  fine="$(printf '%s\n' "$cert" | openssl x509 -noout -enddate 2>/dev/null | sed 's/^notAfter=//')"
  fine_s="$(ops_epoca "$fine" || true)"
  ora="$(date -u +%s)"
  if [ -z "$fine_s" ]; then
    errore "$host: scadenza del certificato illeggibile ($fine)"
    return 0
  fi
  giorni=$(( (fine_s - ora) / 86400 ))
  if [ "$verificato" = "no" ]; then
    SENZA_VERIFICA+="$host "
    if [ "$INSECURE" = "si" ]; then
      avviso "$host: certificato non verificabile (${motivo:-errore TLS}), accettato per --insecure"
    else
      errore "$host: certificato non verificabile (${motivo:-errore TLS})${CA_FILE:+ con $CA_FILE}"
    fi
  fi
  if [ "$fine_s" -le "$ora" ]; then
    errore "$host: certificato scaduto il $fine"
  elif [ "$giorni" -lt "$CERT_MIN_DAYS" ]; then
    errore "$host: il certificato scade fra $giorni giorni ($fine): il rinnovo non è avvenuto"
  elif [ "$verificato" = "si" ]; then
    ok "$host: certificato valido fino al $fine ($giorni giorni)"
  else
    info "$host: scadenza $fine ($giorni giorni)"
  fi
}

controlla_rinvio_https() {
  local host="$1" a=() risposta
  a=(-s --max-time 20 -o /dev/null -w '%{http_code} %{redirect_url}')
  [ -n "$RESOLVE_IP" ] && a+=(--resolve "$host:80:$RESOLVE_IP")
  risposta="$(curl "${a[@]}" "http://$host/" 2>/dev/null || true)"
  case "$risposta" in
    30[1278]" https://$host"*) ok "http://$host rimanda a https" ;;
    000*) errore "http://$host non risponde sulla porta 80: senza rinvio chi scrive l'indirizzo a mano non arriva" ;;
    *) errore "http://$host non rimanda a https (risposta: ${risposta:-nessuna}): in http il browser non concede microfono e videocamera" ;;
  esac
}

controlla_portale() {
  local codice corpo="$TMP/corpo" versione commit
  sezione "Portale ($URL)"
  codice="$(http_get "$PORTALE_HOST" "$URL/api/health" "$corpo")"
  if [ "$codice" = "200" ] && grep -q '"status":"ok"' "$corpo" 2>/dev/null; then
    versione="$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$corpo")"
    commit="$(sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' "$corpo")"
    ok "/api/health: ok (versione ${versione:-?}${commit:+, commit $commit})"
  elif [ "$codice" = "503" ] && grep -q '"code":"SERVICE_UNAVAILABLE"' "$corpo" 2>/dev/null; then
    errore "/api/health: 503, il portale non raggiunge il database"
  elif [ "$codice" = "502" ] || [ "$codice" = "503" ] || [ "$codice" = "504" ]; then
    errore "/api/health: $codice dal proxy, nessuna replica del portale risponde"
  else
    errore "/api/health: risposta $codice $(head -c 200 "$TMP/curl.err" 2>/dev/null | tr '\n' ' ')"
  fi
  codice="$(http_get "$PORTALE_HOST" "$URL/api/ready" "$corpo")"
  if [ "$codice" = "200" ]; then
    ok "/api/ready: schema del database allineato"
  elif [ "$codice" = "503" ] && grep -q '"not_ready"' "$corpo" 2>/dev/null; then
    errore "/api/ready: 503, schema del database non allineato all'applicazione (migrazioni?)"
  else
    errore "/api/ready: risposta $codice"
  fi
  controlla_stato_componenti
  controlla_grazia_orfane
}

# Opzioni del cluster di questo lancio, da ripetere in un altro comando.
argomenti_cluster() {
  if [ "$NO_CLUSTER" = "si" ]; then printf ' --context <contesto>'; return 0; fi
  [ -n "$OPS_KUBECONFIG" ] && printf ' --kubeconfig %q' "$OPS_KUBECONFIG"
  if [ "$OPS_CONTEXT_IMPLICITO" = "no" ] || [ -z "$OPS_KUBECONFIG" ]; then printf ' --context %q' "$OPS_CONTEXT"; fi
  [ "$OPS_NAMESPACE" = "pa-webinar" ] || printf ' --namespace %q' "$OPS_NAMESPACE"
  [ "$OPS_RELEASE" = "pa-webinar" ] || printf ' --release %q' "$OPS_RELEASE"
  return 0
}

# Un ripristino porta orphanRecordingGraceDays a 0 (le registrazioni orfane
# si elencano, non si cancellano) finché qualcuno non lo rimette: lo si
# ricorda qui, a ogni controllo. Il valore è fra le impostazioni pubbliche.
controlla_grazia_orfane() {
  local corpo="$TMP/impostazioni" codice giorni
  codice="$(http_get "$PORTALE_HOST" "$URL/api/admin/settings" "$corpo")"
  [ "$codice" = "200" ] || return 0
  giorni="$(grep -o '"orphanRecordingGraceDays":[0-9]*' "$corpo" | head -n 1 | cut -d: -f2 || true)"
  [ "$giorni" = "0" ] || return 0
  avviso "orphanRecordingGraceDays è 0: le registrazioni orfane si elencano (Registrazioni video > Orfane) ma non si cancellano mai. Succede dopo un ripristino: controllate le orfane, rimetti i giorni con $RADICE/scripts/restore.sh --reset-orphan-grace <giorni>$(argomenti_cluster)"
}

CHIAVE_ADMIN=""

leggi_chiave() {
  if [ -n "$SECRETS_FILE" ]; then
    if [ "$SECRETS_FILE" = "-" ]; then
      cat > "$TMP/segreti"
      CHIAVE_ADMIN="$(ops_chiave_da_file ADMIN_API_KEY "$TMP/segreti")"
      rm -f "$TMP/segreti"
    else
      CHIAVE_ADMIN="$(ops_chiave_da_file ADMIN_API_KEY "$SECRETS_FILE")"
    fi
    [ -n "$CHIAVE_ADMIN" ] || errore "ADMIN_API_KEY non trovata in ${SECRETS_FILE/#-/standard input}"
  elif [ "$KEYS_FROM_CLUSTER" = "si" ] && [ -n "$SECRET_APP" ]; then
    CHIAVE_ADMIN="$(kc get secret "$SECRET_APP" -o jsonpath='{.data.ADMIN_API_KEY}' 2>/dev/null | base64 -d 2>/dev/null || true)"
    [ -n "$CHIAVE_ADMIN" ] || errore "ADMIN_API_KEY non leggibile dal Secret $SECRET_APP"
  fi
  return 0
}

# JSON minimo: le chiavi sono esadecimali, ma una virgoletta o una barra non
# devono rompere la richiesta.
json_stringa() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '"%s"' "$s"
}

controlla_stato_componenti() {
  local corpo="$TMP/stato" codice cookie_args=() nome stato dettagli riga complessivo
  if [ -n "$CHIAVE_ADMIN" ]; then
    local a=()
    while IFS= read -r -d '' x; do a+=("$x"); done < <(curl_base "$PORTALE_HOST")
    # La chiave passa da standard input (--data-binary @-), non dagli argomenti.
    codice="$(printf '{"key":%s}' "$(json_stringa "$CHIAVE_ADMIN")" | curl "${a[@]}" -o /dev/null -w '%{http_code}' \
      -c "$TMP/cookie" -H 'Content-Type: application/json' --data-binary @- "$URL/api/admin/login" 2>/dev/null || true)"
    case "$codice" in
      200) ok "accesso con la chiave dell'istanza"; cookie_args=(-b "$TMP/cookie") ;;
      401) errore "la chiave dell'istanza è rifiutata (ADMIN_API_KEY diversa da quella del Secret?)" ;;
      429) avviso "troppi accessi con la chiave in un minuto: riprova più tardi" ;;
      *) errore "accesso con la chiave: risposta $codice" ;;
    esac
  fi
  # Subito dopo un aggiornamento i componenti della conferenza risultano fuori
  # servizio per qualche secondo (il front end riparte): si rilegge lo stato
  # finché tornano, fino alla scadenza dei controlli della conferenza.
  local detto="no"
  while :; do
    codice="$(http_get "$PORTALE_HOST" "$URL/api/status" "$corpo" ${cookie_args[@]+"${cookie_args[@]}"})"
    if [ "$codice" != "200" ] || ! conferenza_fuori_servizio "$corpo" || [ "$(date +%s)" -ge "$SCADENZA_CONFERENZA" ]; then
      break
    fi
    if [ "$detto" = "no" ]; then
      info "componenti della conferenza fuori servizio: riprovo fino a ${ATTESA_CONFERENZA}s (ripartono dopo un aggiornamento?)"
      detto="si"
    fi
    sleep 5
  done
  if [ "$codice" != "200" ]; then
    errore "/api/status: risposta $codice"
    return 0
  fi
  if ! grep -q '"components"' "$corpo"; then
    if [ -z "$CHIAVE_ADMIN" ]; then
      info "stato dei componenti non letto: pagina di stato non pubblica e nessuna chiave"
      info "(--secrets-file o --keys-from-cluster)"
    else
      errore "/api/status non riporta i componenti nemmeno con la chiave"
    fi
    return 0
  fi
  complessivo="$(sed -n 's/.*"overall":"\([a-z]*\)".*/\1/p' "$corpo")"
  info "stato complessivo: ${complessivo:-?}"
  while IFS= read -r riga; do
    nome="$(printf '%s' "$riga" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')"
    stato="$(printf '%s' "$riga" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"
    dettagli="$(printf '%s' "$riga" | sed -n 's/.*"details":"\([^"]*\)".*/\1/p')"
    [ -n "$nome" ] || continue
    case "$stato" in
      operational) ok "componente $nome: operativo${dettagli:+ ($dettagli)}" ;;
      degraded) avviso "componente $nome: degradato${dettagli:+ ($dettagli)}" ;;
      outage) errore "componente $nome: fuori servizio${dettagli:+ ($dettagli)}" ;;
      standby) info "componente $nome: in attesa${dettagli:+ ($dettagli)}" ;;
      *)
        if [ "$nome" = "smtp" ]; then
          avviso "componente smtp: non configurato, il portale non invia email"
        else
          info "componente $nome: ${stato:-?}${dettagli:+ ($dettagli)}"
        fi ;;
    esac
  done < <(grep -o '{"name":"[^}]*}' "$corpo")
}

# Vero se lo stato letto dà fuori servizio un componente della conferenza.
conferenza_fuori_servizio() {
  grep -o '{"name":"[^}]*}' "$1" 2>/dev/null \
    | grep -E '"name":"(jitsi|prosody|jicofo|jvb)"' | grep -q '"status":"outage"'
}

controlla_conferenza() {
  local codice corpo="$TMP/config.js" detto="no"
  sezione "Conferenza ($MEET_URL)"
  # Il front end della conferenza riparte a ogni aggiornamento: 502 o
  # connessione rifiutata si riprovano fino alla scadenza.
  while :; do
    codice="$(http_get "$MEET_HOST" "$MEET_URL/config.js" "$corpo")"
    [ "$codice" = "200" ] && grep -q 'hosts' "$corpo" 2>/dev/null && break
    case "$codice" in 000|502|503|504) ;; *) break ;; esac
    [ "$(date +%s)" -lt "$SCADENZA_CONFERENZA" ] || break
    if [ "$detto" = "no" ]; then
      info "config.js: risposta $codice, riprovo fino a ${ATTESA_CONFERENZA}s (la conferenza riparte dopo un aggiornamento?)"
      detto="si"
    fi
    sleep 3
  done
  if [ "$codice" = "200" ] && grep -q 'hosts' "$corpo" 2>/dev/null; then
    ok "config.js della conferenza: 200"
  else
    errore "config.js della conferenza: risposta $codice $(head -c 200 "$TMP/curl.err" 2>/dev/null | tr '\n' ' ')"
  fi
}

# ── Lavori pianificati ──────────────────────────────────────────
# Intervallo in minuti fra due esecuzioni, per le forme di pianificazione che
# il chart usa; vuoto se non si ricava (allora conta solo l'esito).
intervallo_minuti() {
  local m h g mese gs
  case "$1" in
    @hourly) printf 60; return ;;
    @daily|@midnight) printf 1440; return ;;
    @weekly) printf 10080; return ;;
    @*) printf ''; return ;;
  esac
  read -r m h g mese gs <<< "$1"
  if [ "$g" != "*" ] || [ "$mese" != "*" ] || [ "$gs" != "*" ]; then printf ''; return; fi
  if [ "$h" = "*" ]; then
    case "$m" in
      "*") printf 1 ;;
      "*/"*) printf '%s' "${m#*/}" ;;
      *) printf 60 ;;
    esac
  else
    case "$h" in
      "*/"*) printf '%s' "$(( ${h#*/} * 60 ))" ;;
      *) printf 1440 ;;
    esac
  fi
}

# CronJob che il chart rende sospesi apposta: modelli da cui altri componenti,
# o l'operatore, creano Job (kubectl create job --from=cronjob/...). Si
# riconoscono dal componente o dalla pianificazione annuale segnaposto.
cronjob_modello() {
  case "$1" in
    recorder|postprod-worker|backup-tools) return 0 ;;
  esac
  case "$2" in
    @yearly|@annually|"0 0 1 1 *") return 0 ;;
  esac
  return 1
}

controlla_cronjob() {
  local righe lavori nome comp pianif sospeso riuscita creato restore
  local ora intervallo limite eta ult_job esito presenti=" "
  sezione "Lavori pianificati"
  righe="$(kc get cronjob -l "app.kubernetes.io/instance=$OPS_RELEASE" \
    -o jsonpath='{range .items[*]}{.metadata.name}{"|"}{.metadata.labels.app\.kubernetes\.io/component}{"|"}{.spec.schedule}{"|"}{.spec.suspend}{"|"}{.status.lastScheduleTime}{"|"}{.status.lastSuccessfulTime}{"|"}{.metadata.creationTimestamp}{"|"}{.metadata.annotations.pa-webinar/restore-suspend}{"\n"}{end}' 2>/dev/null || true)"
  # Ultimo Job di ogni CronJob: nome del CronJob, creazione, esito.
  lavori="$(kc get jobs -o jsonpath='{range .items[*]}{.metadata.ownerReferences[0].name}{"|"}{.metadata.creationTimestamp}{"|"}{range .status.conditions[?(@.status=="True")]}{.type}{" "}{end}{"\n"}{end}' 2>/dev/null \
    | sort -t'|' -k1,1 -k2,2 | awk -F'|' '{ultimo[$1] = $3} END {for (c in ultimo) print c "|" ultimo[c]}')"
  ora="$(date -u +%s)"
  while IFS='|' read -r nome comp pianif sospeso _ riuscita creato restore; do
    [ -n "$nome" ] || continue
    presenti+="$comp "
    if [ "$sospeso" = "true" ]; then
      if [ -n "$restore" ]; then
        errore "$nome: sospeso da un ripristino non concluso (scripts/restore.sh --resume)"
      elif cronjob_modello "$comp" "$pianif"; then
        : # modello per Job creati da altri o a mano: sospeso per scelta
      else
        avviso "$nome: sospeso"
      fi
      continue
    fi
    ult_job="$(printf '%s\n' "$lavori" | awk -F'|' -v n="$nome" '$1 == n {print $2}')"
    intervallo="$(intervallo_minuti "$pianif")"
    if [ -z "$riuscita" ]; then
      eta=$(( (ora - $(ops_epoca "$creato" || echo "$ora")) / 60 ))
      if [ -n "$intervallo" ] && [ "$eta" -gt $(( 2 * intervallo + 5 )) ]; then
        errore "$nome ($pianif): nessuna esecuzione riuscita da quando esiste (${eta} min)${ult_job:+, ultimo esito: $ult_job}"
      elif [[ "$ult_job" == *Failed* ]]; then
        avviso "$nome ($pianif): ancora nessuna esecuzione riuscita, l'ultima è fallita"
      else
        info "$nome ($pianif): non ancora eseguito"
      fi
      continue
    fi
    eta=$(( (ora - $(ops_epoca "$riuscita" || echo "$ora")) / 60 ))
    if [ -n "$intervallo" ]; then
      limite=$(( 2 * intervallo + 5 ))
      if [ "$eta" -gt "$limite" ]; then
        errore "$nome ($pianif): ultima esecuzione riuscita $eta min fa, oltre $limite${ult_job:+ (ultimo esito: $ult_job)}"
        continue
      fi
    fi
    esito="ultima esecuzione riuscita $eta min fa"
    if [[ "$ult_job" == *Failed* ]]; then
      avviso "$nome ($pianif): $esito, ma l'ultima è fallita"
    else
      ok "$nome ($pianif): $esito"
    fi
  done <<< "$righe"
  if [[ "$presenti" != *" cronjob-lifecycle "* ]] && [[ "$presenti" != *" jvb-scaler "* ]]; then
    errore "manca il lavoro del ciclo di vita (lifecycle o jvb-scaler): gli eventi non si aprono e non si chiudono da soli"
  fi
  [[ "$presenti" == *" cronjob-email-outbox "* ]] || errore "manca il lavoro email-outbox: nessuna email parte"
  [[ "$presenti" == *" cronjob-cleanup "* ]] || errore "manca il lavoro cleanup: i dati personali non vengono cancellati alla scadenza"
  [[ "$presenti" == *" cronjob-reminders "* ]] || avviso "manca il lavoro reminders: nessun promemoria parte"
  return 0
}

# ── Database ────────────────────────────────────────────────────
controlla_database() {
  local riga falliti falliti_24h in_ritardo disco uso
  sezione "Database"
  POD_PG="$(ops_pod_postgres)"
  if [ -z "$POD_PG" ]; then
    if kc get statefulset -l "app.kubernetes.io/instance=$OPS_RELEASE,app.kubernetes.io/name=postgresql" -o name 2>/dev/null | grep -q .; then
      errore "PostgreSQL del chart presente ma nessun pod in esecuzione"
    else
      info "database esterno al chart: coda delle email e disco non controllati da qui"
    fi
    return 0
  fi
  if ! riga="$(ops_pg_query "$POD_PG" "SELECT count(*) FILTER (WHERE status = 'FAILED'),
      count(*) FILTER (WHERE status = 'FAILED' AND updated_at > now() - interval '24 hours'),
      count(*) FILTER (WHERE status = 'PENDING' AND next_attempt_at < now() - interval '$OUTBOX_MAX_AGE minutes')
      FROM email_outbox" 2>"$TMP/pgerr")"; then
    errore "coda delle email non leggibile: $(head -c 200 "$TMP/pgerr" | tr '\n' ' ')"
  else
    IFS='|' read -r falliti falliti_24h in_ritardo <<< "$riga"
    if [ "${in_ritardo:-0}" -gt 0 ]; then
      errore "coda delle email: $in_ritardo in attesa da oltre $OUTBOX_MAX_AGE minuti (email-outbox non gira, o SMTP non risponde)"
    else
      ok "coda delle email: nessuna in ritardo"
    fi
    if [ "${falliti_24h:-0}" -gt 0 ]; then
      avviso "coda delle email: $falliti_24h fallite definitivamente nelle ultime 24 ore ($falliti in tutto)"
    elif [ "${falliti:-0}" -gt 0 ]; then
      info "coda delle email: $falliti fallite in passato, nessuna nelle ultime 24 ore"
    fi
  fi
  # Il volume del database: su k3s (local-path) è il disco del nodo.
  disco="$(kc exec "$POD_PG" -c postgresql -- df -P /bitnami/postgresql 2>/dev/null | awk 'NR == 2 {print $5 " " $4}' || true)"
  if [ -z "$disco" ]; then
    avviso "spazio del volume del database non leggibile"
    return 0
  fi
  uso="${disco%%%*}"
  local liberi_gb
  liberi_gb="$(awk -v k="${disco#* }" 'BEGIN {printf "%.1f", k / 1048576}')"
  if [ "$uso" -ge "$DISK_FAIL" ]; then
    errore "volume del database pieno al $uso% (liberi $liberi_gb GB)"
  elif [ "$uso" -ge "$DISK_WARN" ]; then
    avviso "volume del database pieno al $uso% (liberi $liberi_gb GB)"
  else
    ok "volume del database: usato $uso%, liberi $liberi_gb GB"
  fi
}

# ── Chiamata di prova ───────────────────────────────────────────
controlla_chiamata() {
  sezione "Chiamata di prova"
  if [ -z "$CHIAVE_ADMIN" ]; then
    errore "--call richiede la chiave dell'istanza (--secrets-file o --keys-from-cluster)"
    return 0
  fi
  if [ -z "$MEET_URL" ]; then
    errore "--call richiede l'indirizzo della conferenza (--meet-url)"
    return 0
  fi
  local a=(--url "$URL" --meet-url "$MEET_URL" --timeout "$CALL_TIMEOUT")
  [ -n "$RESOLVE_IP" ] && a+=(--resolve "$RESOLVE_IP")
  [ -n "$BROWSER" ] && a+=(--browser "$BROWSER")
  # I certificati si sono già verificati qui sopra: con un'autorità privata il
  # browser headless non la conosce, e la prova riguarda i media, non il TLS.
  if [ -n "$CA_FILE" ] || [ "$INSECURE" = "si" ]; then a+=(--ignore-cert-errors); fi
  local out codice=0
  out="$(printf '%s\n' "$CHIAVE_ADMIN" | node "$RADICE/scripts/verify-call.mjs" "${a[@]}" 2>&1)" || codice=$?
  while IFS= read -r riga; do
    case "$riga" in
      "ok "*) ok "${riga#ok }" ;;
      "AVVISO "*) avviso "${riga#AVVISO }" ;;
      "ERRORE "*) errore "${riga#ERRORE }" ;;
      "") ;;
      *) info "$riga" ;;
    esac
  done <<< "$out"
  if [ "$codice" -ne 0 ] && ! printf '%s\n' "$out" | grep -q '^ERRORE '; then
    errore "prova di chiamata terminata con codice $codice"
  fi
}

# ── Esecuzione ──────────────────────────────────────────────────
if [ "$NO_CLUSTER" = "no" ]; then
  controlla_cluster || true
elif [ "$QUIET" = "no" ]; then
  intestazione
fi
ricava_indirizzi
leggi_chiave

SCADENZA_CONFERENZA=$(( $(date +%s) + ATTESA_CONFERENZA ))
if [ -z "$URL" ]; then
  errore "indirizzo del portale sconosciuto: indica --url"
else
  sezione "Certificati"
  controlla_certificato "$PORTALE_HOST"
  controlla_rinvio_https "$PORTALE_HOST"
  if [ -n "$MEET_HOST" ]; then
    controlla_certificato "$MEET_HOST"
    controlla_rinvio_https "$MEET_HOST"
  else
    avviso "indirizzo della conferenza sconosciuto (--meet-url): conferenza non controllata"
  fi
  controlla_portale
  [ -n "$MEET_URL" ] && controlla_conferenza
fi

if [ "$NO_CLUSTER" = "no" ] && [ -n "$DEPLOYMENT" ]; then
  controlla_cronjob
  controlla_database
fi

if [ "$CALL" = "si" ] && [ -n "$URL" ]; then
  controlla_chiamata
fi

CHIAVE_ADMIN=""

esito=0
[ "$N_ERRORI" -gt 0 ] && esito=1
[ "$STRICT" = "si" ] && [ "$N_AVVISI" -gt 0 ] && esito=1
if [ "$QUIET" = "no" ] || [ "$esito" -ne 0 ] || [ "$N_AVVISI" -gt 0 ]; then
  printf '\nEsito: %d controlli ok, %d avvisi, %d errori.\n' "$N_OK" "$N_AVVISI" "$N_ERRORI"
fi
exit "$esito"
