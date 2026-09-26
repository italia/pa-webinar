# shellcheck shell=bash
# shellcheck disable=SC2034 # le variabili le leggono gli script che includono questo file
#
# Funzioni comuni a scripts/verify-install.sh, scripts/backup.sh e
# scripts/restore.sh. Non si esegue da solo: lo includono gli script con
# `source`.
#
# Regole che valgono per tutti e tre:
#   - il contesto di kubectl non cambia mai: ogni comando indica kubeconfig,
#     contesto e namespace in modo esplicito, e il contesto si fissa una volta
#     sola all'avvio, così un cambio fatto altrove a metà esecuzione non
#     sposta il bersaglio;
#   - nessun segreto passa sulla riga di comando (li vedrebbe `ps`) né finisce
#     nell'output: le password del database restano dentro il pod, le chiavi
#     arrivano da file o da standard input.

OPS_KUBECONFIG="${OPS_KUBECONFIG:-}"
OPS_CONTEXT="${OPS_CONTEXT:-}"
OPS_NAMESPACE="${OPS_NAMESPACE:-pa-webinar}"
OPS_RELEASE="${OPS_RELEASE:-pa-webinar}"
# Vero quando il contesto non è stato indicato e si è preso quello corrente.
# shellcheck disable=SC2034 # letta dagli script che includono questo file
OPS_CONTEXT_IMPLICITO="no"

# Sceglie il kubeconfig quando non è indicato: quello di kubectl ($KUBECONFIG
# o ~/.kube/config) e, se non c'è, quello di k3s sul nodo.
ops_kubeconfig_predefinito() {
  [ -n "$OPS_KUBECONFIG" ] && return 0
  [ -n "${KUBECONFIG:-}" ] && return 0
  [ -r "$HOME/.kube/config" ] && return 0
  if [ -r /etc/rancher/k3s/k3s.yaml ]; then
    OPS_KUBECONFIG=/etc/rancher/k3s/k3s.yaml
  fi
  return 0
}

# kubectl con kubeconfig e contesto espliciti, senza namespace.
kc_cluster() {
  local a=()
  [ -n "$OPS_KUBECONFIG" ] && a+=(--kubeconfig "$OPS_KUBECONFIG")
  [ -n "$OPS_CONTEXT" ] && a+=(--context "$OPS_CONTEXT")
  kubectl ${a[@]+"${a[@]}"} "$@"
}

# kubectl nel namespace della release.
kc() {
  kc_cluster -n "$OPS_NAMESPACE" "$@"
}

# Fissa il contesto: se non è indicato, quello corrente del kubeconfig scelto.
# Ritorna 1 se non ce n'è nessuno.
ops_fissa_contesto() {
  ops_kubeconfig_predefinito
  if [ -z "$OPS_CONTEXT" ]; then
    OPS_CONTEXT="$(kc_cluster config current-context 2>/dev/null || true)"
    # shellcheck disable=SC2034 # letta dagli script che includono questo file
    OPS_CONTEXT_IMPLICITO="si"
    [ -n "$OPS_CONTEXT" ] || return 1
  fi
  return 0
}

# Indirizzo del server API del contesto fissato (per dire su cosa si agisce).
ops_server_api() {
  kc_cluster config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true
}

# Nome del Deployment del portale: l'unico della release con l'initContainer
# delle migrazioni (db-migrate). Non si ricostruisce il nome dal chart: così
# vale anche con nameOverride e fullnameOverride.
ops_deployment_portale() {
  kc get deployment -l "app.kubernetes.io/instance=$OPS_RELEASE" \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.template.spec.initContainers[*].name}{"\n"}{end}' \
    2>/dev/null | awk -F'\t' '{ n = split($2, c, " "); for (i = 1; i <= n; i++) if (c[i] == "db-migrate") print $1 }'
}

# Deployment del controller del registratore, se la release lo ha.
ops_deployment_controller() {
  kc get deployment -l "app.kubernetes.io/instance=$OPS_RELEASE,app.kubernetes.io/component=recorder-controller" \
    -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true
}

