#!/usr/bin/env bash
#
# Backup di un'installazione di PA Webinar: il database PostgreSQL (pg_dump in
# formato custom, dal pod del chart o da DATABASE_URL), a richiesta l'object
# storage su un volume del cluster (l'add-on Garage) e, se indicati, i file
# di stato dell'installazione (segreti, valori del sito). Ogni backup è una
# cartella con i file, un manifesto senza segreti e le somme di controllo;
# i backup oltre il numero da conservare si cancellano.
#
# Uso:  scripts/backup.sh [opzioni]        (--help per l'elenco)
#
# I file contengono dati personali e, con lo stato, le chiavi: nascono con
# permessi 0600 in una cartella 0700, cifrati con age o gpg se richiesto.
# Uno storage esterno (S3 di un fornitore) non è compreso: va copiato con gli
# strumenti del fornitore.
#
# Esce con 0 se il backup è completo, 1 se non lo è (la cartella parziale si
# cancella) o se lo storage fermato per la copia non torna pronto, 2 per
# opzioni sbagliate, strumenti mancanti o uno storage chiesto che non c'è.

set -euo pipefail

RADICE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib/ops-common.sh
source "$RADICE/scripts/lib/ops-common.sh"

STATE_DIR=""
INCLUDE=()
DIR=""
KEEP=14
DA_URL="no"
URL_FILE=""
AGE_RECIPIENTS=()
AGE_RECIPIENTS_FILE=""
GPG_RECIPIENTS=()
QUIET="no"
STORAGE="no"
CON_DIRETTE="no"
ATTESA=300

uso() {
  cat <<'FINE'
Uso: scripts/backup.sh [opzioni]

Salva il database di PA Webinar e, se indicati, i file di stato
dell'installazione, in una cartella nuova con manifesto e somme di controllo.

Cluster (kubectl riceve sempre kubeconfig e contesto espliciti: il contesto
attivo non cambia)
  --kubeconfig FILE       predefinito: $KUBECONFIG, poi ~/.kube/config, poi
                          /etc/rancher/k3s/k3s.yaml (nodo k3s)
  --context NOME          predefinito: il contesto corrente di quel kubeconfig
  --namespace NOME        predefinito: pa-webinar
  --release NOME          release Helm, predefinito: pa-webinar

Database esterno (predefinito: il PostgreSQL del chart, dal suo pod)
  --database-url          usa DATABASE_URL dall'ambiente, con pg_dump e psql di
                          questa macchina (versione pari o superiore al server)
  --database-url-file F   legge DATABASE_URL dal file F ("-" = standard input)

Cosa salvare oltre al database
  --include-storage       anche l'object storage su un volume del cluster
                          (l'add-on Garage: materiali, video, registrazioni).
                          Lo storage si ferma per tutta la copia, database
                          compreso, così i due restano coerenti: caricamenti
                          e riproduzioni non funzionano per quel tempo
  --storage-selector SEL  etichette del Deployment dello storage (predefinito:
                          app.kubernetes.io/name=garage,
                          app.kubernetes.io/instance=<release>)
  --allow-live            con --include-storage, procede anche con eventi in
                          diretta o in allestimento (le registrazioni in
                          corso non si caricherebbero)
  --timeout S             attesa massima per fermare e riavviare lo storage
                          (predefinito: 300)
  --state-dir DIR         cartella di stato dell'installazione (segreti,
                          valori del sito): entra nel backup, tranne la
                          cartella dei backup. Diventa anche la destinazione
                          predefinita: DIR/backups
  --include PERCORSO      file o cartella in più (ripetibile)

Destinazione
  --dir DIR               cartella dei backup (predefinito: DIR/backups con
                          --state-dir, altrimenti
                          ~/.config/pa-webinar/backups/<namespace>-<release>)
  --keep N                backup da conservare, i più vecchi si cancellano
                          (predefinito: 14; 0 = conservali tutti)

Cifratura (consigliata: senza, database e segreti restano in chiaro)
  --age-recipient R       chiave pubblica age (ripetibile)
  --age-recipients-file F file di chiavi pubbliche age
  --gpg-recipient ID      destinatario gpg (ripetibile)
  Per decifrare servirà la chiave privata corrispondente: conservala
  lontano dal nodo, altrimenti chi perde il nodo perde anche i backup.

Uscita
  --quiet                 stampa solo gli errori (per cron)
  -h, --help              questo aiuto

Esempi
  # nodo k3s, ogni notte alle 2:30, cifrato con age
  30 2 * * * /opt/pa-webinar/scripts/backup.sh --quiet \
    --state-dir /root/.config/pa-webinar/k3s/pa-webinar \
    --age-recipients-file /root/.config/pa-webinar/backup-recipients.txt
  # dalla postazione, installazione di pa-webinar-up.sh con Garage
  scripts/backup.sh --kubeconfig ~/.config/pa-webinar/k3s/<nome>/kubeconfig \
    --state-dir ~/.config/pa-webinar/k3s/<nome> --include-storage \
    --age-recipient age1...
  # minikube
  scripts/backup.sh --context pa-webinar --state-dir ~/.config/pa-webinar/minikube/pa-webinar
FINE
}

