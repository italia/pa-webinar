#!/usr/bin/env bash
#
# Ripristina un'installazione di PA Webinar da un backup di scripts/backup.sh
# (il database e, a richiesta, l'object storage su volume), fermando prima chi
# ci scrive:
#
#   1. controlla il backup (somme, cifratura, chiavi dell'installazione);
#   2. sospende ogni lavoro pianificato della release (recordings-reconcile
#      compreso) e aspetta quelli in corso;
#   3. porta a zero il portale, il controller del registratore e, con
#      --include-storage, lo storage;
#   4. con --include-storage, estrae il volume salvato accanto a quello
#      attuale, senza toccarlo, e ne verifica la somma;
#   5. ripristina il database in un'unica transazione: o tutto o niente;
#   6. con --include-storage, sostituisce il contenuto del volume con quello
#      estratto;
#   7. confronta le righe con il manifesto del backup;
#   8. spegne la cancellazione automatica delle registrazioni orfane;
#   9. riaccende lo storage, il portale, il controller e i lavori
#      (recordings-reconcile per ultimo), come erano prima;
#  10. lancia scripts/verify-install.sh.
#
# Se qualcosa si interrompe dal punto 2 in poi, lo script rimette repliche e
# lavori come li ha trovati. Lo stato di partenza sta in annotazioni sugli
# oggetti stessi, così anche un'interruzione brusca si recupera con --resume.
#
# Uso:  scripts/restore.sh --from <cartella del backup> --context <contesto> --yes
#       scripts/restore.sh --reset-orphan-grace <giorni> --context <contesto>
#       (--help per l'elenco)
#
# Esce con 0 se il ripristino e la verifica riescono, 1 se no, 2 per opzioni
# sbagliate o controlli preliminari non superati (in quel caso non ha toccato
# niente).

set -euo pipefail

RADICE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib/ops-common.sh
source "$RADICE/scripts/lib/ops-common.sh"

DA=""
DUMP=""
SI="no"
PROVA="no"
RIPRENDI="no"
DA_URL="no"
URL_FILE=""
IDENTITA=""
MODO="schema"
TIENI_GRAZIA="no"
CHIAVI_DIVERSE="no"
CON_DIRETTE="no"
ATTESA=300
STORAGE="no"
CA_FILE=""
NUOVA_GRAZIA=""
VERIFICA=()

ANN_SOSPESO="pa-webinar/restore-suspend"

uso() {
  cat <<'FINE'
Uso: scripts/restore.sh --from DIR|--from-dump FILE --context NOME [opzioni] [-- opzioni di verify-install.sh]
     scripts/restore.sh --reset-orphan-grace GIORNI --context NOME [opzioni del cluster]

Ripristina il database di PA Webinar (e, a richiesta, l'object storage) da un
backup di scripts/backup.sh, fermando portale e lavori pianificati durante il
ripristino e riaccendendoli dopo, nell'ordine giusto. Senza --yes non cambia
niente.

Backup (uno dei due)
  --from DIR              cartella di un backup (con manifest.txt e SHA256SUMS)
  --from-dump FILE        un archivio di pg_dump -Fc senza manifesto, per esempio
                          uno del CronJob di backup del chart copiato fuori dal
                          nodo (.dump, o .dump.age / .dump.gpg se cifrato): niente
                          somme, impronte delle chiavi né conteggi da confrontare
  --identity FILE         identità age per decifrare (gpg usa il suo agente)
  --include-storage       ripristina anche l'object storage su volume (l'add-on
                          Garage), se il backup lo contiene (backup.sh
                          --include-storage): prima il database, poi il volume;
                          recordings-reconcile resta sospeso finché non sono
                          tornati entrambi. Il volume deve avere spazio libero
                          pari all'archivio: quello attuale si cancella solo
                          dopo che il nuovo è estratto e verificato
  --storage-selector SEL  etichette del Deployment dello storage (predefinito:
                          app.kubernetes.io/name=garage,
                          app.kubernetes.io/instance=<release>)

Cluster: kubeconfig o contesto vanno indicati, il contesto corrente non basta
  --kubeconfig FILE       es. /etc/rancher/k3s/k3s.yaml sul nodo k3s
  --context NOME
  --namespace NOME        predefinito: pa-webinar
  --release NOME          release Helm, predefinito: pa-webinar

Database esterno (predefinito: il PostgreSQL del chart, dal suo pod)
  --database-url          usa DATABASE_URL dall'ambiente, con psql e pg_restore
                          di questa macchina
  --database-url-file F   legge DATABASE_URL dal file F ("-" = standard input)

Esecuzione
  --dry-run               controlla backup e installazione e mostra il piano,
                          senza cambiare niente
  --yes                   esegue il ripristino (obbligatorio)
  --resume                solo la ripresa di un ripristino (o di un backup
                          con --include-storage) interrotto: rimette repliche
                          e lavori come erano, poi verifica
  --reset-orphan-grace N  solo questo: rimette a N giorni (0-365)
                          orphanRecordingGraceDays, che il ripristino porta a
                          0. Da lanciare dopo aver controllato le registrazioni
                          orfane (Registrazioni video > Orfane); non chiede
                          --yes, con --dry-run mostra solo il valore attuale
  --clean-mode MODO       schema (predefinito): svuota lo schema public e
                          ricrea tutto, nella stessa transazione; vale anche
                          se il database è già a una versione più recente
                          del backup. objects: pg_restore --clean --if-exists,
                          per chi non è proprietario dello schema
  --keep-orphan-grace     non spegnere la cancellazione delle registrazioni
                          orfane (solo se l'object storage è stato riportato
                          allo stesso momento del database)
  --allow-key-mismatch    procede anche se PII_ENCRYPTION_KEY, APP_SECRET o la
                          chiave dello storage del Secret non sono quelle del
                          backup (i dati cifrati diventerebbero illeggibili)
  --allow-live            procede anche con eventi in diretta o in allestimento
  --timeout S             attesa massima per lavori e pod (predefinito: 300)

Verifica finale (scripts/verify-install.sh, con le stesse opzioni del cluster
e --keys-from-cluster)
  --ca-file FILE          autorità con cui verificare i certificati. Predefinito,
                          se --kubeconfig è nella cartella di stato di
                          pa-webinar-up.sh: il suo ca.crt (--tls private-ca) o
                          extra-ca.crt
  -- ...                  il resto va a verify-install.sh, per esempio
                          -- --resolve 203.0.113.10 --call
  -h, --help              questo aiuto

Esempi
  # dalla postazione, installazione di pa-webinar-up.sh
  scripts/restore.sh --kubeconfig ~/.config/pa-webinar/k3s/<nome>/kubeconfig \
    --from ~/.config/pa-webinar/k3s/<nome>/backups/pa-webinar-20260101T023000Z \
    --identity ~/chiave-age.txt --include-storage --dry-run
  # nodo k3s
  scripts/restore.sh --kubeconfig /etc/rancher/k3s/k3s.yaml \
    --from /root/.config/pa-webinar/k3s/pa-webinar/backups/pa-webinar-20260101T023000Z \
    --identity /root/backup-key.txt --dry-run
FINE
}

