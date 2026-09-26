#!/usr/bin/env bash
#
# Object storage S3 per PA Webinar su un solo nodo k3s: Garage in un
# Deployment con un volume local-path, i due bucket del portale (file e
# registrazioni), una chiave per il portale, le regole CORS per l'origine del
# portale e il nome pubblico https://<host>, servito da Traefik con lo stesso
# tipo di certificato del portale. Browser e pod usano quel nome: le
# registrazioni si riproducono e i video si caricano direttamente dal
# browser, che deve raggiungere lo storage in HTTPS.
#
# Scrive nella cartella di stato (fuori dal repository, file 0600):
#   storage.env          le chiavi del portale, quattro righe KEY=VALUE da
#                        unire al Secret dell'applicazione; nate una volta,
#                        mai sovrascritte
#   garage.env           i segreti interni di Garage; come sopra
#   values-storage.yaml  gli indirizzi per il chart, riscritto a ogni lancio,
#                        da passare a helm dopo examples/values-k3s-storage.yaml
# Se il Secret dell'applicazione esiste già, ci aggiunge da sé le quattro
# chiavi. Se storage.env o garage.env mancano ma il cluster ha già le chiavi,
# le ricostruisce da lì, senza cambiarle.
#
# Non lancia helm. Dopo, dalla radice del repository:
#   helm upgrade --install pa-webinar ./infra/helm/pa-webinar -n pa-webinar \
#     -f infra/helm/pa-webinar/examples/values-simple.yaml \
#     -f infra/helm/pa-webinar/examples/values-k3s.yaml \
#     -f infra/helm/pa-webinar/examples/values-k3s-storage.yaml \
#     -f <file del sito> -f <cartella di stato>/values-storage.yaml ...
#
# Uso:  ./storage.sh --host s3.<dominio> --portal-url https://<portale> \
#         (--tls-secret NOME | --cert-resolver NOME) [opzioni]   (--help)
# Da:   la postazione con il kubeconfig del cluster, o il server stesso.
#       Servono kubectl, curl 7.75 o successivo, openssl.

set -euo pipefail

PREFISSO="storage"
# shellcheck source=common.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

# Garage v2.1.0, fissato per digest (indice multi-architettura).
IMMAGINE="docker.io/dxflrs/garage@sha256:4c9b34c113e61358466e83fd6e7d66e6d18657ede14b776eb78a93ee8da7cf6a"
# Gli stessi valori di examples/values-k3s-storage.yaml: validate-chart.sh
# controlla che coincidano.
REGIONE="garage"
BUCKET_FILE="pa-webinar-files"
BUCKET_REGISTRAZIONI="pa-webinar-recordings"
# Upload a più parti lasciati a metà: via dopo tre giorni.
GIORNI_UPLOAD_INCOMPLETI=3

URL_PORTALE=""
SECRET_APP=""
SOLO_CONTROLLO="no"
CA_CONFIGMAP=""
DIMENSIONE="50Gi"
CLASSE="local-path"

uso() {
  cat <<'FINE'
Uso: ./storage.sh --host s3.<dominio> --portal-url https://<portale> \
       (--tls-secret NOME | --cert-resolver NOME) [opzioni]

Installa Garage (object storage S3) nel namespace della release, crea i
bucket e la chiave del portale, le regole CORS e il nome pubblico
https://<host>. Non lancia helm: stampa i file di valori da aggiungere.

Storage
  --portal-url URL         origine del portale per le regole CORS
                           (obbligatorio, per esempio https://webinar.example.com)
  --app-secret NOME        Secret dell'applicazione a cui aggiungere le chiavi,
                           se esiste (predefinito: <release>-secrets)
  --ca-configmap NOME      ConfigMap con ca.crt da far fidare al portale
                           (app.extraCaCerts), per una CA privata; non serve se
                           il file del sito lo imposta già
  --size DIMENSIONE        volume e capacità di Garage, in Gi o Ti
                           (predefinito: 50Gi)
  --storage-class NOME     classe del volume (predefinito: local-path)
  --check                  solo il controllo, dopo helm upgrade: il nome
                           pubblico da fuori (CORS) e da dentro il pod del
                           portale (DNS, certificato, NetworkPolicy), e le
                           impostazioni dello storage arrivate al portale.
                           Vuole --host, --portal-url e il kubeconfig

FINE
  uso_opzioni_comuni
  cat <<'FINE'

Esempio con il certificato di una CA privata e il DNS non ancora pronto:
  ./storage.sh --kubeconfig ~/.config/pa-webinar/k3s/pa-webinar/kubeconfig \
    --host s3.webinar.example.com --portal-url https://webinar.example.com \
    --tls-secret pa-webinar-storage-tls --resolve 203.0.113.10 --cacert ca.crt
FINE
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) uso; exit 0 ;;
    --portal-url) URL_PORTALE="${2:?manca il valore di --portal-url}"; shift 2 ;;
    --app-secret) SECRET_APP="${2:?manca il valore di --app-secret}"; shift 2 ;;
    --ca-configmap) CA_CONFIGMAP="${2:?manca il valore di --ca-configmap}"; shift 2 ;;
    --size) DIMENSIONE="${2:?manca il valore di --size}"; shift 2 ;;
    --storage-class) CLASSE="${2:?manca il valore di --storage-class}"; shift 2 ;;
    --check) SOLO_CONTROLLO="si"; shift ;;
    *)
      opzione_comune "$@" || fine "opzione sconosciuta: $1 (vedi --help)"
      shift "$CONSUMATI" ;;
  esac