# Pod primario del PostgreSQL del chart (sottochart Bitnami). Vuoto se il
# database è esterno.
ops_pod_postgres() {
  kc get pods -l "app.kubernetes.io/instance=$OPS_RELEASE,app.kubernetes.io/name=postgresql,app.kubernetes.io/component=primary" \
    --field-selector=status.phase=Running \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true
}

# Prologo eseguito dentro il container PostgreSQL: utente, password e database
# vengono dalle variabili del container stesso (file della password montato
# dal Secret), quindi non attraversano mai la riga di comando né la rete.
# shellcheck disable=SC2016 # le variabili vanno espanse nel pod, non qui
OPS_PG_PROLOGO='PGPASSWORD="${POSTGRES_PASSWORD:-}"
if [ -n "${POSTGRES_PASSWORD_FILE:-}" ] && [ -r "$POSTGRES_PASSWORD_FILE" ]; then PGPASSWORD="$(cat "$POSTGRES_PASSWORD_FILE")"; fi
export PGPASSWORD PGHOST=127.0.0.1 PGUSER="${POSTGRES_USER:-postgres}" PGDATABASE="${POSTGRES_DATABASE:-postgres}"
'

# Esegue un comando del client PostgreSQL dentro il pod del database.
# Uso: ops_pg_exec POD [-i] -- comando argomenti...
ops_pg_exec() {
  local pod="$1"; shift
  local stdin=()
  if [ "${1:-}" = "-i" ]; then stdin=(-i); shift; fi
  [ "${1:-}" = "--" ] && shift
  kc exec ${stdin[@]+"${stdin[@]}"} "$pod" -c postgresql -- sh -c "$OPS_PG_PROLOGO"'exec "$@"' sh "$@"
}

# Una query, risultato senza intestazioni (campi separati da |).
ops_pg_query() {
  local pod="$1" sql="$2"
  ops_pg_exec "$pod" -- psql -X -w -q -v ON_ERROR_STOP=1 -tA -c "$sql"
}

# Conteggio esatto delle righe di ogni tabella dello schema public, una riga
# "tabella|righe" per tabella, in ordine. Serve a confrontare un ripristino con
# il backup da cui viene.
OPS_SQL_CONTEGGI="SELECT format('SELECT %L, count(*) FROM %I.%I', table_name, table_schema, table_name)
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name \\gexec"

ops_pg_conteggi() {
  local pod="$1"
  printf '%s\n' "$OPS_SQL_CONTEGGI" | ops_pg_exec "$pod" -i -- psql -X -w -q -v ON_ERROR_STOP=1 -tA
}

# ── Database esterno: DATABASE_URL ─────────────────────────────
# Scompone DATABASE_URL (formato postgresql://utente:password@host:porta/db?...)
# nelle variabili PG* di libpq, così pg_dump, pg_restore e psql locali si
# collegano senza che l'indirizzo con la password compaia fra gli argomenti.
# I parametri di Prisma (schema, connection_limit, ...) non sono di libpq e si
# scartano; sslmode resta.
ops_decodifica_percento() {
  local s="$1" out="" c h
  while [ -n "$s" ]; do
    c="${s:0:1}"
    if [ "$c" = "%" ] && [[ "${s:1:2}" =~ ^[0-9A-Fa-f]{2}$ ]]; then
      h="${s:1:2}"
      printf -v c '%b' "\\x$h"
      out+="$c"; s="${s:3}"
    else
      out+="$c"; s="${s:1}"
    fi
  done
  printf '%s' "$out"
}

ops_esporta_database_url() {
  local url="$1" re query coppia
  re='^postgres(ql)?://([^:@/]*)(:([^@/]*))?@(\[[^]]+\]|[^:/?]+)(:([0-9]+))?/([^?]+)(\?(.*))?$'
  [[ "$url" =~ $re ]] || return 1
  PGUSER="$(ops_decodifica_percento "${BASH_REMATCH[2]}")"
  PGPASSWORD="$(ops_decodifica_percento "${BASH_REMATCH[4]}")"
  PGHOST="${BASH_REMATCH[5]}"; PGHOST="${PGHOST#[}"; PGHOST="${PGHOST%]}"
  PGPORT="${BASH_REMATCH[7]:-5432}"
  PGDATABASE="$(ops_decodifica_percento "${BASH_REMATCH[8]}")"
  query="${BASH_REMATCH[10]}"
  export PGUSER PGPASSWORD PGHOST PGPORT PGDATABASE
  local IFS='&'
  for coppia in $query; do
    case "$coppia" in
      sslmode=*) PGSSLMODE="${coppia#sslmode=}"; export PGSSLMODE ;;
      sslrootcert=*) PGSSLROOTCERT="$(ops_decodifica_percento "${coppia#sslrootcert=}")"; export PGSSLROOTCERT ;;
    esac
  done
  return 0
}