uscita_uso() {
  printf '✗ %s\n' "$*" >&2
  exit 2
}

passo() {
  printf '\n── %s\n' "$*"
}

nota() {
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
    --from) DA="$(percorso_assoluto "${2:?--from vuole una cartella}")"; shift 2 ;;
    --from-dump) DUMP="$(percorso_assoluto "${2:?--from-dump vuole un file}")"; shift 2 ;;
    --identity) IDENTITA="${2:?--identity vuole un file}"; shift 2 ;;
    --include-storage) STORAGE="si"; shift ;;
    --storage-selector) OPS_STORAGE_SELETTORE="${2:?--storage-selector vuole delle etichette}"; shift 2 ;;
    --kubeconfig) OPS_KUBECONFIG="${2:?--kubeconfig vuole un file}"; shift 2 ;;
    --context) OPS_CONTEXT="${2:?--context vuole un nome}"; shift 2 ;;
    --namespace) OPS_NAMESPACE="${2:?--namespace vuole un nome}"; shift 2 ;;
    --release) OPS_RELEASE="${2:?--release vuole un nome}"; shift 2 ;;
    --database-url) DA_URL="si"; shift ;;
    --database-url-file) DA_URL="si"; URL_FILE="${2:?--database-url-file vuole un file}"; shift 2 ;;
    --dry-run) PROVA="si"; shift ;;
    --yes) SI="si"; shift ;;
    --resume) RIPRENDI="si"; shift ;;
    --reset-orphan-grace) NUOVA_GRAZIA="${2:?--reset-orphan-grace vuole un numero di giorni}"; shift 2 ;;
    --clean-mode) MODO="${2:?--clean-mode vuole schema o objects}"; shift 2 ;;
    --keep-orphan-grace) TIENI_GRAZIA="si"; shift ;;
    --allow-key-mismatch) CHIAVI_DIVERSE="si"; shift ;;
    --allow-live) CON_DIRETTE="si"; shift ;;
    --timeout) ATTESA="${2:?--timeout vuole dei secondi}"; shift 2 ;;
    --ca-file) CA_FILE="$(percorso_assoluto "${2:?--ca-file vuole un file}")"; shift 2 ;;
    --) shift; VERIFICA=("$@"); break ;;
    -h|--help) uso; exit 0 ;;
    *) uscita_uso "Opzione sconosciuta: $1 (--help per l'elenco)" ;;
  esac
done

case "$MODO" in schema|objects) ;; *) uscita_uso "--clean-mode vuole schema o objects (non '$MODO')." ;; esac
[[ "$ATTESA" =~ ^[0-9]+$ ]] || uscita_uso "--timeout vuole un numero di secondi."
# Il ripristino sostituisce un database: il bersaglio si dichiara, non si
# eredita dal contesto corrente di chi lancia.
if [ -z "$OPS_CONTEXT" ] && [ -z "$OPS_KUBECONFIG" ]; then
  uscita_uso "Indica --context o --kubeconfig: il ripristino non agisce sul contesto corrente per default."
fi
if [ -n "$NUOVA_GRAZIA" ]; then
  [[ "$NUOVA_GRAZIA" =~ ^[0-9]+$ ]] && [ "$NUOVA_GRAZIA" -le 365 ] \
    || uscita_uso "--reset-orphan-grace vuole un numero di giorni fra 0 e 365 (non '$NUOVA_GRAZIA')."
  [ -z "$DA" ] && [ -z "$DUMP" ] && [ "$RIPRENDI" = "no" ] && [ "$STORAGE" = "no" ] \
    || uscita_uso "--reset-orphan-grace fa solo questo: non si combina con --from, --from-dump, --resume o --include-storage."
elif [ "$RIPRENDI" = "no" ]; then
  [ -n "$DA" ] || [ -n "$DUMP" ] || uscita_uso "Manca --from <cartella del backup> (o --from-dump <file>)."
  [ -z "$DA" ] || [ -z "$DUMP" ] || uscita_uso "--from e --from-dump sono alternativi."
  [ -z "$DA" ] || [ -d "$DA" ] || uscita_uso "--from: $DA non è una cartella."
  [ -z "$DUMP" ] || [ -r "$DUMP" ] || uscita_uso "--from-dump: $DUMP non leggibile."
  [ "$STORAGE" = "no" ] || [ -z "$DUMP" ] \
    || uscita_uso "--include-storage vuole un backup di scripts/backup.sh (--from): un archivio di pg_dump contiene solo il database."
fi
[ -z "$IDENTITA" ] || [ -r "$IDENTITA" ] || uscita_uso "--identity: $IDENTITA non leggibile."
[ -z "$CA_FILE" ] || [ -r "$CA_FILE" ] || uscita_uso "--ca-file: $CA_FILE non leggibile."

for c in kubectl openssl awk; do
  command -v "$c" >/dev/null 2>&1 || uscita_uso "Manca '$c'."
done
if [ "$DA_URL" = "si" ]; then
  for c in psql pg_restore; do
    command -v "$c" >/dev/null 2>&1 || uscita_uso "Con --database-url serve '$c' su questa macchina (client PostgreSQL)."
  done
fi

umask 077
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── Bersaglio ───────────────────────────────────────────────────
ops_fissa_contesto || uscita_uso "Nessun contesto nel kubeconfig indicato."
kc_cluster get namespace "$OPS_NAMESPACE" >/dev/null 2>"$TMP/err" \
  || { uscita_uso "Namespace $OPS_NAMESPACE non raggiungibile nel contesto $OPS_CONTEXT: $(head -c 300 "$TMP/err")"; }