done

if [ "$SOLO_IMMAGINI" = "si" ]; then
  printf '%s\n' "$IMMAGINE"
  exit 0
fi

# Nel solo controllo il certificato non si sceglie: si usa quello già servito.
if [ "$SOLO_CONTROLLO" = "si" ] && [ -z "$TLS_SECRET" ] && [ -z "$CERT_RESOLVER" ]; then
  CERT_RESOLVER="-"
fi
controlla_opzioni_comuni
[ -n "$URL_PORTALE" ] || fine "manca --portal-url (l'indirizzo del portale, per le regole CORS)"
URL_PORTALE="${URL_PORTALE%/}"
nome_dns_valido "${URL_PORTALE#https://}" || fine "--portal-url vuole https://<nome del portale>, senza percorso: $URL_PORTALE"
[ "https://${URL_PORTALE#https://}" = "$URL_PORTALE" ] || fine "--portal-url deve iniziare con https://"
[ -n "$SECRET_APP" ] || SECRET_APP="$RELEASE-secrets"
nome_k8s_valido "$SECRET_APP" || fine "nome del Secret non valido: $SECRET_APP"
[ -z "$CA_CONFIGMAP" ] || nome_k8s_valido "$CA_CONFIGMAP" || fine "nome del ConfigMap non valido: $CA_CONFIGMAP"
case "$DIMENSIONE" in
  [1-9]*Gi|[1-9]*Ti) case "${DIMENSIONE%?i}" in *[!0-9]*) fine "--size vuole un numero seguito da Gi o Ti, per esempio 50Gi" ;; esac ;;
  *) fine "--size vuole un numero seguito da Gi o Ti, per esempio 50Gi" ;;
esac
nome_k8s_valido "$CLASSE" || fine "classe di storage non valida: $CLASSE"

richiedi_comandi kubectl curl openssl base64 od
aiuto_curl="$(curl --help all 2>/dev/null || true)"
case "$aiuto_curl" in
  *--aws-sigv4*) ;;
  *) fine "curl non firma le richieste S3 (--aws-sigv4): serve curl 7.75 o successivo" ;;
esac
unset aiuto_curl

NOME="$RELEASE-garage"
LAVORO="$(mktemp -d)"
chmod 700 "$LAVORO"
ERR="$LAVORO/garage.err"
PF_PID=""
PERMESSI_SETUP="no"

pulizia() {
  local stato=$?
  if [ "$PERMESSI_SETUP" = "si" ]; then
    togli_permessi_setup || true
  fi
  if [ -n "$PF_PID" ]; then
    kill "$PF_PID" 2>/dev/null || true
    wait "$PF_PID" 2>/dev/null || true
  fi
  rm -rf "$LAVORO"
  exit "$stato"
}
trap pulizia EXIT

# La riga di comando di Garage, dentro il pod. I suoi messaggi informativi
# vanno in un file e si mostrano solo se qualcosa fallisce.
garage() { kn exec "deploy/$NOME" -c garage -- /garage "$@" 2>>"$ERR"; }
fallito() { fine "$1$( [ -s "$ERR" ] && printf ' (%s)' "$(grep -v 'INFO' "$ERR" | tail -n 2 | tr '\n' ' ')" )"; }

# ── Controlli sul nome pubblico ────────────────────────────────
# Da fuori, come un browser: il preflight CORS dall'origine del portale.
controlla_preflight() {
  argomenti_curl_host
  local intestazioni
  for _ in $(seq 1 24); do
    intestazioni="$(curl "${CURL_HOST[@]}" -o /dev/null -D - -X OPTIONS \
      -H "Origin: $URL_PORTALE" -H 'Access-Control-Request-Method: PUT' \
      -H 'Access-Control-Request-Headers: content-type' \
      "https://$HOST/$BUCKET_REGISTRAZIONI/pa-webinar-check" 2>"$LAVORO/check.err" || true)"
    intestazioni="$(tr -d '\r' <<<"$intestazioni")"
    if grep -Fxqi "access-control-allow-origin: $URL_PORTALE" <<<"$intestazioni"; then
      return 0
    fi
    sleep 5
  done
  fine "https://$HOST non risponde come lo storage ($(tr '\n' ' ' < "$LAVORO/check.err" | cut -c1-200)). Controlla il DNS di $HOST (o usa --resolve), il certificato (--cacert per una CA privata) e kubectl -n $NAMESPACE get ingress $NOME"
}