# Legge DATABASE_URL: dal file indicato, altrimenti dall'ambiente. Mai da un
# argomento. Stampa l'URL su stdout (per l'uso interno in una variabile).
ops_leggi_database_url() {
  local file="$1"
  if [ -n "$file" ]; then
    if [ "$file" = "-" ]; then
      head -n 1
    else
      head -n 1 "$file"
    fi
  else
    printf '%s' "${DATABASE_URL:-}"
  fi
}

# ── Chiavi dai file dei segreti ────────────────────────────────
# Accetta sia KEY=valore (file .env, anche con `export`) sia `KEY: "valore"`
# (file YAML di valori Helm, come quello di scripts/minikube-up.sh). Restituisce
# il primo valore trovato, senza virgolette.
ops_chiave_da_file() {
  local chiave="$1" file="$2"
  awk -v k="$chiave" '
    {
      riga = $0
      sub(/^[ \t]*export[ \t]+/, "", riga)
      sub(/^[ \t]+/, "", riga)
      if (index(riga, k) != 1) next
      resto = substr(riga, length(k) + 1)
      if (resto !~ /^[ \t]*[:=]/) next
      sub(/^[ \t]*[:=][ \t]*/, "", resto)
      sub(/[ \t\r]+$/, "", resto)
      if (resto ~ /^".*"$/ || resto ~ /^\047.*\047$/) resto = substr(resto, 2, length(resto) - 2)
      print resto
      exit
    }' "$file"
}

# Impronta breve di un valore (prime 16 cifre esadecimali del SHA-256): serve a
# confrontare due chiavi senza mostrarle. Il valore arriva da stdin.
ops_impronta() {
  openssl dgst -sha256 | awk '{print substr($NF, 1, 16)}'
}

# Converte una data ISO 8601 (UTC) in secondi dall'epoca: GNU date o BSD date.
ops_epoca() {
  date -u -d "$1" +%s 2>/dev/null \
    || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$1" +%s 2>/dev/null \
    || date -u -j -f '%b %d %T %Y %Z' "$1" +%s 2>/dev/null
}

# ── Dove sta il cluster ────────────────────────────────────────
# Indirizzi IP di questa macchina, uno per riga.
ops_ip_locali() {
  {
    hostname -I 2>/dev/null | tr ' ' '\n'
    ip -o addr show 2>/dev/null | awk '{sub(/\/.*/, "", $4); print $4}'
    ifconfig 2>/dev/null | awk '$1 == "inet" || $1 == "inet6" {sub(/^addr:/, "", $2); print $2}'
  } | grep . | sort -u
}

# 0 se il cluster gira su questa macchina (un nodo ha uno dei suoi indirizzi,
# o è un cluster di sviluppo locale come minikube o kind), 1 se è altrove, 2
# se non si capisce. L'indirizzo dell'API non basta: con un tunnel ssh è
# 127.0.0.1 anche per un server remoto.
ops_cluster_su_questa_macchina() {
  local nodi locali ip
  nodi="$(kc_cluster get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"|"}{.spec.providerID}{"|"}{.metadata.labels.minikube\.k8s\.io/name}{"|"}{range .status.addresses[*]}{.address}{" "}{end}{"\n"}{end}' 2>/dev/null || true)"
  [ -n "$nodi" ] || return 2
  if printf '%s\n' "$nodi" | awk -F'|' '$3 != "" || $2 ~ /^kind:\/\// || $1 ~ /^k3d-/ || $1 == "docker-desktop" {t = 1} END {exit !t}'; then
    return 0
  fi
  locali="$(ops_ip_locali)"
  [ -n "$locali" ] || return 2
  for ip in $(printf '%s\n' "$nodi" | awk -F'|' '{print $4}'); do
    printf '%s\n' "$locali" | grep -Fxq -- "$ip" && return 0
  done
  return 1
}