printf 'Installazione: release %s, namespace %s\n' "$OPS_RELEASE" "$OPS_NAMESPACE"
printf 'Cluster:       contesto %s (%s)\n' "$OPS_CONTEXT" "$(ops_server_api)"

# Le opzioni del cluster da ripetere in un altro comando: il kubeconfig se
# indicato, il contesto se indicato (o se manca il kubeconfig), namespace e
# release se non sono i predefiniti.
argomenti_cluster() {
  [ -n "$OPS_KUBECONFIG" ] && printf ' --kubeconfig %q' "$OPS_KUBECONFIG"
  if [ "$OPS_CONTEXT_IMPLICITO" = "no" ] || [ -z "$OPS_KUBECONFIG" ]; then
    printf ' --context %q' "$OPS_CONTEXT"
  fi
  [ "$OPS_NAMESPACE" = "pa-webinar" ] || printf ' --namespace %q' "$OPS_NAMESPACE"
  [ "$OPS_RELEASE" = "pa-webinar" ] || printf ' --release %q' "$OPS_RELEASE"
  if [ "$DA_URL" = "si" ]; then
    if [ -n "$URL_FILE" ] && [ "$URL_FILE" != "-" ]; then
      printf ' --database-url-file %q' "$URL_FILE"
    else
      printf ' --database-url'
    fi
  fi
  return 0
}

# ── Database di destinazione ────────────────────────────────────
POD=""
trova_database() {
  if [ "$DA_URL" = "si" ]; then
    local url
    url="$(ops_leggi_database_url "$URL_FILE")"
    [ -n "$url" ] || { uscita_uso "DATABASE_URL vuoto: esportalo nell'ambiente o usa --database-url-file."; }
    ops_esporta_database_url "$url" || { uscita_uso "DATABASE_URL non è nel formato postgresql://utente:password@host:porta/database"; }
    url=""
    nota "destinazione: database $PGDATABASE su $PGHOST:$PGPORT (DATABASE_URL)"
  else
    POD="$(ops_pod_postgres)"
    [ -n "$POD" ] || { uscita_uso "Nessun pod PostgreSQL in esecuzione per la release $OPS_RELEASE (database esterno? --database-url)."; }
    nota "destinazione: pod $POD"
  fi
}

pg_query() {
  if [ -n "$POD" ]; then ops_pg_query "$POD" "$1"; else psql -X -w -q -v ON_ERROR_STOP=1 -tA -c "$1"; fi
}
pg_conteggi() {
  if [ -n "$POD" ]; then ops_pg_conteggi "$POD"; else printf '%s\n' "$OPS_SQL_CONTEGGI" | psql -X -w -q -v ON_ERROR_STOP=1 -tA; fi
}

# ── Solo la grazia delle registrazioni orfane ───────────────────
# Il ripristino la porta a 0 (elencare, non cancellare): si rimette al valore
# di prima quando le orfane sono state controllate.
if [ -n "$NUOVA_GRAZIA" ]; then
  passo "orphanRecordingGraceDays"
  trova_database
  attuale="$(pg_query "SELECT orphan_recording_grace_days FROM site_settings ORDER BY id LIMIT 1" 2>"$TMP/err")" \
    || { printf '✗ Impostazioni non leggibili: %s\n' "$(head -c 300 "$TMP/err")" >&2; exit 1; }
  if [ -z "$attuale" ]; then
    nota "nessuna impostazione salvata: il portale usa il predefinito (30 giorni) e la crea al primo accesso"
    exit 0
  fi
  nota "valore attuale: $attuale giorni$([ "$attuale" = "0" ] && printf ' (le registrazioni orfane si elencano, non si cancellano)')"
  if [ "$PROVA" = "si" ]; then
    printf '\n✓ Prova: niente è stato cambiato (lo stesso comando senza --dry-run lo porta a %s).\n' "$NUOVA_GRAZIA"
    exit 0
  fi
  if [ "$attuale" = "$NUOVA_GRAZIA" ]; then
    printf '\n✓ Già %s giorni: niente da cambiare.\n' "$NUOVA_GRAZIA"
    exit 0
  fi
  pg_query "UPDATE site_settings SET orphan_recording_grace_days = $NUOVA_GRAZIA" >/dev/null 2>"$TMP/err" \
    || { printf '✗ Impostazione non cambiata: %s\n' "$(head -c 300 "$TMP/err")" >&2; exit 1; }
  if [ "$NUOVA_GRAZIA" = "0" ]; then
    printf '\n✓ orphanRecordingGraceDays da %s a 0: le registrazioni orfane si elencano, non si cancellano.\n' "$attuale"
  else
    printf '\n✓ orphanRecordingGraceDays da %s a %s: recordings-reconcile cancella le orfane dopo %s giorni\n' "$attuale" "$NUOVA_GRAZIA" "$NUOVA_GRAZIA"
    printf '  (tranne quelle segnate con Conserva).\n'
  fi
  exit 0
fi

DEPLOYMENT="$(ops_deployment_portale)"
[ -n "$DEPLOYMENT" ] || { uscita_uso "Nessun Deployment del portale per la release $OPS_RELEASE."; }
[ "$(printf '%s\n' "$DEPLOYMENT" | wc -l)" -eq 1 ] || { uscita_uso "Più Deployment del portale per la release $OPS_RELEASE."; }
CONTROLLER="$(ops_deployment_controller)"
SCRITTORI=("$DEPLOYMENT")
[ -n "$CONTROLLER" ] && SCRITTORI+=("$CONTROLLER")

# Lo storage su volume, se c'è: con --include-storage deve esserci; senza, la
# ripresa lo considera comunque (un backup o un ripristino interrotto può
# averlo lasciato fermo).
STORAGE_DEPLOY=""
if ops_trova_storage; then
  STORAGE_DEPLOY="$OPS_STORAGE_DEPLOY"
elif [ "$STORAGE" = "si" ]; then
  uscita_uso "--include-storage: $OPS_STORAGE_ERRORE"
fi

cronjob_della_release() {
  kc get cronjob -l "app.kubernetes.io/instance=$OPS_RELEASE" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true
}

