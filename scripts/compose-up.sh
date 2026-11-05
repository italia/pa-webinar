#!/usr/bin/env bash
#
# Avvia lo stack locale di Docker Compose: costruisce le immagini dai sorgenti o
# preleva quelle pubblicate, applica le migrazioni, carica i dati dimostrativi
# alla prima installazione e controlla che il portale risponda. Rilanciato,
# aggiorna lo stesso stack senza toccare i dati.
#
# Uso:  scripts/compose-up.sh [opzioni]        (--help per l'elenco)
# Da:   qualunque cartella; lo stack è quello del repository dello script.
#
# Cosa NON fa: non è un'installazione per eventi (vedi docs/DEVELOPMENT.md) e
# non usa kubectl.

set -euo pipefail

RADICE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_IMMAGINE="ghcr.io/italia/pa-webinar"

IMMAGINI="local"
TAG="dev"
TAG_MIGRAZIONE=""
SEED="auto"
CHIAMATA="no"
ATTESA=300
PROFILI=()
ARGOMENTI_UP=()

uso() {
  cat <<'FINE'
Uso: scripts/compose-up.sh [opzioni]

Immagini del portale
  (predefinito)             le costruisce dai sorgenti di questo repository,
                            modifiche non salvate comprese
  --images registry         le preleva da ghcr.io, senza credenziali
  --tag TAG                 tag pubblicato (predefinito: dev). Il tag delle
                            migrazioni si ricava: dev -> dev-migrate,
                            dev-<sha> -> dev-migrate-<sha>, X.Y.Z -> vX.Y.Z-migrate
  --migrate-tag TAG         tag delle migrazioni, se non si ricava dal primo

Dati
  --seed                    ricarica i dati dimostrativi. Cancella gli eventi
                            esistenti, con iscrizioni, domande e sondaggi
  --no-seed                 non caricarli nemmeno se il database è vuoto
  (predefinito)             li carica solo se non c'è niente da cancellare:
                            nessun evento, modello salvato o riga di registro

Altro
  --profile NOME            profilo di Compose in più, ripetibile: recorder,
                            captions
  --call                    alla fine, una chiamata di prova fra due browser
                            headless (serve `npm ci` nella radice)
  --timeout S               attesa massima dei servizi (predefinito: 300)
  -h, --help                questo aiuto
FINE
}

errore() { printf '\n✗ %s\n' "$*" >&2; exit 1; }
passo() { printf '\n── %s\n' "$*"; }
nota() { printf '   %s\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --images) IMMAGINI="${2:?}"; shift 2 ;;
    --tag) TAG="${2:?}"; shift 2 ;;
    --migrate-tag) TAG_MIGRAZIONE="${2:?}"; shift 2 ;;
    --seed) SEED="si"; shift ;;
    --no-seed) SEED="no"; shift ;;
    --profile) PROFILI+=(--profile "${2:?}"); shift 2 ;;
    --call) CHIAMATA="si"; shift ;;
    --timeout) ATTESA="${2:?}"; shift 2 ;;
    -h|--help) uso; exit 0 ;;
    *) uso >&2; errore "Opzione sconosciuta: $1" ;;
  esac
done

case "$IMMAGINI" in
  local|registry) ;;
  *) errore "--images accetta local o registry (non '$IMMAGINI')." ;;
esac

case "$ATTESA" in
  ''|*[!0-9]*) errore "--timeout vuole un numero di secondi (non '$ATTESA')." ;;
esac

if [ "$IMMAGINI" = "local" ] && [ "$TAG" != "dev" ]; then
  errore "--tag vale solo con --images registry: senza, le immagini si costruiscono dai sorgenti."
fi

if [ "$IMMAGINI" = "registry" ] && [ -z "$TAG_MIGRAZIONE" ]; then
  case "$TAG" in
    dev) TAG_MIGRAZIONE="dev-migrate" ;;
    dev-*) TAG_MIGRAZIONE="dev-migrate-${TAG#dev-}" ;;
    [0-9]*.[0-9]*.[0-9]*) TAG_MIGRAZIONE="v${TAG}-migrate" ;;
    *) errore "Non so ricavare il tag delle migrazioni da '$TAG': passalo con --migrate-tag." ;;
  esac