# ── Object storage su un volume del cluster (add-on Garage) ────
# Lo si riconosce dalle etichette del suo Deployment; il volume è il PVC che
# il Deployment monta. Un altro storage su PVC si indica con un selettore.
OPS_ANN_REPLICHE="pa-webinar/restore-replicas"
OPS_STORAGE_SELETTORE="${OPS_STORAGE_SELETTORE:-}"
OPS_STORAGE_DEPLOY=""
OPS_STORAGE_PVC=""
OPS_STORAGE_ERRORE=""
# Cartelle di lavoro nel volume durante un ripristino: il backup le salta.
OPS_STORAGE_NUOVO=".pa-webinar-ripristino"
OPS_STORAGE_VECCHIO=".pa-webinar-precedente"

ops_selettore_storage() {
  printf '%s' "${OPS_STORAGE_SELETTORE:-app.kubernetes.io/name=garage,app.kubernetes.io/instance=$OPS_RELEASE}"
}

ops_deployment_storage() {
  kc get deployment -l "$(ops_selettore_storage)" \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true
}

# Imposta OPS_STORAGE_DEPLOY e OPS_STORAGE_PVC; se non si trovano, 1 con il
# motivo in OPS_STORAGE_ERRORE.
ops_trova_storage() {
  local d p
  OPS_STORAGE_DEPLOY=""; OPS_STORAGE_PVC=""; OPS_STORAGE_ERRORE=""
  d="$(ops_deployment_storage)"
  if [ -z "$d" ]; then
    OPS_STORAGE_ERRORE="nessun object storage su volume per la release $OPS_RELEASE nel namespace $OPS_NAMESPACE (Deployment con etichette $(ops_selettore_storage)). L'add-on Garage si installa con pa-webinar-up.sh --storage garage (o infra/onprem/k3s/addons/storage.sh); uno storage esterno (S3 di un fornitore) si salva con i suoi strumenti."
    return 1
  fi
  if [ "$(printf '%s\n' "$d" | wc -l)" -gt 1 ]; then
    OPS_STORAGE_ERRORE="più Deployment con etichette $(ops_selettore_storage): $(printf '%s' "$d" | tr '\n' ' ')(indica quale con --storage-selector)"
    return 1
  fi
  p="$(kc get deployment "$d" -o jsonpath='{range .spec.template.spec.volumes[*]}{.persistentVolumeClaim.claimName}{"\n"}{end}' 2>/dev/null | grep . || true)"
  if [ -z "$p" ]; then
    OPS_STORAGE_ERRORE="il Deployment $d non monta un volume persistente (PVC): niente da salvare da qui"
    return 1
  fi
  if [ "$(printf '%s\n' "$p" | wc -l)" -gt 1 ]; then
    OPS_STORAGE_ERRORE="il Deployment $d monta più volumi ($(printf '%s' "$p" | tr '\n' ' ')): non gestito"
    return 1
  fi
  OPS_STORAGE_DEPLOY="$d"
  OPS_STORAGE_PVC="$p"
}

# Pod di un Deployment: quelli dei suoi ReplicaSet, <deployment>-<hash>. Il
# tipo conta: pa-webinar-postgresql (StatefulSet) ha la stessa forma.
ops_pod_di_deployment() {
  kc get pods -o jsonpath='{range .items[*]}{.metadata.name}{"|"}{.metadata.ownerReferences[0].kind}{"|"}{.metadata.ownerReferences[0].name}{"\n"}{end}' 2>/dev/null \
    | awk -F'|' -v d="$1" '$2 == "ReplicaSet" && index($3, d "-") == 1 && substr($3, length(d) + 2) !~ /-/ {print $1}'
}