annotazione() {
  # Uso: annotazione TIPO NOME CHIAVE -> valore (vuoto se assente)
  kc get "$1" "$2" -o jsonpath="{.metadata.annotations.${3//./\\.}}" 2>/dev/null || true
}

# ── Ripresa: repliche e lavori come erano ───────────────────────
# Vero quando il database è tornato ma lo storage no: recordings-reconcile
# non riparte, altrimenti confronterebbe il database con uno storage a metà.
RECONCILE_FERMO="no"
riprendi() {
  local d c ultimi=() fallita="no"
  passo "Ripresa: storage, portale e lavori come prima"
  # Prima lo storage (senza il pod di appoggio, che ne monta il volume), poi
  # chi lo usa.
  if [ -n "$STORAGE_DEPLOY" ]; then
    OPS_STORAGE_DEPLOY="$STORAGE_DEPLOY"
    ops_elimina_pod_copia
    ops_riprendi_deployment "$STORAGE_DEPLOY" "$ATTESA" || fallita="si"
  fi
  for d in ${SCRITTORI[@]+"${SCRITTORI[@]}"}; do
    ops_riprendi_deployment "$d" "$ATTESA" || fallita="si"
  done
  # recordings-reconcile per ultimo: cancella dall'object storage ciò che il
  # database non cita più.
  while read -r c; do
    [ -n "$c" ] || continue
    case "$c" in *-recordings-reconcile) ultimi+=("$c"); continue ;; esac
    riprendi_cronjob "$c" || fallita="si"
  done < <(cronjob_della_release)
  for c in ${ultimi[@]+"${ultimi[@]}"}; do
    if [ "$RECONCILE_FERMO" = "si" ]; then
      nota "$c: resta sospeso finché lo storage non torna (rilancia il ripristino)"
      continue
    fi
    riprendi_cronjob "$c" || fallita="si"
  done
  [ "$fallita" = "no" ]
}

riprendi_cronjob() {
  local c="$1" s
  s="$(annotazione cronjob "$c" "$ANN_SOSPESO")"
  [ -n "$s" ] || return 0
  [ "$s" = "true" ] || s="false"
  kc patch cronjob "$c" --type=merge -p "{\"spec\":{\"suspend\":$s}}" >/dev/null || return 1
  kc annotate cronjob "$c" "$ANN_SOSPESO-" >/dev/null
  if [ "$s" = "true" ]; then nota "$c: resta sospeso, com'era"; else nota "$c: ripreso"; fi
}

# ── Verifica finale ─────────────────────────────────────────────
# L'autorità dei certificati: quella indicata, o quella della cartella di
# stato di pa-webinar-up.sh in cui sta il kubeconfig (la stessa che usa
# l'installazione per i suoi controlli).
ca_predefinita() {
  local d tls
  [ -n "$OPS_KUBECONFIG" ] || return 0
  d="$(cd "$(dirname "$OPS_KUBECONFIG")" 2>/dev/null && pwd)" || return 0
  [ -r "$d/install.conf" ] || return 0
  tls="$(sed -n 's/^TLS=//p' "$d/install.conf" | head -n 1)"
  if [ "$tls" = "private-ca" ] && [ -r "$d/ca.crt" ]; then
    printf '%s' "$d/ca.crt"
  elif [ -s "$d/extra-ca.crt" ]; then
    printf '%s' "$d/extra-ca.crt"
  fi
  return 0
}

# Un'opzione è già fra quelle passate dopo "--"?
in_verifica() {
  local a o
  for a in ${VERIFICA[@]+"${VERIFICA[@]}"}; do
    for o in "$@"; do [ "$a" = "$o" ] && return 0; done
  done
  return 1
}

VERIFICA_BASE=(--namespace "$OPS_NAMESPACE" --release "$OPS_RELEASE" --context "$OPS_CONTEXT")
[ -n "$OPS_KUBECONFIG" ] && VERIFICA_BASE+=(--kubeconfig "$OPS_KUBECONFIG")
# La chiave dell'istanza dal Secret: serve a leggere lo stato dei componenti
# se la pagina di stato non è pubblica, e alla prova di chiamata (--call).
if ! in_verifica --secrets-file --keys-from-cluster --no-cluster; then
  VERIFICA_BASE+=(--keys-from-cluster)
fi
[ -n "$CA_FILE" ] || CA_FILE="$(ca_predefinita)"
if [ -n "$CA_FILE" ] && ! in_verifica --ca-file --insecure; then
  VERIFICA_BASE+=(--ca-file "$CA_FILE")
fi

verifica() {
  passo "Verifica (scripts/verify-install.sh)"
  [ -n "$CA_FILE" ] && ! in_verifica --ca-file --insecure && nota "certificati verificati con $CA_FILE"
  "$RADICE/scripts/verify-install.sh" "${VERIFICA_BASE[@]}" ${VERIFICA[@]+"${VERIFICA[@]}"}
}

if [ "$RIPRENDI" = "si" ]; then
  [ "$SI" = "si" ] || { uscita_uso "--resume cambia repliche e lavori: aggiungi --yes."; }
  esito=0
  riprendi || esito=1
  verifica || esito=1
  exit "$esito"
fi

# ── Backup ──────────────────────────────────────────────────────
MANIFESTO=""
campo() {
  [ -n "$MANIFESTO" ] || return 0
  sed -n "s/^$1=//p" "$MANIFESTO" | head -n 1
}
if [ -n "$DUMP" ]; then
  passo "Archivio: $DUMP"
  FILE_DB="$DUMP"
  case "$DUMP" in
    *.age) CIFRATURA="age" ;;
    *.gpg) CIFRATURA="gpg" ;;
    *) CIFRATURA="nessuna" ;;
  esac
  nota "senza manifesto: integrità, chiavi e righe non si possono confrontare"
else
  passo "Backup: $DA"
  MANIFESTO="$DA/manifest.txt"
  [ -r "$MANIFESTO" ] || { uscita_uso "Manca $MANIFESTO: non è una cartella di scripts/backup.sh (per un archivio da solo: --from-dump)."; }
  [ "$(campo formato)" = "1" ] || { uscita_uso "Formato del backup sconosciuto: $(campo formato)."; }
  FILE_DB="$DA/$(campo file_database)"
  CIFRATURA="$(campo cifratura)"
  [ -r "$FILE_DB" ] || { uscita_uso "Manca il file del database: $FILE_DB."; }