fi

command -v docker >/dev/null 2>&1 || errore "Manca 'docker' nel PATH."
docker info >/dev/null 2>&1 || errore "Docker non risponde: è avviato, e il tuo utente può usarlo?"
versione_compose="$(docker compose version --short 2>/dev/null)" \
  || errore "Manca il plugin 'docker compose' (2.20 o più recente)."
case "${versione_compose#v}" in
  1.*|2.[0-9].*|2.1[0-9].*) errore "Docker Compose ${versione_compose} è troppo vecchio: serve 2.20 o più recente." ;;
esac
command -v curl >/dev/null 2>&1 || errore "Manca 'curl' nel PATH."

cd "$RADICE"

# Si scopre qui se la prova di chiamata non può girare, non dopo la build.
if [ "$CHIAMATA" = "si" ]; then
  command -v node >/dev/null 2>&1 || errore "--call: manca node (20 o più recente)."
  node -e "process.exit(require('fs').existsSync(require('playwright').chromium.executablePath()) ? 0 : 1)" >/dev/null 2>&1 \
    || errore "--call: Playwright o il suo Chromium non trovati. Esegui npm ci nella radice del repository, e npx playwright install chromium."
fi

INIZIO=$SECONDS
dc() { docker compose ${PROFILI[@]+"${PROFILI[@]}"} "$@"; }

# Le porte si controllano prima della build: un altro stack le terrebbe
# occupate fino all'ultimo, e l'avvio fallirebbe a metà. Il caso tipico è uno
# stack avviato quando il progetto prendeva il nome dalla cartella: i comandi
# `docker compose` lanciati da qui non lo vedono, ma è ancora acceso.
PROGETTO="${COMPOSE_PROJECT_NAME:-pa-webinar}"
occupate=()
altri=()
for porta in 3000 5432 8443 8025 1025; do
  [ -n "$(docker ps -q --filter "label=com.docker.compose.project=$PROGETTO" --filter "publish=$porta")" ] && continue
  (exec 3<>"/dev/tcp/127.0.0.1/$porta") 2>/dev/null || continue
  occupate+=("$porta")
  chi="$(docker ps --filter "publish=$porta" --format '{{.Label "com.docker.compose.project"}}' | head -1)"
  [ -n "$chi" ] && [[ " ${altri[*]-} " != *" $chi "* ]] && altri+=("$chi")
done
if [ "${#occupate[@]}" -gt 0 ]; then
  printf '✗ Porte occupate: %s.\n' "${occupate[*]}" >&2
  if [ "${#altri[@]}" -gt 0 ]; then
    for chi in "${altri[@]}"; do
      printf "\n  Le tiene lo stack Docker Compose '%s'. I comandi docker compose lanciati da\n" "$chi" >&2
      printf "  qui non lo vedono, perché questo progetto si chiama '%s'.\n" "$PROGETTO" >&2
      printf '\n  Per aggiornare quello stack, con i suoi dati:\n    COMPOSE_PROJECT_NAME=%s scripts/compose-up.sh\n' "$chi" >&2
      printf '\n  Per fermarlo e partire qui, su volumi nuovi:\n    docker stop $(docker ps -q --filter label=com.docker.compose.project=%s)\n    scripts/compose-up.sh\n' "$chi" >&2
    done
  else
    printf '  Non le tiene Docker: ferma il programma che le usa, poi rilancia.\n' >&2
  fi
  exit 1
fi

# Dice quale servizio si è fermato. La cancellazione dei volumi si propone solo
# quando serve davvero: PostgreSQL legge utente, password e nome del database
# soltanto alla prima partenza su un volume vuoto.
diagnosi_up() {
  local codice log
  docker compose ps -a >&2 2>/dev/null || true
  codice="$(docker compose ps -a --format '{{.ExitCode}}' db-migrate 2>/dev/null || true)"
  if [ -n "$codice" ] && [ "$codice" != "0" ]; then
    log="$(docker compose logs --no-log-prefix --tail=15 db-migrate 2>/dev/null || true)"
    printf '%s\n' "$log" >&2
    if printf '%s' "$log" | grep -Eq 'P1000|P1003'; then
      errore "Le migrazioni non entrano nel database: il volume è nato con altre credenziali. Per ripartire da dati vuoti: docker compose down -v"
    fi
    errore "Le migrazioni non sono riuscite: l'errore è qui sopra."
  fi
  errore "I servizi non sono partiti: lo stato è qui sopra; i registri con docker compose logs <servizio>."
}