# Da dentro il pod del portale, che firma gli URL e carica i file: il nome si
# risolve nel cluster, il certificato è fidato (app.extraCaCerts per una CA
# privata) e la NetworkPolicy lascia passare. Poi le impostazioni: indirizzo
# dello storage e chiavi presenti (solo se ci sono, mai i valori).
controlla_dal_portale() {
  local portale risposta
  portale="$(kn get deploy -l "app.kubernetes.io/instance=$RELEASE,app.kubernetes.io/name=pa-webinar,!app.kubernetes.io/component" -o name 2>/dev/null | head -n 1)"
  [ -n "$portale" ] || fine "il portale della release $RELEASE non c'è nel namespace $NAMESPACE: lancia --check dopo helm upgrade"
  # shellcheck disable=SC2016  # lo script è per node, le variabili sono sue
  risposta="$(kn exec "$portale" -- node -e '
const url = process.argv[1];
const env = ["STORAGE_FILES_S3_ENDPOINT", "RECORDING_S3_ENDPOINT"].map((k) => k + "=" + (process.env[k] || ""));
const chiavi = ["STORAGE_FILES_S3_ACCESS_KEY_ID", "STORAGE_FILES_S3_SECRET_ACCESS_KEY", "RECORDING_S3_ACCESS_KEY_ID", "RECORDING_S3_SECRET_ACCESS_KEY"].filter((k) => !process.env[k]);
fetch(url, { method: "GET", signal: AbortSignal.timeout(10000) })
  .then((r) => console.log(["HTTP=" + r.status, ...env, "MANCANTI=" + chiavi.join(",")].join("\n")))
  .catch((e) => console.log(["ERRORE=" + ((e.cause && (e.cause.code || e.cause.message)) || e.message), ...env, "MANCANTI=" + chiavi.join(",")].join("\n")));
' "https://$HOST/$BUCKET_FILE/pa-webinar-check" 2>/dev/null || true)"
  local esito
  esito="$(sed -n 's/^ERRORE=//p' <<<"$risposta")"
  if [ -z "$risposta" ]; then
    fine "impossibile eseguire il controllo nel pod del portale ($portale)"
  elif [ -n "$esito" ]; then
    fine "il portale non raggiunge https://$HOST ($esito): nel cluster il nome deve risolversi verso Traefik, e con una CA privata il portale deve fidarsene (app.extraCaCerts, --ca-configmap)"
  fi
  log "il portale raggiunge https://$HOST (HTTP $(sed -n 's/^HTTP=//p' <<<"$risposta") da Garage, senza credenziali)"
  local k
  for k in STORAGE_FILES_S3_ENDPOINT RECORDING_S3_ENDPOINT; do
    [ "$(sed -n "s/^$k=//p" <<<"$risposta")" = "https://$HOST" ] \
      || fine "nel portale $k non è https://$HOST: helm upgrade con examples/values-k3s-storage.yaml e values-storage.yaml, poi il portale riparte da solo"
  done
  esito="$(sed -n 's/^MANCANTI=//p' <<<"$risposta")"
  [ -z "$esito" ] || fine "nel portale mancano le chiavi $esito: vanno nel Secret dell'applicazione (storage.env), poi kubectl -n $NAMESPACE rollout restart ${portale}"
  log "il portale ha l'indirizzo dello storage e le quattro chiavi"
}

if [ "$SOLO_CONTROLLO" = "si" ]; then
  controlla_cluster
  controlla_preflight
  log "da fuori: https://$HOST risponde con le regole CORS per $URL_PORTALE"
  controlla_dal_portale
  exit 0
fi

prepara_stato
log "cartella di stato: $STATO"
controlla_cluster
# scripts/backup.sh e scripts/restore.sh con --include-storage fermano Garage
# e lo annotano con le repliche da rimettere: riapplicare qui il Deployment
# lo riaccenderebbe mentre il volume si copia o si sostituisce.
if [ -n "$(kn get deploy "$NOME" -o 'jsonpath={.metadata.annotations.pa-webinar/restore-replicas}' 2>/dev/null || true)" ]; then
  fine "Garage ($NOME) è fermo per un backup o un ripristino (scripts/backup.sh o restore.sh con --include-storage). Aspetta che finisca; se è stato interrotto, scripts/restore.sh --resume --yes --kubeconfig <kubeconfig>, poi rilancia"
fi
controlla_secret_tls
if [ -n "$CA_CONFIGMAP" ]; then
  kn get configmap "$CA_CONFIGMAP" >/dev/null 2>&1 || fine "il ConfigMap $CA_CONFIGMAP non esiste nel namespace $NAMESPACE"
fi

# ── Segreti, generati una volta ────────────────────────────────
FILE_GARAGE="$STATO/garage.env"
FILE_STORAGE="$STATO/storage.env"

prepara_segreti_garage() {
  if [ -f "$FILE_GARAGE" ]; then
    proteggi_file "$FILE_GARAGE"
  else
    local rpc admin metriche id_setup segreto_setup
    rpc="$(chiave_secret "$NOME" GARAGE_RPC_SECRET)"
    admin="$(chiave_secret "$NOME" GARAGE_ADMIN_TOKEN)"
    metriche="$(chiave_secret "$NOME" GARAGE_METRICS_TOKEN)"
    id_setup="$(chiave_secret "$NOME-setup" SETUP_ACCESS_KEY_ID)"
    segreto_setup="$(chiave_secret "$NOME-setup" SETUP_SECRET_ACCESS_KEY)"
    if [ -n "$rpc" ] && [ -n "$admin" ]; then
      log "garage.env mancante: lo ricostruisco dai Secret $NOME e $NOME-setup"
    else
      rpc="$(esadecimale 32)"; admin="$(esadecimale 32)"; metriche="$(esadecimale 32)"
    fi
    [ -n "$metriche" ] || metriche="$(esadecimale 32)"
    if [ -z "$id_setup" ] || [ -z "$segreto_setup" ]; then
      id_setup="GK$(esadecimale 12)"; segreto_setup="$(esadecimale 32)"
    fi
    ( umask 077
      {
        echo "# Segreti interni di Garage ($NOME). Generati da storage.sh: non modificarli."
        echo "GARAGE_RPC_SECRET=$rpc"
        echo "GARAGE_ADMIN_TOKEN=$admin"
        echo "GARAGE_METRICS_TOKEN=$metriche"
        echo "SETUP_ACCESS_KEY_ID=$id_setup"
        echo "SETUP_SECRET_ACCESS_KEY=$segreto_setup"
      } > "$FILE_GARAGE" )
  fi
  local k
  for k in GARAGE_RPC_SECRET GARAGE_ADMIN_TOKEN GARAGE_METRICS_TOKEN SETUP_ACCESS_KEY_ID SETUP_SECRET_ACCESS_KEY; do
    [ -n "$(valore_env "$FILE_GARAGE" "$k")" ] || fine "manca $k in $FILE_GARAGE"
  done
}

prepara_chiavi_portale() {
  local chiavi="STORAGE_FILES_S3_ACCESS_KEY_ID STORAGE_FILES_S3_SECRET_ACCESS_KEY RECORDING_S3_ACCESS_KEY_ID RECORDING_S3_SECRET_ACCESS_KEY"
  if [ -f "$FILE_STORAGE" ]; then
    proteggi_file "$FILE_STORAGE"
  else
    local id segreto
    id="$(chiave_secret "$SECRET_APP" STORAGE_FILES_S3_ACCESS_KEY_ID)"
    segreto="$(chiave_secret "$SECRET_APP" STORAGE_FILES_S3_SECRET_ACCESS_KEY)"
    if [ -n "$id" ] && [ -n "$segreto" ]; then
      log "storage.env mancante: lo ricostruisco dal Secret $SECRET_APP"
    else
      id="GK$(esadecimale 12)"; segreto="$(esadecimale 32)"
    fi
    # Una chiave sola per i due domini: stessi bucket di Garage, stessi
    # permessi. Il portale legge comunque una coppia per dominio.
    ( umask 077
      {
        echo "STORAGE_FILES_S3_ACCESS_KEY_ID=$id"
        echo "STORAGE_FILES_S3_SECRET_ACCESS_KEY=$segreto"
        echo "RECORDING_S3_ACCESS_KEY_ID=$id"
        echo "RECORDING_S3_SECRET_ACCESS_KEY=$segreto"
      } > "$FILE_STORAGE" )
  fi
  local k
  for k in $chiavi; do
    [ -n "$(valore_env "$FILE_STORAGE" "$k")" ] || fine "manca $k in $FILE_STORAGE"
  done
  [ "$(valore_env "$FILE_STORAGE" STORAGE_FILES_S3_ACCESS_KEY_ID)" = "$(valore_env "$FILE_STORAGE" RECORDING_S3_ACCESS_KEY_ID)" ] \
    || fine "$FILE_STORAGE ha due chiavi diverse per file e registrazioni: storage.sh ne gestisce una sola"
}

prepara_segreti_garage
prepara_chiavi_portale
ID_APP="$(valore_env "$FILE_STORAGE" STORAGE_FILES_S3_ACCESS_KEY_ID)"
ID_SETUP="$(valore_env "$FILE_GARAGE" SETUP_ACCESS_KEY_ID)"

# ── Garage nel cluster ─────────────────────────────────────────
# Due Secret: quello che il pod di Garage legge, e quello della chiave di
# configurazione, che nessun pod monta e serve solo a ritrovarla se la
# cartella di stato va persa.
grep '^GARAGE_' "$FILE_GARAGE" > "$LAVORO/garage-secret.env"
applica_secret_da_file "$NOME" "$LAVORO/garage-secret.env"
HASH="$(cat "$MANIFESTI/garage.yaml" "$LAVORO/garage-secret.env" | openssl dgst -sha256 | sed 's/^.* //')"
grep '^SETUP_' "$FILE_GARAGE" > "$LAVORO/garage-secret.env"
applica_secret_da_file "$NOME-setup" "$LAVORO/garage-secret.env"
rm -f "$LAVORO/garage-secret.env"

# Un PVC esistente non si ridimensiona da qui: local-path non lo sa fare, e
# la dimensione non è comunque un limite.
DIMENSIONE_APPLICATA="$DIMENSIONE"
esistente="$(kn get pvc "$NOME-data" -o 'jsonpath={.spec.resources.requests.storage}' 2>/dev/null || true)"
if [ -n "$esistente" ] && [ "$esistente" != "$DIMENSIONE" ]; then
  log "il volume $NOME-data esiste già con $esistente: lo lascio così"
  DIMENSIONE_APPLICATA="$esistente"
fi

applica_modello "$MANIFESTI/garage.yaml" \
  "NAME=$NOME" "RELEASE=$RELEASE" "IMAGE=$IMMAGINE" \
  "SIZE=$DIMENSIONE_APPLICATA" "STORAGE_CLASS=$CLASSE" "CONFIG_HASH=$HASH"
if [ -n "$TLS_SECRET" ]; then
  applica_modello "$MANIFESTI/garage-ingress.yaml" \
    "NAME=$NOME" "RELEASE=$RELEASE" "HOST=$HOST" "TLS_SECRET=$TLS_SECRET"
else
  applica_modello "$MANIFESTI/garage-ingress-acme.yaml" \
    "NAME=$NOME" "RELEASE=$RELEASE" "HOST=$HOST" "CERT_RESOLVER=$CERT_RESOLVER"
fi
log "Garage applicato ($NOME), attendo il pod"
if ! kn rollout status "deploy/$NOME" --timeout=600s >/dev/null 2>&1; then
  kn get pods -l "app.kubernetes.io/name=garage,app.kubernetes.io/instance=$RELEASE" >&2 || true
  fine "Garage non è pronto dopo 10 minuti: guarda kubectl -n $NAMESPACE describe pod -l app.kubernetes.io/name=garage (immagine non prelevabile? volume in Pending?)"
fi

# ── Accesso locale alle API di Garage ──────────────────────────
kn port-forward "deploy/$NOME" :3900 :3903 >"$LAVORO/port-forward.log" 2>&1 &
PF_PID=$!
PORTA_S3=""
PORTA_ADMIN=""
for _ in $(seq 1 30); do
  PORTA_S3="$(sed -n 's/^Forwarding from 127\.0\.0\.1:\([0-9][0-9]*\) -> 3900$/\1/p' "$LAVORO/port-forward.log" | head -n 1)"
  PORTA_ADMIN="$(sed -n 's/^Forwarding from 127\.0\.0\.1:\([0-9][0-9]*\) -> 3903$/\1/p' "$LAVORO/port-forward.log" | head -n 1)"
  [ -n "$PORTA_S3" ] && [ -n "$PORTA_ADMIN" ] && break
  kill -0 "$PF_PID" 2>/dev/null || fine "kubectl port-forward non è partito: $(tail -n 2 "$LAVORO/port-forward.log" | tr '\n' ' ')"
  sleep 1
done
[ -n "$PORTA_S3" ] && [ -n "$PORTA_ADMIN" ] || fine "kubectl port-forward verso $NOME non risponde"

( umask 077; printf 'Authorization: Bearer %s\n' "$(valore_env "$FILE_GARAGE" GARAGE_ADMIN_TOKEN)" > "$LAVORO/admin.hdr" )
( umask 077; printf 'user = "%s:%s"\n' "$ID_SETUP" "$(valore_env "$FILE_GARAGE" SETUP_SECRET_ACCESS_KEY)" > "$LAVORO/setup.curlrc" )
( umask 077; printf 'user = "%s:%s"\n' "$ID_APP" "$(valore_env "$FILE_STORAGE" STORAGE_FILES_S3_SECRET_ACCESS_KEY)" > "$LAVORO/app.curlrc" )

# ── Layout: un nodo, applicato una volta ───────────────────────
layout="$(garage layout show)" || fallito "Garage non risponde alla riga di comando"
if grep -q 'Current cluster layout version: 0$' <<<"$layout"; then
  id_nodo="$(garage node id -q | cut -d@ -f1)"
  [ -n "$id_nodo" ] || fallito "identificativo del nodo Garage non trovato"
  garage layout assign -z dc1 -c "${DIMENSIONE_APPLICATA}B" "$id_nodo" >/dev/null || fallito "assegnazione del layout non riuscita"
  garage layout apply --version 1 >/dev/null || fallito "applicazione del layout non riuscita"
  log "layout applicato: un nodo, capacità $DIMENSIONE_APPLICATA"
fi
for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORTA_ADMIN/health" || true)" = "200" ] && break
  sleep 2