fi
FILE_STORAGE=""
if [ "$STORAGE" = "si" ]; then
  [ -n "$(campo file_storage)" ] \
    || uscita_uso "--include-storage: questo backup non contiene l'object storage (è stato fatto senza backup.sh --include-storage)."
  FILE_STORAGE="$DA/$(campo file_storage)"
  [ -r "$FILE_STORAGE" ] || uscita_uso "Manca il file dello storage: $FILE_STORAGE."
  [[ "$(campo storage_byte)" =~ ^[0-9]+$ ]] && [ -n "$(campo storage_sha256)" ] \
    || uscita_uso "Il manifesto non ha la dimensione e la somma dello storage (storage_byte, storage_sha256)."
fi

if [ -n "$DUMP" ]; then
  :
elif [ -r "$DA/SHA256SUMS" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$DA" && sha256sum -c --quiet SHA256SUMS) >"$TMP/err" 2>&1 || { uscita_uso "Somme di controllo diverse: backup alterato o incompleto ($(head -c 200 "$TMP/err" | tr '\n' ' '))."; }
  else
    (cd "$DA" && shasum -a 256 -c --quiet SHA256SUMS) >"$TMP/err" 2>&1 || { uscita_uso "Somme di controllo diverse: backup alterato o incompleto ($(head -c 200 "$TMP/err" | tr '\n' ' '))."; }
  fi
  nota "somme di controllo: corrispondono"
else
  nota "ATTENZIONE: nessun SHA256SUMS, integrità non verificabile"
fi

decifra() {
  case "$CIFRATURA" in
    age)
      if [ -n "$IDENTITA" ]; then age -d -i "$IDENTITA"; else age -d; fi ;;
    gpg) gpg --batch --quiet --decrypt ;;
    *) cat ;;
  esac
}
case "$CIFRATURA" in
  nessuna) ;;
  age) command -v age >/dev/null 2>&1 || { uscita_uso "Il backup è cifrato con age: manca 'age'."; }
       [ -n "$IDENTITA" ] || { uscita_uso "Il backup è cifrato con age: indica --identity."; } ;;
  gpg) command -v gpg >/dev/null 2>&1 || { uscita_uso "Il backup è cifrato con gpg: manca 'gpg'."; } ;;
  *) uscita_uso "Cifratura sconosciuta nel manifesto: $CIFRATURA." ;;
esac
inizio_archivio="$( (decifra < "$FILE_DB" | head -c 5) 2>/dev/null || true)"
[ "$inizio_archivio" = "PGDMP" ] || { uscita_uso "$FILE_DB non si decifra in un archivio di pg_dump (chiave giusta?)."; }
nota "archivio: leggibile${CIFRATURA:+ (cifratura: $CIFRATURA)}"
if [ -n "$FILE_STORAGE" ]; then
  # Un archivio tar ha "ustar" al byte 257 del primo blocco.
  firma_tar="$( (decifra < "$FILE_STORAGE" | head -c 262 | tail -c 5) 2>/dev/null || true)"
  [ "$firma_tar" = "ustar" ] || { uscita_uso "$FILE_STORAGE non si decifra in un archivio tar (chiave giusta?)."; }
  nota "storage: leggibile, $(awk -v b="$(campo storage_byte)" 'BEGIN {printf "%.1f", b / 1048576}') MiB dal Deployment $(campo storage_deployment)"
fi
if [ -n "$MANIFESTO" ]; then
  nota "creato il $(campo creato) da release $(campo release), namespace $(campo namespace), immagine $(campo immagine_portale)"
  if [ "$(campo release)" != "$OPS_RELEASE" ] || [ "$(campo namespace)" != "$OPS_NAMESPACE" ]; then
    nota "ATTENZIONE: il backup viene da un'altra installazione (release o namespace diversi)"
  fi
fi

trova_database
pg_query 'SELECT 1' >/dev/null 2>"$TMP/err" || { uscita_uso "Il database di destinazione non risponde: $(head -c 300 "$TMP/err")"; }

# ── Chiavi dell'installazione ───────────────────────────────────
# Le colonne cifrate (PII_ENCRYPTION_KEY) e le impronte delle email
# (APP_SECRET) si leggono solo con le stesse chiavi del backup; il volume
# dello storage contiene la chiave S3 del portale, che deve essere ancora
# quella del Secret.
SECRET_APP="$(kc get deployment "$DEPLOYMENT" -o jsonpath='{.spec.template.spec.containers[?(@.name=="pa-webinar")].envFrom[*].secretRef.name}' | awk '{print $1}')"
chiavi_ok="si"
chiavi=(PII_ENCRYPTION_KEY APP_SECRET)
[ "$STORAGE" = "si" ] && chiavi+=(STORAGE_FILES_S3_SECRET_ACCESS_KEY)
for k in "${chiavi[@]}"; do
  atteso="$(campo "impronta_$k")"
  if [ -z "$atteso" ]; then
    nota "$k: impronta non registrata nel backup, confronto saltato"
    continue
  fi
  v="$(kc get secret "$SECRET_APP" -o jsonpath="{.data.$k}" 2>/dev/null | base64 -d 2>/dev/null || true)"
  if [ -z "$v" ]; then
    nota "$k: non leggibile dal Secret $SECRET_APP, confronto saltato"
    continue
  fi
  if [ "$(printf '%s' "$v" | ops_impronta)" = "$atteso" ]; then
    nota "$k: la stessa del backup"
  else
    nota "$k: DIVERSA da quella del backup"
    chiavi_ok="no"
  fi
done
v=""
if [ "$chiavi_ok" = "no" ] && [ "$CHIAVI_DIVERSE" = "no" ]; then
  uscita_uso "Il Secret $SECRET_APP non ha le chiavi del backup: con queste i dati cifrati (o lo storage ripristinato) sarebbero illeggibili.
  Rimetti nel Secret le chiavi dello stato salvato insieme al backup (stato.tar), oppure,
  sapendo cosa comporta, --allow-key-mismatch."
fi