passo "Immagini"
if [ "$IMMAGINI" = "registry" ]; then
  export PA_WEBINAR_IMAGE="$REPO_IMMAGINE:$TAG"
  export PA_WEBINAR_MIGRATE_IMAGE="$REPO_IMMAGINE:$TAG_MIGRAZIONE"
  nota "prelevo $PA_WEBINAR_IMAGE e $PA_WEBINAR_MIGRATE_IMAGE"
  docker compose pull --quiet app db-migrate \
    || errore "Prelievo non riuscito: controlla la rete e il tag, oppure lancia lo script senza --images registry per costruire dai sorgenti."
else
  nota "costruisco dai sorgenti; la prima volta alcuni minuti"
  ARGOMENTI_UP+=(--build)
fi

passo "Servizi e migrazioni"
dc up -d --wait --wait-timeout "$ATTESA" ${ARGOMENTI_UP[@]+"${ARGOMENTI_UP[@]}"} || diagnosi_up

curl -fsS --max-time 10 http://localhost:3000/api/ready >/dev/null \
  || errore "Il portale non è pronto: docker compose logs app"
nota "portale pronto, schema del database allineato"

passo "Dati dimostrativi"
# Il seed cancella eventi, modelli creati dallo staff e registro GDPR: da solo
# parte unicamente se in queste tabelle non c'è niente da perdere.
da_perdere="$(docker compose exec -T postgres psql -U eventi -d pa_webinar -Atc \
  'select (select count(*) from events)
        + (select count(*) from event_templates where not is_system)
        + (select count(*) from gdpr_audit_logs)')" \
  || errore "Non riesco a leggere il database: docker compose logs postgres"
# Prima del nome fisso il progetto prendeva il nome della cartella, e i suoi
# dati sono ancora nei volumi con quel nome.
if [ "$da_perdere" = "0" ]; then
  vecchio="$(basename "$RADICE" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
  if [ "$vecchio" != "${COMPOSE_PROJECT_NAME:-pa-webinar}" ] \
    && docker volume inspect "${vecchio}_postgres_data" >/dev/null 2>&1; then
    nota "Questo stack è vuoto, ma esiste il database ${vecchio}_postgres_data di un avvio precedente."
    nota "Per riusarlo: COMPOSE_PROJECT_NAME=$vecchio scripts/compose-up.sh"
  fi
fi

if [ "$SEED" = "si" ] || { [ "$SEED" = "auto" ] && [ "$da_perdere" = "0" ]; }; then
  docker compose --profile setup run --rm db-seed
elif [ "$SEED" = "no" ]; then
  nota "non caricati (--no-seed)"
else
  nota "il database ha già dei dati: li lascio (--seed li sostituisce)"
fi

if [ "$CHIAMATA" = "si" ]; then
  passo "Chiamata di prova"
  printf '%s\n' dev_admin_key_2026 | node scripts/verify-call.mjs \
    --url http://localhost:3000 --meet-url https://localhost:8443 --ignore-cert-errors \
    || errore "Chiamata di prova non riuscita."
fi

cat <<FINE

✓ Stack locale pronto, in $((SECONDS - INIZIO)) s.

  Portale              http://localhost:3000/it
  Amministrazione      http://localhost:3000/it/admin/login (chiave: dev_admin_key_2026)
  Conferenza           https://localhost:8443 (accetta il certificato una volta)
  Email inviate        http://localhost:8025
  Immagini             ${PA_WEBINAR_IMAGE:-pa-webinar:local}

  Registri:            docker compose logs -f app
  Spegni, tieni i dati: docker compose down
  Cancella i dati:      docker compose down -v
FINE