done
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORTA_ADMIN/health" || true)" = "200" ] \
  || fine "Garage non è operativo dopo il layout (http://127.0.0.1:$PORTA_ADMIN/health)"

# ── Chiavi: importate con i valori della cartella di stato ─────
# L'API di amministrazione riceve la chiave nel corpo, da un file: sulla riga
# di comando di Garage finirebbe nell'elenco dei processi.
importa_chiave() {
  local id="$1" segreto="$2" nome="$3" codice
  ( umask 077; printf '{"accessKeyId":"%s","secretAccessKey":"%s","name":"%s"}' "$id" "$segreto" "$nome" > "$LAVORO/chiave.json" )
  codice="$(curl -sS -o "$LAVORO/risposta.json" -w '%{http_code}' -H @"$LAVORO/admin.hdr" \
    -H 'Content-Type: application/json' --data @"$LAVORO/chiave.json" \
    "http://127.0.0.1:$PORTA_ADMIN/v2/ImportKey" || true)"
  rm -f "$LAVORO/chiave.json" "$LAVORO/risposta.json"
  case "$codice" in
    200) log "chiave $nome creata" ;;
    409) garage key info "$id" >/dev/null || fallito "Garage rifiuta la chiave $nome ($id): esisteva ed è stata cancellata. Togli la riga da $FILE_STORAGE o $FILE_GARAGE e rilancia" ;;
    *) fine "Garage ha rifiutato la chiave $nome (HTTP $codice)" ;;
  esac
}
importa_chiave "$ID_APP" "$(valore_env "$FILE_STORAGE" STORAGE_FILES_S3_SECRET_ACCESS_KEY)" "$RELEASE-app"
importa_chiave "$ID_SETUP" "$(valore_env "$FILE_GARAGE" SETUP_SECRET_ACCESS_KEY)" "$RELEASE-setup"