# ── Eventi in corso ─────────────────────────────────────────────
dirette="$(pg_query "SELECT count(*) FROM events WHERE status IN ('LIVE', 'PROVISIONING')" 2>/dev/null || printf '0')"
if [ "${dirette:-0}" -gt 0 ] && [ "$CON_DIRETTE" = "no" ]; then
  uscita_uso "$dirette eventi in diretta o in allestimento: il ripristino li interromperebbe. Aspetta la fine, o --allow-live."
fi

# ── Piano ───────────────────────────────────────────────────────
CRONJOB="$(cronjob_della_release)"
passo "Piano"
n=0
fase() { n=$((n + 1)); nota "$n. $*"; }
fase "sospendere i lavori pianificati della release: $(printf '%s' "$CRONJOB" | grep -c . || true) CronJob"
if [ "$STORAGE" = "si" ]; then
  fase "portare a zero: ${SCRITTORI[*]}, poi lo storage $STORAGE_DEPLOY"
  fase "estrarre $(basename "$FILE_STORAGE") accanto al volume attuale ($OPS_STORAGE_PVC) e verificarne la somma"
else
  fase "portare a zero: ${SCRITTORI[*]}"
fi
if [ "$MODO" = "schema" ]; then
  fase "in un'unica transazione: svuotare lo schema public e ripristinare $(basename "$FILE_DB")"
else
  fase "pg_restore --clean --if-exists --no-owner --single-transaction di $(basename "$FILE_DB")"
fi
if [ "$TIENI_GRAZIA" = "no" ]; then
  fase "orphanRecordingGraceDays a 0: le registrazioni che il database non cita si elencano, non si cancellano"
else
  fase "orphanRecordingGraceDays invariato (--keep-orphan-grace)"
fi
[ "$STORAGE" = "si" ] && fase "sostituire il contenuto del volume con quello estratto"
if [ -n "$MANIFESTO" ]; then
  fase "confrontare le righe per tabella con il manifesto"
else
  fase "contare eventi e iscrizioni (senza manifesto non c'è un confronto)"
fi
fase "riaccendere $([ "$STORAGE" = "si" ] && printf 'storage, ')portale, controller e lavori come erano, recordings-reconcile per ultimo"
fase "scripts/verify-install.sh$([ -n "$CA_FILE" ] && printf ' (certificati verificati con %s)' "$CA_FILE")"
if [ "$STORAGE" = "no" ] && [ -n "$(campo file_storage)" ]; then
  nota "Il backup contiene anche l'object storage: senza --include-storage resta com'è."
fi
if [ -n "$(campo file_stato)" ]; then
  nota "Lo stato dell'installazione ($(campo file_stato)) non si ripristina da qui: contiene i segreti"
  nota "e i valori con cui reinstallare. Estrailo a mano se ti serve."
fi

if [ "$PROVA" = "si" ]; then
  printf "\n✓ Prova completata: niente è stato cambiato. Per eseguire: stesso comando con --yes al posto di --dry-run.\n"
  exit 0
fi
[ "$SI" = "si" ] || { uscita_uso "Il ripristino sostituisce il database: aggiungi --yes (o --dry-run per vedere il piano)."; }

# ── Da qui si cambia il cluster ─────────────────────────────────
IN_PAUSA="no"
esito=0
# shellcheck disable=SC2329 # la chiama il trap EXIT qui sotto
alla_fine() {
  local codice=$?
  set +e
  if [ "$IN_PAUSA" = "si" ]; then
    printf '\n✗ Ripristino interrotto (codice %s). Rimetto storage, portale e lavori come erano.\n' "$codice" >&2
    if ! riprendi; then
      printf '\n✗ Ripresa incompleta. Quando il cluster risponde:\n  %s --resume --yes%s\n' \
        "$RADICE/scripts/restore.sh" "$(argomenti_cluster)" >&2
    fi
  fi
  rm -rf "$TMP"
  exit "$codice"
}
trap alla_fine EXIT
trap 'exit 130' INT TERM
inizio_pausa=$(date +%s)

passo "Pausa: lavori pianificati, portale$([ "$STORAGE" = "si" ] && printf ' e storage')"
IN_PAUSA="si"
# Lo stato di partenza si scrive sugli oggetti prima di cambiarlo, e non si
# sovrascrive: un secondo lancio dopo un'interruzione ritrova quello vero.
while read -r c; do
  [ -n "$c" ] || continue
  if [ -z "$(annotazione cronjob "$c" "$ANN_SOSPESO")" ]; then
    s="$(kc get cronjob "$c" -o jsonpath='{.spec.suspend}')"
    kc annotate cronjob "$c" "$ANN_SOSPESO=${s:-false}" >/dev/null
  fi
  kc patch cronjob "$c" --type=merge -p '{"spec":{"suspend":true}}' >/dev/null
done <<< "$CRONJOB"
nota "lavori pianificati sospesi"

# Lavori già partiti: si aspetta che finiscano, poi si fermano.
lavori_attivi() {
  local nomi=" ${CRONJOB//$'\n'/ } "
  kc get jobs -o jsonpath='{range .items[*]}{.metadata.name}{"|"}{.metadata.ownerReferences[0].name}{"|"}{.status.active}{"\n"}{end}' 2>/dev/null \
    | awk -F'|' -v nomi="$nomi" '$3 > 0 && index(nomi, " " $2 " ") {print $1}'
}
limite=$(( $(date +%s) + ATTESA ))
while [ -n "$(lavori_attivi)" ] && [ "$(date +%s)" -lt "$limite" ]; do sleep 3; done
attivi="$(lavori_attivi)"
if [ -n "$attivi" ]; then
  while read -r j; do
    kc delete job "$j" --wait=true >/dev/null 2>&1 || true
    nota "lavoro $j fermato dopo ${ATTESA}s"
  done <<< "$attivi"
fi

for d in "${SCRITTORI[@]}"; do
  ops_ferma_deployment "$d" "$ATTESA" || { printf '✗ I pod di %s non si fermano entro %ss.\n' "$d" "$ATTESA" >&2; exit 1; }
done
nota "portale fermo: ${SCRITTORI[*]} a zero repliche"

# Sessioni rimaste (un pod terminato male, un client a mano): tengono lock
# che il ripristino aspetterebbe.
pg_query "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND usename = current_user" >/dev/null 2>&1 || true