# Ferma un Deployment: prima annota le repliche di partenza (mai
# sovrascritte: un secondo lancio dopo un'interruzione ritrova quelle vere),
# poi zero repliche, poi aspetta che i pod spariscano. Uso: NOME SECONDI.
ops_ferma_deployment() {
  local d="$1" attesa="$2" n limite
  if [ -z "$(kc get deployment "$d" -o jsonpath="{.metadata.annotations.${OPS_ANN_REPLICHE//./\\.}}" 2>/dev/null)" ]; then
    n="$(kc get deployment "$d" -o jsonpath='{.spec.replicas}')"
    kc annotate deployment "$d" "$OPS_ANN_REPLICHE=${n:-1}" >/dev/null || return 1
  fi
  kc scale deployment "$d" --replicas=0 >/dev/null || return 1
  limite=$(( $(date +%s) + attesa ))
  while [ -n "$(ops_pod_di_deployment "$d")" ] && [ "$(date +%s)" -lt "$limite" ]; do sleep 2; done
  [ -z "$(ops_pod_di_deployment "$d")" ]
}

# Riporta un Deployment fermato da ops_ferma_deployment alle repliche
# annotate e aspetta che sia pronto. 0 anche se non era fermato.
# Uso: NOME SECONDI; stampa una riga di esito.
ops_riprendi_deployment() {
  local d="$1" attesa="$2" n
  n="$(kc get deployment "$d" -o jsonpath="{.metadata.annotations.${OPS_ANN_REPLICHE//./\\.}}" 2>/dev/null || true)"
  [ -n "$n" ] || return 0
  if ! [[ "$n" =~ ^[0-9]+$ ]]; then
    printf '   ATTENZIONE: %s ha un'"'"'annotazione %s non valida (%s): scala a mano\n' "$d" "$OPS_ANN_REPLICHE" "$n"
    return 1
  fi
  kc scale deployment "$d" --replicas="$n" >/dev/null || return 1
  printf '   %s: %s repliche\n' "$d" "$n"
  if [ "$n" -gt 0 ] && ! kc rollout status deployment "$d" --timeout="${attesa}s" >/dev/null 2>&1; then
    printf '   ATTENZIONE: %s non è pronto entro %ss (kubectl -n %s describe deployment %s)\n' "$d" "$attesa" "$OPS_NAMESPACE" "$d"
    kc annotate deployment "$d" "$OPS_ANN_REPLICHE-" >/dev/null 2>&1 || true
    return 1
  fi
  kc annotate deployment "$d" "$OPS_ANN_REPLICHE-" >/dev/null 2>&1 || true
}

# ── Pod di appoggio sul volume dello storage ───────────────────
# Un pod che monta il volume a /dati e non fa altro che aspettare: backup e
# ripristino ci passano il contenuto con kubectl exec, in un flusso tar. Usa
# un'immagine che il nodo ha già (quella del PostgreSQL del chart, o del
# portale), lo stesso utente dello storage (i file restano suoi) e nessuna
# rete. Si cancella a fine lavoro; se resta, si ferma da solo dopo 12 ore.
ops_nome_pod_copia() {
  printf '%s-copia' "$OPS_STORAGE_DEPLOY"
}

ops_elimina_pod_copia() {
  kc delete pod -l "app.kubernetes.io/instance=$OPS_RELEASE,app.kubernetes.io/component=storage-copy" \
    --ignore-not-found --wait=true >/dev/null 2>&1 || true
}

# Crea il pod e aspetta che sia pronto. Uso: SECONDI. 1 con il motivo in
# OPS_STORAGE_ERRORE.
ops_crea_pod_copia() {
  local attesa="$1" nome immagine="" segreti="" pg portale ctx utente gruppo fsgruppo u2 g2 sicurezza s err
  nome="$(ops_nome_pod_copia)"
  pg="$(ops_pod_postgres)"
  if [ -n "$pg" ]; then
    immagine="$(kc get pod "$pg" -o jsonpath='{.spec.containers[?(@.name=="postgresql")].image}' 2>/dev/null || true)"
    segreti="$(kc get pod "$pg" -o jsonpath='{.spec.imagePullSecrets[*].name}' 2>/dev/null || true)"
  fi
  if [ -z "${immagine:-}" ]; then
    portale="$(ops_deployment_portale | head -n 1)"
    [ -n "$portale" ] && immagine="$(kc get deployment "$portale" -o jsonpath='{.spec.template.spec.containers[?(@.name=="pa-webinar")].image}' 2>/dev/null || true)"
    [ -n "$portale" ] && segreti="$(kc get deployment "$portale" -o jsonpath='{.spec.template.spec.imagePullSecrets[*].name}' 2>/dev/null || true)"
  fi
  if [ -z "${immagine:-}" ]; then
    OPS_STORAGE_ERRORE="nessuna immagine con una shell per il pod di appoggio (né PostgreSQL né portale nella release)"
    return 1
  fi
  ctx="$(kc get deployment "$OPS_STORAGE_DEPLOY" -o jsonpath='{.spec.template.spec.securityContext.runAsUser}{"|"}{.spec.template.spec.securityContext.runAsGroup}{"|"}{.spec.template.spec.securityContext.fsGroup}{"|"}{.spec.template.spec.containers[0].securityContext.runAsUser}{"|"}{.spec.template.spec.containers[0].securityContext.runAsGroup}' 2>/dev/null || true)"
  IFS='|' read -r utente gruppo fsgruppo u2 g2 <<< "$ctx"
  utente="${utente:-$u2}"; gruppo="${gruppo:-$g2}"
  sicurezza="      seccompProfile: {type: RuntimeDefault}"
  if [ -n "$utente" ]; then
    sicurezza+=$'\n'"      runAsUser: $utente"
    [ "$utente" != "0" ] && sicurezza+=$'\n'"      runAsNonRoot: true"
  fi
  [ -n "$gruppo" ] && sicurezza+=$'\n'"      runAsGroup: $gruppo"
  [ -n "$fsgruppo" ] && sicurezza+=$'\n'"      fsGroup: $fsgruppo"$'\n'"      fsGroupChangePolicy: OnRootMismatch"
  ops_elimina_pod_copia
  if ! err="$({
    cat <<FINE
apiVersion: v1
kind: Pod
metadata:
  name: $nome
  labels:
    app.kubernetes.io/instance: $OPS_RELEASE
    app.kubernetes.io/part-of: pa-webinar
    app.kubernetes.io/component: storage-copy
    app.kubernetes.io/managed-by: pa-webinar-scripts
spec:
  restartPolicy: Never
  activeDeadlineSeconds: 43200
  terminationGracePeriodSeconds: 30
  automountServiceAccountToken: false
  enableServiceLinks: false
  securityContext:
$sicurezza
FINE
    if [ -n "$segreti" ]; then
      printf '  imagePullSecrets:\n'
      for s in $segreti; do printf '    - name: %s\n' "$s"; done
    fi
    cat <<FINE
  containers:
    - name: copia
      image: "$immagine"
      imagePullPolicy: IfNotPresent
      command: ["sh", "-c", "sleep 43200"]
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities: {drop: [ALL]}
      resources:
        requests: {cpu: 10m, memory: 32Mi}
        limits: {memory: 256Mi}
      volumeMounts:
        - {name: dati, mountPath: /dati}
        - {name: tmp, mountPath: /tmp}
  volumes:
    - name: dati
      persistentVolumeClaim: {claimName: $OPS_STORAGE_PVC}
    - name: tmp
      emptyDir: {sizeLimit: 16Mi}
FINE
  } | kc apply -f - 2>&1 >/dev/null)"; then
    OPS_STORAGE_ERRORE="pod di appoggio non creato: $(printf '%s' "$err" | head -c 300)"
    return 1
  fi
  if ! kc wait --for=condition=Ready "pod/$nome" --timeout="${attesa}s" >/dev/null 2>&1; then
    OPS_STORAGE_ERRORE="il pod di appoggio $nome non parte entro ${attesa}s (kubectl -n $OPS_NAMESPACE describe pod $nome): $(kc get pod "$nome" -o jsonpath='{.status.containerStatuses[0].state.waiting.reason} {.status.containerStatuses[0].state.waiting.message}' 2>/dev/null | head -c 200)"
    return 1
  fi
}

# Comando dentro il pod di appoggio: sh -c SCRIPT, con stdin se -i.
ops_exec_copia() {
  local stdin=()
  if [ "${1:-}" = "-i" ]; then stdin=(-i); shift; fi
  kc exec ${stdin[@]+"${stdin[@]}"} "$(ops_nome_pod_copia)" -c copia -- sh -c "$1"
}

# Script per il pod: archivio tar del volume su stdout; alla fine, su stderr,
# la riga "pa-webinar-copia <esito di tar> <sha256> <byte>". Salta lost+found
# e le cartelle di lavoro di un ripristino.
# shellcheck disable=SC2016 # espanso dalla shell del pod
OPS_SCRIPT_ARCHIVIA='cd /dati || exit 90
rm -f /tmp/p1 /tmp/p2 /tmp/somma /tmp/byte /tmp/rc
mkfifo /tmp/p1 /tmp/p2 || exit 91
set --
for f in * .[!.]* ..?*; do
  [ -e "$f" ] || [ -L "$f" ] || continue
  case "$f" in lost+found|.pa-webinar-*) continue ;; esac
  set -- "$@" "$f"
done
[ "$#" -gt 0 ] || { echo "volume vuoto" >&2; exit 92; }
tee /tmp/p2 < /tmp/p1 | sha256sum > /tmp/somma &
wc -c < /tmp/p2 > /tmp/byte &
{ tar -cf - -- "$@"; echo "$?" > /tmp/rc; } | tee /tmp/p1
wait
printf "pa-webinar-copia %s %s %s\n" "$(cat /tmp/rc)" "$(cut -d " " -f 1 /tmp/somma)" "$(tr -d " " < /tmp/byte)" >&2'

# Script per il pod: estrae il tar che arriva su stdin in una cartella di
# lavoro del volume, senza toccare il contenuto attuale; alla fine, su
# stderr, "pa-webinar-copia <esito di tar> <sha256>".
# shellcheck disable=SC2016
OPS_SCRIPT_ESTRAI='cd /dati || exit 90
rm -rf "./'"$OPS_STORAGE_NUOVO"'" "./'"$OPS_STORAGE_VECCHIO"'"
mkdir "./'"$OPS_STORAGE_NUOVO"'" || exit 91
rm -f /tmp/p1 /tmp/somma /tmp/rc
mkfifo /tmp/p1 || exit 91
sha256sum < /tmp/p1 > /tmp/somma &
tee /tmp/p1 | { tar -C "./'"$OPS_STORAGE_NUOVO"'" -xpf -; echo "$?" > /tmp/rc; cat > /dev/null; }
wait
printf "pa-webinar-copia %s %s\n" "$(cat /tmp/rc)" "$(cut -d " " -f 1 /tmp/somma)" >&2'

# Script per il pod: sostituisce il contenuto del volume con quello estratto
# (rinomine nello stesso file system, un istante), poi cancella il vecchio.
# Ignora i segnali: una sostituzione a metà lascerebbe lo storage senza dati.
# shellcheck disable=SC2016
OPS_SCRIPT_SCAMBIA='trap "" TERM INT HUP
cd /dati || exit 90
[ -d "./'"$OPS_STORAGE_NUOVO"'" ] || exit 91
rm -rf "./'"$OPS_STORAGE_VECCHIO"'"
mkdir "./'"$OPS_STORAGE_VECCHIO"'" || exit 92
for f in * .[!.]* ..?*; do
  [ -e "$f" ] || [ -L "$f" ] || continue
  case "$f" in lost+found|.pa-webinar-*) continue ;; esac
  mv -- "$f" "./'"$OPS_STORAGE_VECCHIO"'/" || exit 93
done
cd "./'"$OPS_STORAGE_NUOVO"'" || exit 94
for f in * .[!.]* ..?*; do
  [ -e "$f" ] || [ -L "$f" ] || continue
  mv -- "$f" ../ || exit 95
done
cd /dati && rmdir "./'"$OPS_STORAGE_NUOVO"'" && rm -rf "./'"$OPS_STORAGE_VECCHIO"'" || exit 96
echo pa-webinar-scambio-concluso'

# Spazio libero sul volume, in KiB.
# shellcheck disable=SC2016
OPS_SCRIPT_SPAZIO='df -Pk /dati | awk "NR == 2 {print \$4}"'