# ── Bucket ─────────────────────────────────────────────────────
for bucket in "$BUCKET_FILE" "$BUCKET_REGISTRAZIONI"; do
  if ! garage bucket info "$bucket" >/dev/null; then
    garage bucket create "$bucket" >/dev/null || fallito "creazione del bucket $bucket non riuscita"
    log "bucket $bucket creato"
  fi
  # Lettura e scrittura, non proprietario: il portale non cambia le regole
  # dei bucket.
  garage bucket allow --read --write "$bucket" --key "$ID_APP" >/dev/null \
    || fallito "permessi del portale su $bucket non assegnati"
done

# ── CORS e ciclo di vita, con la chiave di configurazione ──────
# La chiave di configurazione ha i permessi solo durante il lancio: le regole
# dei bucket le cambia chi è proprietario, e il ciclo di vita chiede anche
# lettura e scrittura. All'uscita, anche per errore, li perde.
togli_permessi_setup() {
  local b
  for b in "$BUCKET_FILE" "$BUCKET_REGISTRAZIONI"; do
    garage bucket deny --read --write --owner "$b" --key "$ID_SETUP" >/dev/null || return 1
  done
  PERMESSI_SETUP="no"
}
PERMESSI_SETUP="si"
for bucket in "$BUCKET_FILE" "$BUCKET_REGISTRAZIONI"; do
  garage bucket allow --read --write --owner "$bucket" --key "$ID_SETUP" >/dev/null \
    || fallito "permessi di configurazione su $bucket non assegnati"