# La cartella estratta, se il ripristino si ferma prima della sostituzione.
# shellcheck disable=SC2016
pulisci_estrazione() {
  [ "$STORAGE" = "si" ] || return 0
  ops_exec_copia 'rm -rf "/dati/'"$OPS_STORAGE_NUOVO"'"' >/dev/null 2>&1 || true
}

# ── Storage: estrazione accanto al volume attuale ───────────────
# Il contenuto attuale resta dov'è finché il nuovo non è estratto per intero
# e la sua somma coincide con quella del backup: un archivio rovinato o un
# volume pieno fermano tutto prima del database.
if [ "$STORAGE" = "si" ]; then
  ops_ferma_deployment "$STORAGE_DEPLOY" "$ATTESA" \
    || { printf '✗ Lo storage %s non si ferma entro %ss.\n' "$STORAGE_DEPLOY" "$ATTESA" >&2; exit 1; }
  nota "storage fermo: $STORAGE_DEPLOY a zero repliche"
  passo "Storage: estrazione di $(basename "$FILE_STORAGE")"
  ops_crea_pod_copia "$ATTESA" || { printf '✗ %s\n' "$OPS_STORAGE_ERRORE" >&2; exit 1; }
  byte="$(campo storage_byte)"
  liberi="$(ops_exec_copia "$OPS_SCRIPT_SPAZIO" 2>/dev/null || true)"
  # Lo spazio dell'archivio più un margine del 5% e 64 MiB.
  servono=$(( byte / 1024 + byte / 20480 + 65536 ))
  if ! [[ "${liberi:-}" =~ ^[0-9]+$ ]]; then
    printf '✗ Spazio libero del volume non leggibile.\n' >&2; exit 1
  fi
  if [ "$liberi" -lt "$servono" ]; then
    printf '✗ Il volume %s ha %s MiB liberi, ne servono %s per estrarre il backup accanto ai dati attuali.\n' \
      "$OPS_STORAGE_PVC" "$(( liberi / 1024 ))" "$(( servono / 1024 ))" >&2
    printf '  Libera spazio sul disco del nodo (o ingrandisci il volume) e rilancia.\n' >&2
    exit 1
  fi
  inizio=$(date +%s)
  esito_copia=0
  decifra < "$FILE_STORAGE" | ops_exec_copia -i "$OPS_SCRIPT_ESTRAI" 2>"$TMP/storage.err" || esito_copia=$?
  read -r _ rc_tar somma_pod <<< "$(grep '^pa-webinar-copia ' "$TMP/storage.err" | tail -n 1 || true)"
  if [ "$esito_copia" -ne 0 ] || [ "${rc_tar:-}" != "0" ]; then
    printf '✗ Estrazione dello storage non riuscita (tar: %s): %s\n  Database e volume invariati.\n' \
      "${rc_tar:-nessun esito}" "$(grep -v '^pa-webinar-copia ' "$TMP/storage.err" | head -c 300)" >&2
    pulisci_estrazione
    exit 1
  fi
  if [ "$somma_pod" != "$(campo storage_sha256)" ]; then
    printf '✗ Lo storage estratto non ha la somma del backup: archivio rovinato. Database e volume invariati.\n' >&2
    pulisci_estrazione
    exit 1
  fi
  nota "estratto e verificato in $(( $(date +%s) - inizio )) s"
fi

# ── Ripristino ──────────────────────────────────────────────────
passo "Ripristino del database ($MODO)"
inizio=$(date +%s)
# Modo schema: BEGIN, schema svuotato, l'SQL generato da pg_restore, e COMMIT
# solo se pg_restore ha letto tutto l'archivio; altrimenti niente COMMIT, e la
# transazione si annulla alla chiusura. Il successo si riconosce solo dalla riga
# stampata dopo il COMMIT: nessun ripristino a metà resta scritto, e nessun
# ripristino mancato passa per riuscito.
# shellcheck disable=SC2016 # espanso dalla shell del pod o dal sottoprocesso
SQL_SCHEMA='{
  printf "%s\n" "BEGIN;" "DROP SCHEMA IF EXISTS public CASCADE;" "CREATE SCHEMA public;"
  if pg_restore --no-owner --no-acl -f -; then
    printf "%s\n" "COMMIT;" "\\echo ripristino-concluso"
  else
    printf "%s\n" "\\." "ROLLBACK;"
  fi
} | psql -X -w -q -v ON_ERROR_STOP=1 | grep -x ripristino-concluso >/dev/null'
non_riuscito() {
  printf '✗ Ripristino non riuscito, database invariato%s: %s\n' \
    "$([ "$STORAGE" = "si" ] && printf ' (anche il volume dello storage)')" "$(tail -c 600 "$TMP/err")" >&2
  pulisci_estrazione
  exit 1
}
if [ -n "$POD" ]; then
  if [ "$MODO" = "schema" ]; then
    decifra < "$FILE_DB" | kc exec -i "$POD" -c postgresql -- sh -c "$OPS_PG_PROLOGO$SQL_SCHEMA" 2>"$TMP/err" || non_riuscito
  else
    # shellcheck disable=SC2016
    decifra < "$FILE_DB" | kc exec -i "$POD" -c postgresql -- sh -c "$OPS_PG_PROLOGO"'exec pg_restore --clean --if-exists --no-owner --no-acl --single-transaction -d "$PGDATABASE"' 2>"$TMP/err" || non_riuscito
  fi
else
  if [ "$MODO" = "schema" ]; then
    decifra < "$FILE_DB" | sh -c "$SQL_SCHEMA" 2>"$TMP/err" || non_riuscito
  else
    decifra < "$FILE_DB" | pg_restore -w --clean --if-exists --no-owner --no-acl --single-transaction -d "$PGDATABASE" 2>"$TMP/err" || non_riuscito
  fi
fi
nota "fatto in $(( $(date +%s) - inizio )) s"

# ── Registrazioni orfane ────────────────────────────────────────
GRAZIA_PRIMA=""
if [ "$TIENI_GRAZIA" = "no" ]; then
  GRAZIA_PRIMA="$(pg_query "WITH prima AS (SELECT id, orphan_recording_grace_days AS g FROM site_settings WHERE orphan_recording_grace_days > 0)
    UPDATE site_settings s SET orphan_recording_grace_days = 0 FROM prima WHERE s.id = prima.id RETURNING prima.g" 2>/dev/null | head -n 1 || true)"
  if [ -n "$GRAZIA_PRIMA" ]; then
    passo "Registrazioni orfane"
    nota "orphanRecordingGraceDays da $GRAZIA_PRIMA a 0: recordings-reconcile elenca le registrazioni che il"
    nota "database non cita (Registrazioni video > Orfane) senza cancellarle. Il comando per"
    nota "rimettere $GRAZIA_PRIMA giorni è alla fine."
  fi