uscita_uso() {
  printf '✗ %s\n' "$*" >&2
  exit 2
}

fallito() {
  printf '✗ %s\n' "$*" >&2
  exit 1
}

passo() {
  [ "$QUIET" = "si" ] && return 0
  printf '── %s\n' "$*"
}

nota() {
  [ "$QUIET" = "si" ] && return 0
  printf '   %s\n' "$*"
}

percorso_assoluto() {
  local p="$1"
  # Una tilde fra virgolette arriva letterale: la si espande qui.
  # shellcheck disable=SC2088
  case "$p" in
    "~"|"~/"*) p="$HOME${p#\~}" ;;
  esac
  case "$p" in
    /*) printf '%s' "$p" ;;
    *) printf '%s/%s' "$PWD" "$p" ;;
  esac
}

while [ $# -gt 0 ]; do
  case "$1" in
    --kubeconfig) OPS_KUBECONFIG="${2:?--kubeconfig vuole un file}"; shift 2 ;;
    --context) OPS_CONTEXT="${2:?--context vuole un nome}"; shift 2 ;;
    --namespace) OPS_NAMESPACE="${2:?--namespace vuole un nome}"; shift 2 ;;
    --release) OPS_RELEASE="${2:?--release vuole un nome}"; shift 2 ;;
    --database-url) DA_URL="si"; shift ;;
    --database-url-file) DA_URL="si"; URL_FILE="${2:?--database-url-file vuole un file}"; shift 2 ;;
    --state-dir) STATE_DIR="$(percorso_assoluto "${2:?--state-dir vuole una cartella}")"; shift 2 ;;
    --include) INCLUDE+=("$(percorso_assoluto "${2:?--include vuole un percorso}")"); shift 2 ;;
    --dir) DIR="$(percorso_assoluto "${2:?--dir vuole una cartella}")"; shift 2 ;;
    --keep) KEEP="${2:?--keep vuole un numero}"; shift 2 ;;
    --age-recipient) AGE_RECIPIENTS+=("${2:?--age-recipient vuole una chiave}"); shift 2 ;;
    --age-recipients-file) AGE_RECIPIENTS_FILE="${2:?--age-recipients-file vuole un file}"; shift 2 ;;
    --gpg-recipient) GPG_RECIPIENTS+=("${2:?--gpg-recipient vuole un destinatario}"); shift 2 ;;
    --include-storage) STORAGE="si"; shift ;;
    --storage-selector) OPS_STORAGE_SELETTORE="${2:?--storage-selector vuole delle etichette}"; shift 2 ;;
    --allow-live) CON_DIRETTE="si"; shift ;;
    --timeout) ATTESA="${2:?--timeout vuole dei secondi}"; shift 2 ;;
    --quiet) QUIET="si"; shift ;;
    -h|--help) uso; exit 0 ;;
    *) uscita_uso "Opzione sconosciuta: $1 (--help per l'elenco)" ;;
  esac
done

[[ "$KEEP" =~ ^[0-9]+$ ]] || uscita_uso "--keep vuole un numero intero (non '$KEEP')."
[[ "$ATTESA" =~ ^[0-9]+$ ]] || uscita_uso "--timeout vuole un numero di secondi."
if [ "$STORAGE" = "si" ] && [ "$DA_URL" = "si" ] && [ -z "$OPS_CONTEXT" ] && [ -z "$OPS_KUBECONFIG" ]; then
  uscita_uso "--include-storage con --database-url: indica anche --kubeconfig o --context (lo storage è nel cluster)."
fi
[[ "$OPS_RELEASE" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || uscita_uso "Nome di release non valido: $OPS_RELEASE"
if [ -n "$STATE_DIR" ]; then
  [ -d "$STATE_DIR" ] || uscita_uso "--state-dir: $STATE_DIR non è una cartella."
  INCLUDE=("$STATE_DIR" ${INCLUDE[@]+"${INCLUDE[@]}"})
fi
for p in ${INCLUDE[@]+"${INCLUDE[@]}"}; do
  [ -e "$p" ] || uscita_uso "--include: $p non esiste."
done

CIFRATURA="nessuna"
ESTENSIONE=""
if [ ${#AGE_RECIPIENTS[@]} -gt 0 ] || [ -n "$AGE_RECIPIENTS_FILE" ]; then
  [ ${#GPG_RECIPIENTS[@]} -eq 0 ] || uscita_uso "Scegli age o gpg, non entrambi."
  command -v age >/dev/null 2>&1 || uscita_uso "Manca 'age' (https://age-encryption.org)."
  [ -z "$AGE_RECIPIENTS_FILE" ] || [ -r "$AGE_RECIPIENTS_FILE" ] || uscita_uso "--age-recipients-file: $AGE_RECIPIENTS_FILE non leggibile."
  CIFRATURA="age"; ESTENSIONE=".age"
elif [ ${#GPG_RECIPIENTS[@]} -gt 0 ]; then
  command -v gpg >/dev/null 2>&1 || uscita_uso "Manca 'gpg'."
  CIFRATURA="gpg"; ESTENSIONE=".gpg"
fi

cifra() {
  case "$CIFRATURA" in
    age)
      local a=()
      for r in ${AGE_RECIPIENTS[@]+"${AGE_RECIPIENTS[@]}"}; do a+=(-r "$r"); done
      [ -n "$AGE_RECIPIENTS_FILE" ] && a+=(-R "$AGE_RECIPIENTS_FILE")
      age "${a[@]}" ;;
    gpg)
      local a=()
      for r in "${GPG_RECIPIENTS[@]}"; do a+=(--recipient "$r"); done
      gpg --batch --yes --quiet --trust-model always --encrypt "${a[@]}" ;;
    *) cat ;;
  esac
}

somma_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

for c in openssl awk tar; do
  command -v "$c" >/dev/null 2>&1 || uscita_uso "Manca '$c'."
done
if [ "$DA_URL" = "si" ]; then
  for c in pg_dump psql; do
    command -v "$c" >/dev/null 2>&1 || uscita_uso "Con --database-url serve '$c' su questa macchina (client PostgreSQL)."
  done
fi
if [ "$DA_URL" = "no" ] || [ "$STORAGE" = "si" ]; then
  command -v kubectl >/dev/null 2>&1 || uscita_uso "Manca 'kubectl'."
fi
if [ "$STORAGE" = "si" ]; then
  command -v mkfifo >/dev/null 2>&1 || uscita_uso "Manca 'mkfifo'."
fi

# ── Destinazione ────────────────────────────────────────────────
umask 077
if [ -z "$DIR" ]; then
  if [ -n "$STATE_DIR" ]; then
    DIR="$STATE_DIR/backups"
  else
    DIR="${XDG_CONFIG_HOME:-$HOME/.config}/pa-webinar/backups/$OPS_NAMESPACE-$OPS_RELEASE"
  fi
fi
case "$DIR/" in
  "$RADICE"/*) uscita_uso "--dir è dentro il repository ($RADICE): i backup contengono dati personali e non devono finirci." ;;
esac
mkdir -p "$DIR"
chmod 700 "$DIR"

NOME="$OPS_RELEASE-$(date -u +%Y%m%dT%H%M%SZ)"
PARZIALE="$DIR/.$NOME.parziale"
FINALE="$DIR/$NOME"
BLOCCO="$DIR/.backup-in-corso"
TMP="$(mktemp -d)"

STORAGE_FERMO="no"

# Lo storage fermato si riaccende sempre, anche dopo un errore o un Ctrl-C.
riprendi_storage() {
  ops_elimina_pod_copia
  if ops_riprendi_deployment "$OPS_STORAGE_DEPLOY" "$ATTESA" > "$TMP/ripresa" 2>&1; then
    STORAGE_FERMO="no"
    [ "$QUIET" = "si" ] || cat "$TMP/ripresa"
    return 0
  fi
  cat "$TMP/ripresa" >&2
  printf '✗ Lo storage %s non è ripartito. Quando il cluster risponde:\n  %s --resume --yes%s\n' \
    "$OPS_STORAGE_DEPLOY" "$RADICE/scripts/restore.sh" "$(argomenti_cluster)" >&2
  return 1
}

# Le opzioni del cluster da ripetere in un altro comando: il kubeconfig se
# c'è, il contesto se indicato (o se manca il kubeconfig), namespace e
# release se non sono i predefiniti.
argomenti_cluster() {
  [ -n "$OPS_KUBECONFIG" ] && printf ' --kubeconfig %q' "$OPS_KUBECONFIG"
  if [ "$OPS_CONTEXT_IMPLICITO" = "no" ] || [ -z "$OPS_KUBECONFIG" ]; then
    printf ' --context %q' "${OPS_CONTEXT:-<contesto>}"
  fi
  [ "$OPS_NAMESPACE" = "pa-webinar" ] || printf ' --namespace %q' "$OPS_NAMESPACE"
  [ "$OPS_RELEASE" = "pa-webinar" ] || printf ' --release %q' "$OPS_RELEASE"
  return 0
}

pulizia() {
  local codice=$? incompleto="no"
  set +e
  if [ "$STORAGE_FERMO" = "si" ]; then
    riprendi_storage || codice=1
  fi
  rm -rf "$TMP"
  if [ -d "$PARZIALE" ]; then rm -rf "$PARZIALE"; incompleto="si"; fi
  if [ "${BLOCCO_PRESO:-no}" = "si" ]; then rmdir "$BLOCCO" 2>/dev/null || true; fi
  if [ "$codice" -ne 0 ] && [ "$codice" -ne 2 ] && [ "$incompleto" = "si" ]; then
    printf '✗ Backup non riuscito: nessun file lasciato in %s.\n' "$DIR" >&2
  fi
  exit "$codice"
}
trap pulizia EXIT
trap 'exit 130' INT TERM

# Un backup alla volta per destinazione: due pg_dump insieme raddoppiano il
# carico sul database e si contendono la stessa rotazione.
if ! mkdir "$BLOCCO" 2>/dev/null; then
  fallito "Un altro backup è in corso su $DIR (se non è vero, cancella $BLOCCO)."
fi
BLOCCO_PRESO="si"
[ ! -e "$FINALE" ] || fallito "Esiste già $FINALE: riprova fra un secondo."
mkdir "$PARZIALE"

# ── Origine ─────────────────────────────────────────────────────
POD=""
if [ "$DA_URL" = "si" ]; then
  url="$(ops_leggi_database_url "$URL_FILE")"
  [ -n "$url" ] || uscita_uso "DATABASE_URL vuoto: esportalo nell'ambiente o usa --database-url-file."
  ops_esporta_database_url "$url" || uscita_uso "DATABASE_URL non è nel formato postgresql://utente:password@host:porta/database"
  url=""
  # Il cluster serve solo per il manifesto (immagine, impronte delle chiavi), e
  # si interroga solo se indicato: il contesto corrente potrebbe essere un
  # altro cluster.
  if [ -n "$OPS_CONTEXT" ] || [ -n "$OPS_KUBECONFIG" ]; then
    command -v kubectl >/dev/null 2>&1 && { ops_fissa_contesto || true; }
  fi
  if [ "$STORAGE" = "si" ] && [ -z "$OPS_CONTEXT" ]; then
    uscita_uso "--include-storage: nessun contesto nel kubeconfig indicato."
  fi
  passo "Origine: database $PGDATABASE su $PGHOST:$PGPORT (DATABASE_URL)"
else
  ops_fissa_contesto || uscita_uso "Nessun contesto kubectl: indica --kubeconfig e --context."
  POD="$(ops_pod_postgres)"
  [ -n "$POD" ] || fallito "Nessun pod PostgreSQL in esecuzione per la release $OPS_RELEASE nel namespace $OPS_NAMESPACE (contesto $OPS_CONTEXT). Database esterno? Usa --database-url."
  passo "Origine: pod $POD (namespace $OPS_NAMESPACE, contesto $OPS_CONTEXT)"
fi

# Lo storage si cerca prima di toccare qualunque cosa: chi lo chiede e non
# c'è deve saperlo subito, non dopo il dump.
if [ "$STORAGE" = "si" ]; then
  ops_trova_storage || uscita_uso "--include-storage: $OPS_STORAGE_ERRORE"
  passo "Object storage: $OPS_STORAGE_DEPLOY, volume $OPS_STORAGE_PVC"
fi

pg_query() {
  if [ -n "$POD" ]; then
    ops_pg_query "$POD" "$1"
  else
    psql -X -w -q -v ON_ERROR_STOP=1 -tA -c "$1"
  fi
}

pg_conteggi() {
  if [ -n "$POD" ]; then
    ops_pg_conteggi "$POD"
  else
    printf '%s\n' "$OPS_SQL_CONTEGGI" | psql -X -w -q -v ON_ERROR_STOP=1 -tA
  fi
}

pg_dump_custom() {
  if [ -n "$POD" ]; then
    ops_pg_exec "$POD" -- pg_dump -Fc
  else
    pg_dump -Fc -w
  fi
}

# ── Manifesto ───────────────────────────────────────────────────
passo "Manifesto"
versione_pg="$(pg_query 'SHOW server_version' 2>"$TMP/err")" || fallito "Il database non risponde: $(head -c 300 "$TMP/err")"
if [ "$STORAGE" = "si" ] && [ "$CON_DIRETTE" = "no" ]; then
  dirette="$(pg_query "SELECT count(*) FROM events WHERE status IN ('LIVE', 'PROVISIONING')" 2>/dev/null || printf '0')"
  if [ "${dirette:-0}" -gt 0 ]; then
    uscita_uso "$dirette eventi in diretta o in allestimento: fermare lo storage adesso farebbe perdere i caricamenti e le registrazioni in corso. Aspetta la fine, o --allow-live."
  fi
fi
immagine="" versione_chart="" impronta_pii="" impronta_app="" impronta_s3=""
if [ -n "$OPS_CONTEXT" ]; then
  dep="$(ops_deployment_portale 2>/dev/null | head -n 1 || true)"
  if [ -n "$dep" ]; then
    riga="$(kc get deployment "$dep" -o jsonpath='{.metadata.labels.app\.kubernetes\.io/version}{"|"}{.spec.template.spec.containers[?(@.name=="pa-webinar")].image}{"|"}{.spec.template.spec.containers[?(@.name=="pa-webinar")].envFrom[*].secretRef.name}' 2>/dev/null || true)"
    IFS='|' read -r versione_chart immagine secret_app <<< "$riga"
    secret_app="${secret_app%% *}"
    # Impronte, non valori: al ripristino dicono se il Secret in uso ha ancora
    # le stesse chiavi, senza che il manifesto contenga un segreto.
    if [ -n "${secret_app:-}" ]; then
      v="$(kc get secret "$secret_app" -o jsonpath='{.data.PII_ENCRYPTION_KEY}' 2>/dev/null | base64 -d 2>/dev/null || true)"
      [ -n "$v" ] && impronta_pii="$(printf '%s' "$v" | ops_impronta)"
      v="$(kc get secret "$secret_app" -o jsonpath='{.data.APP_SECRET}' 2>/dev/null | base64 -d 2>/dev/null || true)"
      [ -n "$v" ] && impronta_app="$(printf '%s' "$v" | ops_impronta)"
      if [ "$STORAGE" = "si" ]; then
        # La chiave con cui il portale accede allo storage: il volume salvato
        # la contiene, e al ripristino deve essere ancora quella del Secret.
        v="$(kc get secret "$secret_app" -o jsonpath='{.data.STORAGE_FILES_S3_SECRET_ACCESS_KEY}' 2>/dev/null | base64 -d 2>/dev/null || true)"
        [ -n "$v" ] && impronta_s3="$(printf '%s' "$v" | ops_impronta)"
      fi
      v=""
    fi
  fi
fi
conteggi="$(pg_conteggi 2>"$TMP/err")" || fallito "Conteggio delle righe non riuscito: $(head -c 300 "$TMP/err")"
printf '%s\n' "$conteggi" > "$TMP/conteggi.prima"
{
  printf '# Backup di PA Webinar (scripts/backup.sh). Nessun segreto in questo file.\n'
  printf 'formato=1\n'
  printf 'creato=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'contesto=%s\n' "$OPS_CONTEXT"
  printf 'namespace=%s\n' "$OPS_NAMESPACE"
  printf 'release=%s\n' "$OPS_RELEASE"
  printf 'origine=%s\n' "$([ -n "$POD" ] && printf 'pod' || printf 'database-url')"
  printf 'postgresql=%s\n' "$versione_pg"
  printf 'immagine_portale=%s\n' "$immagine"
  printf 'appversion_chart=%s\n' "$versione_chart"
  printf 'impronta_PII_ENCRYPTION_KEY=%s\n' "$impronta_pii"
  printf 'impronta_APP_SECRET=%s\n' "$impronta_app"
  if [ "$STORAGE" = "si" ]; then printf 'impronta_STORAGE_FILES_S3_SECRET_ACCESS_KEY=%s\n' "$impronta_s3"; fi
  printf 'cifratura=%s\n' "$CIFRATURA"
  printf 'file_database=database.dump%s\n' "$ESTENSIONE"
  if [ ${#INCLUDE[@]} -gt 0 ]; then printf 'file_stato=stato.tar%s\n' "$ESTENSIONE"; fi
} > "$TMP/manifest.testa"
nota "$(printf '%s\n' "$conteggi" | grep -c . || true) tabelle, PostgreSQL $versione_pg"

# ── Object storage: fermo prima del dump ────────────────────────
# Fermo per tutta la copia, database compreso: nessun file si aggiunge o si
# toglie fra il dump e l'archivio del volume, e i due restano coerenti.
if [ "$STORAGE" = "si" ]; then
  passo "Object storage: fermo $OPS_STORAGE_DEPLOY (caricamenti e riproduzioni sospesi fino alla fine)"
  STORAGE_FERMO="si"
  ops_ferma_deployment "$OPS_STORAGE_DEPLOY" "$ATTESA" \
    || fallito "Lo storage $OPS_STORAGE_DEPLOY non si ferma entro ${ATTESA}s."
fi

# ── Database ────────────────────────────────────────────────────
passo "Database (pg_dump, formato custom${ESTENSIONE:+, cifrato con $CIFRATURA})"
inizio=$(date +%s)
# Con pipefail un errore di pg_dump o di kubectl a metà flusso fa fallire il
# backup: un file troncato non resta mai come backup valido.
pg_dump_custom 2>"$TMP/err" | cifra > "$PARZIALE/database.dump$ESTENSIONE" \
  || fallito "pg_dump non riuscito: $(head -c 300 "$TMP/err")"
[ -s "$PARZIALE/database.dump$ESTENSIONE" ] || fallito "pg_dump non ha prodotto niente."
if [ "$CIFRATURA" = "nessuna" ]; then
  # Controllo dell'archivio: pg_restore ne elenca il contenuto.
  if [ "$(head -c 5 "$PARZIALE/database.dump")" != "PGDMP" ]; then
    fallito "Il file prodotto non è un archivio di pg_dump."
  fi
  if [ -n "$POD" ]; then
    voci="$(ops_pg_exec "$POD" -i -- pg_restore -l < "$PARZIALE/database.dump" 2>/dev/null | grep -c ' TABLE DATA ' || true)"
  else
    voci="$(pg_restore -l "$PARZIALE/database.dump" 2>/dev/null | grep -c ' TABLE DATA ' || true)"
  fi
  [ "${voci:-0}" -gt 0 ] || fallito "L'archivio non contiene dati di tabelle leggibili da pg_restore."
  nota "archivio verificato: $voci tabelle con dati"
fi
nota "$(du -h "$PARZIALE/database.dump$ESTENSIONE" | awk '{print $1}') in $(( $(date +%s) - inizio )) s"

# Righe per tabella, contate prima e dopo pg_dump: i lavori pianificati
# continuano a scrivere durante il backup, e una tabella cambiata nel frattempo
# si registra con l'intervallo (min-max). Il ripristino le confronta.
conteggi_dopo="$(pg_conteggi 2>"$TMP/err")" || fallito "Conteggio delle righe non riuscito: $(head -c 300 "$TMP/err")"
printf '%s\n' "$conteggi_dopo" > "$TMP/conteggi.dopo"
{
  cat "$TMP/manifest.testa"
  printf '# righe per tabella nel backup: tabella|righe, o tabella|min-max se cambiata durante il backup\n'
  awk -F'|' 'NR == FNR {prima[$1] = $2; next}
    {
      t = $1; d = $2
      if (!(t in prima)) { print "righe=" t "|0-" d; next }
      p = prima[t]
      if (p == d) print "righe=" t "|" d
      else if (p < d) print "righe=" t "|" p "-" d
      else print "righe=" t "|" d "-" p
    }' "$TMP/conteggi.prima" "$TMP/conteggi.dopo"
} > "$PARZIALE/manifest.txt"

# ── Object storage: archivio del volume ────────────────────────
# Il volume passa da un pod di appoggio come flusso tar, cifrato qui come il
# database; la somma del flusso si calcola nel pod e qui, e devono coincidere.
if [ "$STORAGE" = "si" ]; then
  passo "Object storage: volume $OPS_STORAGE_PVC${ESTENSIONE:+ (cifrato con $CIFRATURA)}"
  ops_crea_pod_copia "$ATTESA" || fallito "$OPS_STORAGE_ERRORE"
  inizio=$(date +%s)
  mkfifo "$TMP/storage.fifo"
  somma_sha256 < "$TMP/storage.fifo" > "$TMP/storage.somma" &
  pid_somma=$!
  esito_copia=0
  ops_exec_copia "$OPS_SCRIPT_ARCHIVIA" 2>"$TMP/storage.err" | tee "$TMP/storage.fifo" | cifra > "$PARZIALE/storage.tar$ESTENSIONE" \
    || esito_copia=$?
  wait "$pid_somma" || true
  read -r _ rc_tar somma_pod byte_pod <<< "$(grep '^pa-webinar-copia ' "$TMP/storage.err" | tail -n 1 || true)"
  somma_qui="$(awk '{print $1}' "$TMP/storage.somma")"
  if [ "${rc_tar:-}" != "0" ]; then
    fallito "Archivio del volume non riuscito (tar: ${rc_tar:-nessun esito}): $(grep -v '^pa-webinar-copia ' "$TMP/storage.err" | head -c 300)"
  fi
  [ "$esito_copia" -eq 0 ] || fallito "Copia del volume interrotta (codice $esito_copia): $(grep -v '^pa-webinar-copia ' "$TMP/storage.err" | head -c 300)"
  if [ -z "$somma_pod" ] || [ "$somma_pod" != "$somma_qui" ]; then
    fallito "Copia del volume incompleta: la somma letta nel pod non è quella arrivata qui."
  fi
  nota "$(du -h "$PARZIALE/storage.tar$ESTENSIONE" | awk '{print $1}') in $(( $(date +%s) - inizio )) s, somma verificata"
  {
    printf 'file_storage=storage.tar%s\n' "$ESTENSIONE"
    printf 'storage_deployment=%s\n' "$OPS_STORAGE_DEPLOY"
    printf 'storage_volume=%s\n' "$OPS_STORAGE_PVC"
    printf 'storage_sha256=%s\n' "$somma_pod"
    printf 'storage_byte=%s\n' "$byte_pod"
  } >> "$PARZIALE/manifest.txt"
  passo "Object storage: riavvio"
  # Il backup è completo anche se lo storage tarda: lo si conserva, e l'esito
  # finale lo dice.
  if ! riprendi_storage; then
    STORAGE_FERMO="no"
    STORAGE_NON_PRONTO="si"
  fi
fi

# ── Stato dell'installazione ────────────────────────────────────
if [ ${#INCLUDE[@]} -gt 0 ]; then
  passo "Stato dell'installazione"
  mkdir "$TMP/stato"
  escludi=()
  n=0
  for p in "${INCLUDE[@]}"; do
    n=$((n + 1))
    base="$(basename "$p")"
    [ -e "$TMP/stato/$base" ] && base="$n-$base"
    ln -s "$p" "$TMP/stato/$base"
    # La cartella dei backup non entra in se stessa.
    case "$DIR/" in
      "$p"/*) escludi+=("--exclude=./$base/${DIR#"$p"/}") ;;
    esac
    nota "$p"
  done
  tar -chf - -C "$TMP/stato" ${escludi[@]+"${escludi[@]}"} . 2>"$TMP/err" | cifra > "$PARZIALE/stato.tar$ESTENSIONE" \
    || fallito "Archivio dello stato non riuscito: $(head -c 300 "$TMP/err")"
fi

# ── Somme di controllo e rotazione ──────────────────────────────
( cd "$PARZIALE" && somma_sha256 ./* > SHA256SUMS )
chmod 600 "$PARZIALE"/*
mv "$PARZIALE" "$FINALE"

if [ "$KEEP" -gt 0 ]; then
  vecchi="$(find "$DIR" -mindepth 1 -maxdepth 1 -type d -name "$OPS_RELEASE-[0-9]*T[0-9]*Z" 2>/dev/null \
    | while read -r d; do [ -f "$d/manifest.txt" ] && printf '%s\n' "$d"; done | sort \
    | awk -v k="$KEEP" '{r[NR] = $0} END {for (i = 1; i <= NR - k; i++) print r[i]}' || true)"
  if [ -n "$vecchi" ]; then
    while read -r d; do
      rm -rf "$d"
      nota "cancellato il backup precedente $(basename "$d")"
    done <<< "$vecchi"
  fi
fi

if [ "$QUIET" = "no" ]; then
  printf '\n✓ Backup in %s\n' "$FINALE"
  for f in "$FINALE"/*; do
    printf '   %6s  %s\n' "$(du -h "$f" | awk '{print $1}')" "$(basename "$f")"
  done
  printf '\n'
  # Dove sta la copia rispetto ai dati: sullo stesso server va portata
  # altrove; dalla postazione è già fuori.
  dove=2
  if [ -n "$POD" ] || [ "$STORAGE" = "si" ]; then
    ops_cluster_su_questa_macchina && dove=0 || dove=$?
  else
    case "$PGHOST" in
      localhost|127.*|::1|/*) dove=0 ;;
      *) if ops_ip_locali | grep -Fxq -- "$PGHOST"; then dove=0; else dove=1; fi ;;
    esac
  fi
  case "$dove" in
    0)
      printf '  Questa copia sta sulla stessa macchina dei dati: copiala altrove, per esempio\n'
      printf "    rsync -a '%s' <utente>@<server-backup>:<cartella>/\n" "$FINALE" ;;
    1)
      printf '  Copia fuori dal server dei dati. Conservala al sicuro (è la sola, se il\n'
      printf '  server si perde), con la chiave per leggerla in un posto diverso.\n' ;;
    *)
      printf '  Se questa macchina è il server dei dati, copia il backup altrove, per esempio\n'
      printf "    rsync -a '%s' <utente>@<server-backup>:<cartella>/\n" "$FINALE" ;;
  esac
  if [ "$STORAGE" = "no" ]; then
    printf '  L'"'"'object storage (registrazioni, materiali) non è compreso%s.\n' \
      "$( [ "$DA_URL" = "no" ] && ops_trova_storage 2>/dev/null && printf ': aggiungi --include-storage' )"
  fi
  if [ "$CIFRATURA" = "nessuna" ]; then
    printf '  I file NON sono cifrati: contengono dati personali%s.\n' "$([ ${#INCLUDE[@]} -gt 0 ] && printf " e le chiavi dell'installazione")"
    printf '  Usa --age-recipient o --gpg-recipient per cifrarli.\n'
  fi
  # Il comando di ripristino con le stesse opzioni del cluster: prima la prova.
  comando="$RADICE/scripts/restore.sh --from $(printf '%q' "$FINALE")$(argomenti_cluster)"
  if [ "$DA_URL" = "si" ]; then
    if [ -n "$URL_FILE" ] && [ "$URL_FILE" != "-" ]; then
      comando+=" --database-url-file $(printf '%q' "$URL_FILE")"
    else
      comando+=" --database-url"
    fi
  fi
  [ "$CIFRATURA" = "age" ] && comando+=" --identity <file-della-chiave-age>"
  [ "$STORAGE" = "si" ] && comando+=" --include-storage"
  printf '  Per provare il ripristino (non cambia niente):\n    %s --dry-run\n' "$comando"
fi
if [ "${STORAGE_NON_PRONTO:-no}" = "si" ]; then
  printf '✗ Backup completo, ma lo storage %s non è tornato pronto: controllalo.\n' "$OPS_STORAGE_DEPLOY" >&2
  exit 1
fi