done

# PUT dai browser (video caricati dall'amministrazione, anche a parti) e
# lettura; ETag esposto per i client che lo leggono.
cat > "$LAVORO/cors.xml" <<FINE
<CORSConfiguration><CORSRule><AllowedOrigin>$URL_PORTALE</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>
FINE
cat > "$LAVORO/lifecycle.xml" <<FINE
<LifecycleConfiguration><Rule><ID>abort-incomplete-multipart</ID><Status>Enabled</Status><Filter></Filter><AbortIncompleteMultipartUpload><DaysAfterInitiation>$GIORNI_UPLOAD_INCOMPLETI</DaysAfterInitiation></AbortIncompleteMultipartUpload></Rule></LifecycleConfiguration>
FINE

# Impronta SHA-256 del corpo di una richiesta S3 (vuoto senza file). Garage
# pretende l'intestazione x-amz-content-sha256, che curl aggiunge da sé solo
# nelle versioni recenti: la si passa sempre, e curl la usa nella firma.
impronta_corpo() {
  if [ -n "${1:-}" ]; then
    openssl dgst -sha256 "$1" | sed 's/^.* //'
  else
    printf '' | openssl dgst -sha256 | sed 's/^.* //'
  fi
}

# Richiesta S3 firmata verso Garage, dalla porta locale. Restituisce il
# codice HTTP; il corpo resta in $LAVORO/s3.out. Le sottorisorse si scrivono
# con il valore vuoto esplicito (?cors=): le versioni di curl precedenti la
# 8.5 firmano male ?cors, e Garage rifiuta la firma.
s3_locale() {
  local metodo="$1" percorso="$2" corpo="${3:-}" md5
  local argomenti=(-sS -o "$LAVORO/s3.out" -w '%{http_code}' -K "$LAVORO/setup.curlrc"
    --aws-sigv4 "aws:amz:$REGIONE:s3" -X "$metodo"
    -H "x-amz-content-sha256: $(impronta_corpo "$corpo")")
  if [ -n "$corpo" ]; then
    md5="$(openssl dgst -md5 -binary "$corpo" | base64)"
    argomenti+=(-H "Content-MD5: $md5" -H 'Content-Type: application/xml' --data-binary @"$corpo")
  fi
  curl "${argomenti[@]}" "http://127.0.0.1:$PORTA_S3/$percorso" || true
}
for bucket in "$BUCKET_FILE" "$BUCKET_REGISTRAZIONI"; do
  [ "$(s3_locale PUT "$bucket?cors=" "$LAVORO/cors.xml")" = "200" ] \
    || fine "regole CORS su $bucket non applicate: $(head -c 300 "$LAVORO/s3.out")"
  if [ "$(s3_locale GET "$bucket?cors=")" != "200" ] \
    || ! grep -qF "<AllowedOrigin>$URL_PORTALE</AllowedOrigin>" "$LAVORO/s3.out"; then
    fine "le regole CORS su $bucket non risultano applicate"
  fi
  [ "$(s3_locale PUT "$bucket?lifecycle=" "$LAVORO/lifecycle.xml")" = "200" ] \
    || fine "regola sugli upload incompleti di $bucket non applicata: $(head -c 300 "$LAVORO/s3.out")"