fi

# ── Storage: sostituzione ───────────────────────────────────────
if [ "$STORAGE" = "si" ]; then
  passo "Storage: sostituzione del contenuto del volume"
  if ! ops_exec_copia "$OPS_SCRIPT_SCAMBIA" > "$TMP/scambio" 2>&1 || ! grep -qx pa-webinar-scambio-concluso "$TMP/scambio"; then
    printf '✗ Sostituzione del volume non riuscita: %s\n' "$(head -c 300 "$TMP/scambio")" >&2
    printf '  Il database è già ripristinato. Lo storage resta fermo (%s a zero repliche) e\n' "$STORAGE_DEPLOY" >&2
    printf '  recordings-reconcile sospeso, per non ripartire con un volume a metà: rilancia lo\n' >&2
    printf '  stesso comando (non --resume).\n' >&2
    # La ripresa salta storage e recordings-reconcile; le annotazioni restano,
    # così il nuovo lancio ritrova le repliche e la sospensione di partenza.
    STORAGE_DEPLOY=""
    RECONCILE_FERMO="si"
    exit 1
  fi
  ops_elimina_pod_copia
  nota "volume $OPS_STORAGE_PVC sostituito"
fi

# ── Confronto con il manifesto ──────────────────────────────────
passo "Confronto con il manifesto"
pg_conteggi > "$TMP/conteggi" 2>"$TMP/err" || { printf '✗ Conteggio non riuscito: %s\n' "$(head -c 300 "$TMP/err")" >&2; exit 1; }
if [ -n "$MANIFESTO" ]; then sed -n 's/^righe=//p' "$MANIFESTO" > "$TMP/attesi"; else : > "$TMP/attesi"; fi
if [ ! -s "$TMP/attesi" ]; then
  nota "nessun conteggio nel backup: righe non confrontate"
  nota "eventi: $(awk -F'|' '$1 == "events" {print $2}' "$TMP/conteggi"), iscrizioni: $(awk -F'|' '$1 == "registrations" {print $2}' "$TMP/conteggi")"
else
  diverse="$(awk -F'|' 'NR == FNR {n = split($2, r, "-"); min[$1] = r[1]; max[$1] = (n > 1 ? r[2] : r[1]); next}
    {
      if (!($1 in min)) { print $1 " (non nel backup)"; next }
      if ($2 < min[$1] || $2 > max[$1]) print $1 " (" $2 " righe, attese " min[$1] (min[$1] == max[$1] ? "" : "-" max[$1]) ")"
      visto[$1] = 1
    }
    END { for (t in min) if (!(t in visto)) print t " (mancante)" }' "$TMP/attesi" "$TMP/conteggi")"
  if [ -n "$diverse" ]; then
    printf '%s\n' "$diverse" | sed 's/^/   DIVERSA: /'
    esito=1
  else
    nota "$(grep -c . "$TMP/conteggi") tabelle, righe come nel backup"
    righe_ev="$(awk -F'|' '$1 == "events" {print $2}' "$TMP/conteggi")"
    righe_reg="$(awk -F'|' '$1 == "registrations" {print $2}' "$TMP/conteggi")"
    nota "eventi: ${righe_ev:-?}, iscrizioni: ${righe_reg:-?}"
  fi
fi

# ── Ripresa e verifica ──────────────────────────────────────────
IN_PAUSA="no"
ripresa=$(date -u +%s)
riprendi || esito=1

# Dopo una pausa lunga i lavori frequenti (email-outbox, lifecycle) risultano
# fermi da troppo tempo finché non girano una volta: si aspetta la prima
# esecuzione, al massimo tre minuti, prima di verificare.
if [ $(( ripresa - inizio_pausa )) -gt 300 ]; then
  frequenti="$(kc get cronjob -l "app.kubernetes.io/instance=$OPS_RELEASE" \
    -o jsonpath='{range .items[*]}{.metadata.name}{"|"}{.spec.schedule}{"|"}{.spec.suspend}{"\n"}{end}' 2>/dev/null \
    | awk -F'|' '$3 != "true" && ($2 ~ /^\* \* \* \* \*$/ || $2 ~ /^\*\/[1-5] \* \* \* \*$/) {print $1}')"
  if [ -n "$frequenti" ]; then
    passo "Attesa della prima esecuzione dei lavori frequenti"
    limite=$(( ripresa + 180 ))
    while [ "$(date +%s)" -lt "$limite" ]; do
      mancanti=""
      while read -r c; do
        [ -n "$c" ] || continue
        ultima="$(kc get cronjob "$c" -o jsonpath='{.status.lastSuccessfulTime}' 2>/dev/null || true)"
        if [ -z "$ultima" ] || [ "$(ops_epoca "$ultima" || echo 0)" -lt "$ripresa" ]; then mancanti+="$c "; fi
      done <<< "$frequenti"
      [ -z "$mancanti" ] && break
      sleep 10
    done
    if [ -n "${mancanti:-}" ]; then nota "non ancora eseguiti: $mancanti"; else nota "eseguiti"; fi
  fi
fi
verifica || esito=1

if [ "$esito" -eq 0 ]; then
  printf '\n✓ Ripristino completato da %s%s.\n' "${DA:-$DUMP}" "$([ "$STORAGE" = "si" ] && printf ', database e object storage')"
else
  printf '\n✗ Ripristino eseguito, ma con errori qui sopra.\n' >&2
fi
if [ -n "$GRAZIA_PRIMA" ]; then
  printf '\nDopo aver controllato Registrazioni video > Orfane (Conserva su quelle da tenere),\n'
  printf 'rimetti la cancellazione automatica delle orfane a %s giorni:\n' "$GRAZIA_PRIMA"
  printf '  %s --reset-orphan-grace %s%s\n' "$RADICE/scripts/restore.sh" "$GRAZIA_PRIMA" "$(argomenti_cluster)"
fi
exit "$esito"