done
togli_permessi_setup || fallito "permessi della chiave di configurazione non revocati"
log "bucket $BUCKET_FILE e $BUCKET_REGISTRAZIONI pronti, CORS per $URL_PORTALE"

# ── Valori per il chart ────────────────────────────────────────
FILE_VALORI="$STATO/values-storage.yaml"
( umask 077
  {
    echo "# Generato da storage.sh: indirizzo dello storage di questa installazione."
    echo "# Nessun segreto: le chiavi stanno in storage.env e nel Secret $SECRET_APP."
    echo "# Va passato a helm dopo examples/values-k3s-storage.yaml."
    echo "app:"
    echo "  env:"
    echo "    STORAGE_FILES_S3_ENDPOINT: \"https://$HOST\""
    echo "    RECORDING_S3_ENDPOINT: \"https://$HOST\""
    if [ -n "$CA_CONFIGMAP" ]; then
      echo "  extraCaCerts:"
      echo "    configMapName: $CA_CONFIGMAP"
      echo "    key: ca.crt"
    fi
  } > "$FILE_VALORI" )

# ── Chiavi nel Secret dell'applicazione, se esiste ─────────────
# In modalità generate il Secret lo rende il chart dai valori: una modifica
# fatta qui sparirebbe al prossimo helm upgrade, e le chiavi vanno invece fra
# i valori (secrets.generate). Il Secret del chart si riconosce dall'etichetta
# di Helm e dalla chiave dei dati personali.
secret_del_chart() {
  local n
  for n in $(kn get secret -l "app.kubernetes.io/instance=$RELEASE,app.kubernetes.io/managed-by=Helm" -o name 2>/dev/null); do
    [ -n "$(kn get "$n" -o 'go-template={{with index .data "PII_ENCRYPTION_KEY"}}x{{end}}' 2>/dev/null)" ] && { printf '%s\n' "${n#secret/}"; return 0; }
  done
  return 0
}
SECRET_AGGIORNATO="no"
GESTORE="$(kn get secret "$SECRET_APP" -o 'jsonpath={.metadata.labels.app\.kubernetes\.io/managed-by}' 2>/dev/null || true)"
DEL_CHART="$(secret_del_chart)"
if [ "$GESTORE" = "Helm" ] || { [ -n "$DEL_CHART" ] && [ "$DEL_CHART" != "$SECRET_APP" ] && ! kn get secret "$SECRET_APP" >/dev/null 2>&1; }; then
  log "il Secret dell'applicazione (${DEL_CHART:-$SECRET_APP}) lo rende il chart, in modalità generate: non lo tocco. Aggiungi le quattro chiavi di $FILE_STORAGE a secrets.generate nel tuo file dei segreti (NOME: \"valore\"), poi helm upgrade"
elif kn get secret "$SECRET_APP" >/dev/null 2>&1; then
  diverse="no"
  for k in STORAGE_FILES_S3_ACCESS_KEY_ID STORAGE_FILES_S3_SECRET_ACCESS_KEY RECORDING_S3_ACCESS_KEY_ID RECORDING_S3_SECRET_ACCESS_KEY; do
    [ "$(chiave_secret "$SECRET_APP" "$k")" = "$(valore_env "$FILE_STORAGE" "$k")" ] || diverse="si"
  done
  if [ "$diverse" = "si" ]; then
    ( umask 077
      {
        printf '{"data":{'
        primo="si"
        for k in STORAGE_FILES_S3_ACCESS_KEY_ID STORAGE_FILES_S3_SECRET_ACCESS_KEY RECORDING_S3_ACCESS_KEY_ID RECORDING_S3_SECRET_ACCESS_KEY; do
          [ "$primo" = "si" ] || printf ','
          primo="no"
          printf '"%s":"%s"' "$k" "$(valore_env "$FILE_STORAGE" "$k" | tr -d '\n' | base64 | tr -d '\n')"
        done
        printf '}}\n'
      } > "$LAVORO/patch.json" )
    kn patch secret "$SECRET_APP" --type merge --patch-file "$LAVORO/patch.json" >/dev/null
    rm -f "$LAVORO/patch.json"
    SECRET_AGGIORNATO="si"
    log "chiavi dello storage aggiunte al Secret $SECRET_APP"
  fi
else
  log "il Secret $SECRET_APP non c'è ancora: le chiavi di $FILE_STORAGE vanno messe lì quando lo crei (--app-secret se ha un altro nome)"
fi

# ── Controllo dal nome pubblico ────────────────────────────────
# Lo stesso percorso di un browser e del portale: DNS (o --resolve),
# certificato, Traefik, Garage, CORS, firma con la chiave del portale.
if [ "$CONTROLLO" = "si" ]; then
  controlla_preflight
  oggetto="$BUCKET_FILE/pa-webinar-check/storage-sh"
  printf 'controllo di PA Webinar\n' > "$LAVORO/oggetto.txt"
  firmato=(-K "$LAVORO/app.curlrc" --aws-sigv4 "aws:amz:$REGIONE:s3")
  codice="$(curl "${CURL_HOST[@]}" "${firmato[@]}" -o /dev/null -w '%{http_code}' -X PUT \
    -H "x-amz-content-sha256: $(impronta_corpo "$LAVORO/oggetto.txt")" \
    -H 'Content-Type: text/plain' --data-binary @"$LAVORO/oggetto.txt" "https://$HOST/$oggetto" || true)"
  [ "$codice" = "200" ] || fine "scrittura di prova su https://$HOST con la chiave del portale non riuscita (HTTP $codice)"
  codice="$(curl "${CURL_HOST[@]}" "${firmato[@]}" -o /dev/null -w '%{http_code}' -X DELETE \
    -H "x-amz-content-sha256: $(impronta_corpo)" "https://$HOST/$oggetto" || true)"
  [ "$codice" = "204" ] || log "ATTENZIONE: oggetto di prova $oggetto non cancellato (HTTP $codice)"
  log "https://$HOST risponde: certificato, CORS e chiave del portale funzionano"
fi

cat >&2 <<FINE

Fatto. Storage pronto su https://$HOST (bucket $BUCKET_FILE, $BUCKET_REGISTRAZIONI).
  - In helm upgrade: examples/values-k3s-storage.yaml subito dopo
    examples/values-k3s.yaml, e dopo il file del sito
      -f $FILE_VALORI
  - Dopo helm upgrade, il controllo dal portale (DNS e certificato visti dal
    cluster, impostazioni arrivate):
      $0 --check --host $HOST --portal-url $URL_PORTALE [--resolve <ip>] [--cacert <ca.crt>]
  - Le chiavi del portale sono in $FILE_STORAGE: se ricrei il Secret
    $SECRET_APP, aggiungile ogni volta.
  - Dati di Garage: volume $NOME-data (local-path, sul disco del nodo).
    Il backup è dell'ente: scripts/backup.sh --include-storage lo salva
    insieme al database, scripts/restore.sh --include-storage lo ripristina.
FINE
if [ "$SECRET_AGGIORNATO" = "si" ]; then
  cat >&2 <<FINE
  - Il Secret $SECRET_APP è cambiato: se dopo helm upgrade il portale non
    riparte da solo, kubectl -n $NAMESPACE rollout restart deployment/$RELEASE
FINE
fi
