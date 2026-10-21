#!/usr/bin/env bash
#
# Rende il chart per ogni profilo e verifica le invarianti che, se violate,
# fanno fallire l'installazione o la lasciano a metà. Serve perché nessun altro
# controllo guarda il chart: fino a qui gli errori si scoprivano applicandoli a
# un cluster, cioè quando qualcuno stava già installando.
#
# Uso:  scripts/validate-chart.sh
# Da:   radice del repo. Richiede helm e python3 con PyYAML.
#
# Nota su cosa NON copre: le regole che solo l'API server conosce (un percorso
# di Ingress deve essere assoluto, un nome deve stare nei 63 caratteri) qui sono
# riprodotte a mano. La verifica completa è `kubectl apply --dry-run=server` su
# un cluster usa-e-getta, che gira in CI.

set -euo pipefail

CHART="infra/helm/pa-webinar"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

fallimenti=0

errore() {
  printf '  ✗ %s\n' "$1"
  fallimenti=$((fallimenti + 1))
}

# I sottocharts non sono versionati (`*.tgz` è ignorato da git): senza di loro
# ogni resa fallisce, e il messaggio di helm non dice cosa fare.
if [ ! -d "$CHART/charts" ] || [ -z "$(ls -A "$CHART/charts" 2>/dev/null)" ]; then
  echo "Mancano i sottocharts. Scaricali con:"
  echo "  helm repo add bitnami https://charts.bitnami.com/bitnami"
  echo "  helm repo add jitsi-contrib https://jitsi-contrib.github.io/jitsi-helm/"
  echo "  helm dependency build $CHART"
  exit 1
fi

# Le invarianti sui Secret sono scritte in Python: senza interprete o senza
# PyYAML passerebbero a vuoto, e uno script che non può controllare niente non
# deve dire "chart valido". Meglio fermarsi qui, dove il motivo è leggibile.
if ! python3 -c 'import yaml' 2>/dev/null; then
  echo "Serve python3 con PyYAML per verificare le invarianti sui Secret."
  echo "  pip install pyyaml    (oppure: dnf install python3-pyyaml)"
  exit 1
fi

# Segreti fittizi, della forma giusta: le guardie dell'applicazione rifiutano i
# valori che sembrano segnaposto, quindi non possono essere stringhe qualsiasi.
# Le password XMPP interne della conferenza sono fissate come farebbe chi
# installa: values-production.yaml (jitsi.requirePinnedCredentials) si rifiuta
# di rendere senza, gli altri profili le elencherebbero nelle note come da
# controllare.
comuni=(
  --set "secrets.generate.APP_SECRET=$(openssl rand -hex 32)"
  --set "secrets.generate.JITSI_JWT_SECRET=$(openssl rand -hex 32)"
  --set "secrets.generate.PII_ENCRYPTION_KEY=$(openssl rand -hex 32)"
  --set "secrets.generate.CRON_API_KEY=$(openssl rand -hex 32)"
  --set "secrets.generate.ADMIN_API_KEY=$(openssl rand -hex 32)"
  --set "secrets.generate.POSTGRES_PASSWORD=$(openssl rand -hex 24)"
  --set "secrets.generate.POSTGRES_ADMIN_PASSWORD=$(openssl rand -hex 24)"
  --set "secrets.generate.REDIS_PASSWORD=$(openssl rand -hex 24)"
  --set "jitsi-meet.jicofo.xmpp.password=$(openssl rand -hex 16)"
  --set "jitsi-meet.jvb.xmpp.password=$(openssl rand -hex 16)"
  --set "jitsi-meet.jibri.xmpp.password=$(openssl rand -hex 16)"
  --set "jitsi-meet.jibri.recorder.password=$(openssl rand -hex 16)"
)
segreto_jwt="$(openssl rand -hex 32)"

# nome:file di valori. I profili con un suffisso aggiungono gli argomenti di
# `argomenti_profilo`: la NetworkPolicy accesa, un controller diverso da
# ingress-nginx, Jitsi esterno, i segreti da External Secrets, k3s in sede,
# minikube per la valutazione.
profili=(
  "predefinito:"
  "semplice:$CHART/examples/values-simple.yaml"
  "standard:$CHART/examples/values-standard.yaml"
  "completo:$CHART/examples/values-full.yaml"
  "produzione:$CHART/values-production.yaml"
  "produzione-generica:$CHART/values-prod.yaml"
  "sviluppo:$CHART/values-dev.yaml"
  "semplice-rete:$CHART/examples/values-simple.yaml"
  "semplice-traefik:$CHART/examples/values-simple.yaml"
  "k3s:$CHART/examples/values-simple.yaml"
  "semplice-minikube:$CHART/examples/values-simple.yaml"
  "produzione-rete:$CHART/values-production.yaml"
  "completo-segreti-esterni:$CHART/examples/values-full.yaml"
  "jitsi-esterno:"
  "completo-keda:$CHART/examples/values-full.yaml"
  "semplice-ca:$CHART/examples/values-simple.yaml"
  "aks:$CHART/examples/values-full.yaml"
  "eks:$CHART/examples/values-full.yaml"
  "gke:$CHART/examples/values-full.yaml"
  "k3s-sito:$CHART/examples/values-simple.yaml"
  "semplice-sito:$CHART/examples/values-simple.yaml"
  "minikube-sito:$CHART/examples/values-simple.yaml"
  "semplice-backup:$CHART/examples/values-simple.yaml"
  "k3s-componenti:$CHART/examples/values-simple.yaml"
  "k3s-addon:$CHART/examples/values-simple.yaml"
  "sottotitoli-spenti:$CHART/examples/values-full.yaml"
  "postprod:$CHART/examples/values-full.yaml"
  "postprod-mt:$CHART/examples/values-full.yaml"
  "postprod-senza-cpu:$CHART/examples/values-full.yaml"
  "ponte-tutte-le-voci:$CHART/examples/values-simple.yaml"
  "ponte-cascata:$CHART/examples/values-full.yaml"
)

# Il file di una singola installazione k3s come lo scrive chi la automatizza:
# segreti in Secret creati fuori dal chart (modalità existing), i due nomi in
# site.*, certificati dal risolutore ACME di Traefik, copia del database
# accesa, immagini costruite in proprio.
cat >"$OUT/sito-k3s.yaml" <<'FINE'
site:
  portalHost: webinar.ente.example
  conferenceHost: meet.ente.example
secrets:
  mode: existing
  existingSecretName: pa-webinar-secrets
  datastoreSecretName: pa-webinar-datastore
  jitsiJwtSecretName: ""
postgresql:
  auth:
    existingSecret: pa-webinar-datastore
redis:
  auth:
    existingSecret: pa-webinar-datastore
app:
  image: { repository: pa-webinar, tag: local-0123456789ab, pullPolicy: Never }
  migration:
    image: { repository: pa-webinar, tag: local-0123456789ab-migrate, pullPolicy: Never }
ingress:
  annotations:
    traefik.ingress.kubernetes.io/router.tls: "true"
    traefik.ingress.kubernetes.io/router.tls.certresolver: pa-webinar
  tls: [ {} ]
jitsi:
  conferenceIngress:
    annotations:
      traefik.ingress.kubernetes.io/router.tls: "true"
      traefik.ingress.kubernetes.io/router.tls.certresolver: pa-webinar
    tls: [ {} ]
jitsi-meet:
  publicURL: https://meet.ente.example
  prosody:
    jwt:
      existingSecretName: pa-webinar-jitsi-jwt
  jicofo:
    xmpp:
      existingSecretName: pa-webinar-jicofo-xmpp
  jvb:
    xmpp:
      existingSecretName: pa-webinar-jvb-xmpp
backup:
  enabled: true
FINE

# I file che scrivono infra/onprem/k3s/addons/storage.sh e turn.sh nella loro
# cartella di stato, con la stessa forma: passati dopo gli esempi, completano
# lo storage e il TURN di un server k3s.
cat >"$OUT/addon-storage.yaml" <<'FINE'
app:
  env:
    STORAGE_FILES_S3_ENDPOINT: "https://s3.ente.example"
    RECORDING_S3_ENDPOINT: "https://s3.ente.example"
FINE
cat >"$OUT/addon-turn.yaml" <<'FINE'
jitsi-meet:
  turnHost: turn.ente.example
  coturn:
    extraEnvs:
      REAL_EXTERNAL_IP: "203.0.113.10"
    staticAuth:
      existingSecretName: videocall-turn
    allowedPeerIPs:
      - "10.42.0.0-10.42.0.255"
      - "203.0.113.10"
  prosody:
    extraEnvs:
      TURNS_HOST: turn.ente.example
FINE

argomenti_profilo() {
  case "$1" in
    # I valori predefiniti e questi file non dicono dove sta il segreto JWT
    # della conferenza, e il chart giustamente si rifiuta di rendere: qui lo
    # si passa come fa chi installa.
    predefinito|produzione|produzione-generica|sviluppo|produzione-rete)
      printf '%s\n' --set "jitsi-meet.prosody.jwt.secret=$segreto_jwt" ;;
  esac
  case "$1" in
    *-rete|semplice-traefik) printf '%s\n' --set networkPolicy.enabled=true ;;
  esac
  case "$1" in
    semplice-traefik)
      printf '%s\n' \
        --set ingress.className=traefik \
        --set jitsi-meet.web.ingress.ingressClassName=traefik \
        --set 'networkPolicy.ingress.fromNamespaceSelectors[0].kubernetes\.io/metadata\.name=kube-system' ;;
    completo-segreti-esterni)
      printf '%s\n' \
        --set secrets.mode=external \
        --set secrets.jitsiJwtSecretName=videocall-jitsi-jwt ;;
    jitsi-esterno)
      printf '%s\n' --set jitsi.enabled=false ;;
    # Il profilo per k3s in sede (infra/onprem/k3s) sopra al semplice: si
    # regge su un'annotazione annullata, sul filtro delle annotazioni per le
    # classi diverse da nginx e sull'immagine web del sottochart.
    k3s)
      printf '%s\n' -f "$CHART/examples/values-k3s.yaml" ;;
    # Il profilo di scripts/minikube-up.sh sopra al semplice: immagine web del
    # sottochart con un tag nullo, sonda del bridge, credenziali XMPP
    # pretese (qui arrivano da `comuni`, come dal file dei segreti).
    semplice-minikube)
      printf '%s\n' -f "$CHART/examples/values-minikube.yaml" ;;
    # Bridge scalati da KEDA al posto del CronJob (examples/keda-jvb-scaler.yaml):
    # niente scaler reso, quindi il ciclo di vita tocca al suo CronJob, e
    # nessun tetto fisso dei bridge.
    completo-keda)
      printf '%s\n' --set jvbScaler.enabled=false --set-string app.env.JVB_SCALER_ENABLED=true ;;
    # Un'autorità di certificazione interna da un ConfigMap.
    semplice-ca)
      printf '%s\n' --set app.extraCaCerts.configMapName=ente-ca --set app.extraCaCerts.key=ca.crt ;;
    # I profili dei cloud sopra al completo, senza i valori che escono da
    # tofu: si rendono, e le invarianti valgono anche per loro.
    aks|eks|gke)
      printf '%s\n' -f "$CHART/examples/values-$1.yaml" ;;
    k3s-sito)
      printf '%s\n' -f "$CHART/examples/values-k3s.yaml" -f "$OUT/sito-k3s.yaml" ;;
    # I nomi da site.* con l'Ingress della conferenza reso dal sottochart, i
    # cui host (e publicURL) si scrivono uguali.
    semplice-sito)
      printf '%s\n' \
        --set site.portalHost=webinar.ente.example --set site.conferenceHost=meet.ente.example \
        --set jitsi-meet.publicURL=https://meet.ente.example \
        --set 'jitsi-meet.web.ingress.hosts[0].host=meet.ente.example' \
        --set 'jitsi-meet.web.ingress.hosts[0].paths[0]=/' \
        --set 'jitsi-meet.web.ingress.tls[0].secretName=jitsi-tls' \
        --set 'jitsi-meet.web.ingress.tls[0].hosts[0]=meet.ente.example' \
        --set 'ingress.tls[0].secretName=portal-tls' ;;
    # Come li scrive scripts/minikube-up.sh.
    minikube-sito)
      printf '%s\n' -f "$CHART/examples/values-minikube.yaml" \
        --set site.portalHost=app.192.0.2.10.nip.io --set site.conferenceHost=jitsi.192.0.2.10.nip.io \
        --set jitsi-meet.publicURL=https://jitsi.192.0.2.10.nip.io \
        --set 'ingress.tls[0].secretName=app-tls' \
        --set 'jitsi.conferenceIngress.tls[0].secretName=jitsi-tls' ;;
    # Il server k3s con i componenti facoltativi (object storage, TURN) sopra
    # al file dell'installazione, quando i loro file di valori ci sono.
    k3s-componenti)
      printf '%s\n' -f "$CHART/examples/values-k3s.yaml" -f "$OUT/sito-k3s.yaml"
      for componente in storage turn; do
        if [ -f "$CHART/examples/values-k3s-$componente.yaml" ]; then
          printf '%s\n' -f "$CHART/examples/values-k3s-$componente.yaml"
        fi
      done
      # Gli esempi degli addon si completano con il file che il loro script
      # scrive nella cartella di stato: il TURN senza il suo non si rende.
      for componente in storage turn; do
        if [ -f "$CHART/examples/values-k3s-$componente.yaml" ] && [ -f "$OUT/addon-$componente.yaml" ]; then
          printf '%s\n' -f "$OUT/addon-$componente.yaml"
        fi
      done ;;
    # Storage e TURN di un server k3s nell'ordine in cui li passa chi
    # installa: gli esempi, il file del sito, i file della cartella di stato.
    k3s-addon)
      printf '%s\n' -f "$CHART/examples/values-k3s.yaml" \
        -f "$CHART/examples/values-k3s-storage.yaml" -f "$CHART/examples/values-k3s-turn.yaml" \
        -f "$OUT/sito-k3s.yaml" -f "$OUT/addon-storage.yaml" -f "$OUT/addon-turn.yaml" ;;
    # Il profilo completo con il segreto fra Jicofo e il gateway dei
    # sottotitoli: deve arrivare uguale a entrambi.
    completo)
      printf '%s\n' --set global.captions.bridgeToken=segreto-di-prova ;;
    # I sottotitoli live spenti sul profilo completo, con la NetworkPolicy:
    # niente servizio, niente indirizzo in Jicofo, niente regole verso di lui.
    sottotitoli-spenti)
      printf '%s\n' --set global.captions.enabled=false --set networkPolicy.enabled=true ;;
    # La copia del database su un volume già presente, senza NetworkPolicy.
    semplice-backup)
      printf '%s\n' --set backup.enabled=true --set backup.persistence.existingClaim=copie-db --set backup.retention=3 ;;
    # La post-produzione AI, che nessun altro profilo rende: con vLLM acceso
    # a richiesta, con il motore di traduzione su CPU e la NetworkPolicy, e
    # senza il worker senza GPU.
    postprod)
      printf '%s\n' --set postprod.enabled=true --set postprod.vllm.autoscale=true ;;
    postprod-mt)
      printf '%s\n' --set postprod.enabled=true --set postprod.vllm.autoscale=true \
        --set postprod.mt.enabled=true --set networkPolicy.enabled=true ;;
    postprod-senza-cpu)
      printf '%s\n' --set postprod.enabled=true --set postprod.worker.cpu.enabled=false ;;
    # Il bridge che inoltra ogni voce, e quello con tre voci e la cascata fra
    # bridge (Octo): il portale deve saperlo come lo sa il bridge.
    ponte-tutte-le-voci)
      printf '%s\n' --set global.jvb.numLoudest=0 ;;
    ponte-cascata)
      printf '%s\n' --set global.jvb.numLoudest=3 --set jitsi-meet.octo.enabled=true ;;
  esac
}

# I moduli Prosody del progetto esistono in due copie: quella che monta lo
# stack Docker Compose e quella che il chart mette nel proprio ConfigMap (un
# chart non legge file fuori dalla sua cartella). Devono restare identiche.
for modulo in mod_token_affiliation_custom.lua mod_pa_media_lock.lua mod_pa_captions.lua mod_pa_occupants.lua; do
  if ! cmp -s "infra/jitsi/prosody-plugins/$modulo" "$CHART/files/prosody-plugins/$modulo"; then
    errore "infra/jitsi/prosody-plugins/$modulo e $CHART/files/prosody-plugins/$modulo sono diversi: aggiorna la copia del chart"
  fi
done

# Lo stack Docker Compose usa il rilascio di Jitsi del chart: Prosody, Jicofo
# e il bridge con lo stesso tag, la parte web con l'immagine originale dello
# stesso rilascio (il chart usa quella patchata, con un suffisso). Nel chart la
# versione si legge come la guardia pa-webinar.validateJitsiVersions: digest
# tolto, tag mobili per quello che sono, una forma diversa non confrontata (lo
# si dice), un tag vuoto come la versione del sottochart. Compose usa solo le
# immagini pubbliche di Jitsi: un suo tag che la guardia non saprebbe leggere
# (refuso, variabile, solo digest) è un errore.
if ! python3 - docker-compose.yml "$CHART" >"$OUT/compose-jitsi.err" 2>"$OUT/compose-jitsi.note" <<'PY'
import functools
import os
import re
import sys
import tarfile

import yaml

servizi = yaml.safe_load(open(sys.argv[1])).get("services") or {}
chart = sys.argv[2]
jitsi = yaml.safe_load(open(f"{chart}/values.yaml")).get("jitsi-meet") or {}


def versione(tag):
    tag = str(tag).split("@", 1)[0]
    if tag in ("stable", "unstable", "latest"):
        return tag
    trovata = re.match(r"^(stable|unstable)-[0-9]+", tag)
    return trovata.group(0) if trovata else None


@functools.cache
def versione_sottochart():
    # Il sottochart che Helm usa: l'archivio della versione nel Chart.lock;
    # senza, una copia spacchettata. Se non si trova, None.
    try:
        bloccate = (yaml.safe_load(open(f"{chart}/Chart.lock")) or {}).get("dependencies") or []
        versione_chart = next((d.get("version") for d in bloccate if d.get("name") == "jitsi-meet"), None)
        archivio = f"{chart}/charts/jitsi-meet-{versione_chart}.tgz"
        if versione_chart and os.path.exists(archivio):
            with tarfile.open(archivio) as tgz:
                return (yaml.safe_load(tgz.extractfile("jitsi-meet/Chart.yaml")) or {}).get("appVersion")
    except (OSError, KeyError, tarfile.TarError, yaml.YAMLError):
        pass
    try:
        return (yaml.safe_load(open(f"{chart}/charts/jitsi-meet/Chart.yaml")) or {}).get("appVersion")
    except (OSError, yaml.YAMLError):
        return None


def tag_compose(immagine):
    nome = immagine.split("@", 1)[0].split("/")[-1]
    if ":" in nome:
        return nome.rsplit(":", 1)[1]
    return None if "@" in immagine else "latest"


problemi = []
saltati = []
for servizio, componente in (("jitsi-web", "web"), ("prosody", "prosody"), ("jicofo", "jicofo"), ("jvb", "jvb")):
    immagine = (servizi.get(servizio) or {}).get("image")
    if not immagine:
        problemi.append(f"{servizio}: nessuna immagine nel servizio")
        continue
    tag = tag_compose(immagine)
    trovata = versione(tag) if tag else None
    if not trovata:
        problemi.append(f"{servizio}: il tag di {immagine} non dice il rilascio di Jitsi")
        continue
    tag_chart = ((jitsi.get(componente) or {}).get("image") or {}).get("tag") or versione_sottochart()
    attesa = versione(tag_chart) if tag_chart else None
    if not attesa:
        saltati.append(f"{servizio} (chart: {tag_chart or 'versione del sottochart sconosciuta'})")
    elif attesa != trovata:
        problemi.append(f"{servizio}={tag} (chart: {tag_chart})")
if saltati:
    print("confronto con Compose saltato per " + ", ".join(saltati), file=sys.stderr)
if problemi:
    print(", ".join(problemi))
    sys.exit(1)
PY
then
  errore "docker-compose.yml non usa il rilascio di Jitsi del chart: $(cat "$OUT/compose-jitsi.err" "$OUT/compose-jitsi.note")"
fi
[ -s "$OUT/compose-jitsi.note" ] && sed 's/^/  /' "$OUT/compose-jitsi.note"

echo "helm lint"
# Con i soli valori predefiniti la resa si ferma alla guardia sul segreto JWT
# della conferenza, e il lint non guarderebbe gli altri template.
helm lint "$CHART" --set "jitsi-meet.prosody.jwt.secret=$segreto_jwt" >/dev/null 2>"$OUT/lint.err" \
  || errore "helm lint fallisce: $(head -3 "$OUT/lint.err" | tr '\n' ' ')"
# Una guardia che scatta durante il lint non lo fa fallire: Helm la registra
# come messaggio informativo e esce con 0. Il testo cambia fra le versioni
# (Helm 3: `[INFO] Fail: …`, Helm 4: `funcMap fail`), quindi si cercano
# entrambi.
guardia_lint='\[INFO\] Fail:|funcMap fail'
if grep -qE "$guardia_lint" "$OUT/lint.err"; then
  errore "helm lint si ferma a una guardia: $(grep -m1 -E "$guardia_lint" "$OUT/lint.err" | cut -c1-200)"
fi

for voce in "${profili[@]}"; do
  nome="${voce%%:*}"
  file="${voce#*:}"
  reso="$OUT/$nome.yaml"

  args=(template videocall "$CHART" -n videocall "${comuni[@]}")
  [ -n "$file" ] && args+=(-f "$file")
  mapfile -t extra < <(argomenti_profilo "$nome")
  [ "${#extra[@]}" -gt 0 ] && args+=("${extra[@]}")

  echo "profilo: $nome"
  if ! helm "${args[@]}" >"$reso" 2>"$OUT/$nome.err"; then
    errore "non si rende: $(head -3 "$OUT/$nome.err" | tr '\n' ' ')"
    continue
  fi

  # Un percorso di Ingress deve essere assoluto. Il caso che è già successo:
  # `paths` scritto come mappa dove il sottochart si aspetta una stringa, che
  # rende `map[path:/ pathType:Prefix]` — accettato da YAML, rifiutato all'apply.
  while read -r percorso; do
    case "$percorso" in
      /*) ;;
      "") ;;
      *) errore "percorso di Ingress non assoluto: $percorso" ;;
    esac
  done < <(awk '/^kind: Ingress$/,/^---$/' "$reso" | sed -n 's/^ *- *path: *//p')

  # Un riferimento a immagine non risolto lascia i pod in ImagePullBackOff.
  while read -r riga; do
    [ -n "$riga" ] && errore "immagine vuota: $riga"
  done < <(grep -nE '^[[:space:]]+image: *("")?$' "$reso" || true)

  # In modalità "generate" i Secret resi devono bastare a far partire lo stack.
  # Non basta che una chiave esista da qualche parte: deve stare nel Secret che
  # quel componente monta davvero. Separare le password dei datastore senza
  # ripuntare i sottochart è un errore che si vede solo così.
  if ! python3 - "$reso" >"$OUT/$nome.sec" 2>"$OUT/$nome.sec.err" <<'PY'
import re
import sys

import yaml

docs = [d for d in yaml.safe_load_all(open(sys.argv[1])) if d]
segreti = {
    d["metadata"]["name"]: set((d.get("stringData") or d.get("data") or {}).keys())
    for d in docs if d.get("kind") == "Secret"
}
if not segreti:
    sys.exit(0)

def cerca(nodo, chiave):
    """Tutti i valori associati a `chiave`, a qualsiasi profondità."""
    if isinstance(nodo, dict):
        for k, v in nodo.items():
            if k == chiave and isinstance(v, str):
                yield v
            else:
                yield from cerca(v, chiave)
    elif isinstance(nodo, list):
        for v in nodo:
            yield from cerca(v, chiave)

# Il Secret dell'applicazione: quello che il Deployment monta con envFrom.
# Se il chart lo rende, la resa è in modalità "generate" e si può affermare che
# un Secret assente dai manifesti non esisterà. Nelle altre modalità i Secret
# sono creati fuori dal chart per disegno, e la stessa inferenza sarebbe falsa.
genera = False
for d in docs:
    if d.get("kind") != "Deployment" or "pa-webinar" not in d["metadata"]["name"]:
        continue
    for c in d["spec"]["template"]["spec"].get("containers", []):
        for f in c.get("envFrom", []):
            nome = (f.get("secretRef") or {}).get("name")
            if nome in segreti:
                genera = True
                mancanti = {"DATABASE_URL", "APP_SECRET", "PII_ENCRYPTION_KEY",
                            "ADMIN_API_KEY", "CRON_API_KEY"} - segreti[nome]
                for k in sorted(mancanti):
                    print(f"il Secret dell'applicazione ({nome}) non ha {k}")

# I datastore: si guarda il Secret che il loro pod monta per davvero.
attesi = {"postgresql": ["POSTGRES_PASSWORD", "POSTGRES_ADMIN_PASSWORD"],
          "redis": ["REDIS_PASSWORD"]}
for d in docs:
    if d.get("kind") not in ("StatefulSet", "Deployment"):
        continue
    nome = d["metadata"]["name"]
    quale = next((k for k in attesi if k in nome), None)
    if not quale:
        continue
    montati = {n for n in cerca(d["spec"]["template"]["spec"], "secretName")}
    for n in sorted(montati):
        if n not in segreti:
            # Il caso speculare: il sottochart punta a un Secret che nessun
            # template rende. I manifesti restano validi e l'apply riesce; il
            # pod resta in ContainerCreating, staccato dalla causa.
            if genera:
                print(f"{quale} monta il Secret {n}, che nessun template rende")
            continue
        for k in attesi[quale]:
            if k not in segreti[n]:
                print(f"{quale} monta il Secret {n}, che non contiene {k}")

# L'indirizzo della banca dati deve puntare a un Service che esiste davvero.
# Un host sbagliato non è un errore di resa né di apply: si manifesta come pod
# che non parte, senza che niente dica quale valore è stato calcolato.
servizi = {d["metadata"]["name"] for d in docs if d.get("kind") == "Service"}
for d in docs:
    if d.get("kind") != "Secret":
        continue
    url = (d.get("stringData") or {}).get("DATABASE_URL", "")
    trovato = re.match(r"postgresql://[^@]*@([^:/?]+)", url)
    if not trovato:
        continue
    host = trovato.group(1)
    # Un host con un punto è un FQDN o un database gestito fuori dal cluster:
    # non deve corrispondere a niente di reso qui.
    if "." in host or host in servizi:
        continue
    print(f"DATABASE_URL punta all'host {host!r}, che non è un Service reso")


def nome_breve(host):
    """Il nome del Service dentro un indirizzo, anche se è un FQDN di cluster."""
    if host.endswith(".svc.cluster.local"):
        return host.split(".", 1)[0]
    return None if "." in host else host


# Stessa invariante per Redis, che però l'applicazione riceve come variabile
# d'ambiente del Deployment e non dentro un Secret. È lo stesso difetto di
# DATABASE_URL — un host scritto a mano che ignora gli override del sottochart
# — e merita lo stesso controllo.
for d in docs:
    if d.get("kind") != "Deployment":
        continue
    for c in d["spec"]["template"]["spec"].get("containers") or []:
        # `env:` puo' essere reso come chiave nulla, non solo assente.
        for e in c.get("env") or []:
            if e.get("name") != "REDIS_URL":
                continue
            trovato = re.match(r"redis://[^@]*@([^:/?]+)", str(e.get("value", "")))
            if not trovato:
                continue
            breve = nome_breve(trovato.group(1))
            if breve is None or breve in servizi:
                continue
            print(f"REDIS_URL punta all'host {breve!r}, che non è un Service reso")
PY
  then
    errore "controllo dei Secret non eseguito su $nome: $(head -3 "$OUT/$nome.sec.err" | tr '\n' ' ')"
  fi
  while read -r problema; do
    [ -n "$problema" ] && errore "$problema"
  done <"$OUT/$nome.sec"

  # Invarianti che si vedono solo su un cluster, con un controller diverso da
  # ingress-nginx o con la NetworkPolicy accesa: qui si riproducono sui
  # manifesti resi.
  if ! python3 - "$reso" "$CHART/values.yaml" >"$OUT/$nome.net" 2>"$OUT/$nome.net.err" <<'PY'
import re
import sys

import yaml

docs = [d for d in yaml.safe_load_all(open(sys.argv[1])) if d]
# Le classi che il chart tratta come controller diversi da ingress-nginx.
altri_controller = set((yaml.safe_load(open(sys.argv[2])).get("ingress") or {}).get("nonNginxClassNames") or [])


def modelli():
    """(tipo, nome, modello di pod) di ogni carico di lavoro reso."""
    for d in docs:
        tipo, spec = d.get("kind"), d.get("spec") or {}
        if tipo in ("Deployment", "StatefulSet", "DaemonSet", "Job"):
            yield tipo, d["metadata"]["name"], spec.get("template") or {}
        elif tipo == "CronJob":
            job = (spec.get("jobTemplate") or {}).get("spec") or {}
            yield tipo, d["metadata"]["name"], job.get("template") or {}


def etichette(modello):
    return (modello.get("metadata") or {}).get("labels") or {}


def seleziona(selettore, et):
    for k, v in (selettore.get("matchLabels") or {}).items():
        if str(et.get(k)) != str(v):
            return False
    for e in selettore.get("matchExpressions") or []:
        k, op, valori = e["key"], e["operator"], e.get("values") or []
        if op == "In" and et.get(k) not in valori:
            return False
        if op == "NotIn" and et.get(k) in valori:
            return False
        if op == "Exists" and k not in et:
            return False
        if op == "DoesNotExist" and k in et:
            return False
    return True


def ammette(regola, et, porta):
    """La regola di ingresso lascia passare un pod dello stesso namespace?"""
    porte = regola.get("ports")
    if porte and not any(p.get("port") in (porta, "http") for p in porte):
        return False
    fonti = regola.get("from")
    if not fonti:
        return True
    for f in fonti:
        if f.get("namespaceSelector") or "ipBlock" in f:
            continue
        if "podSelector" in f and seleziona(f["podSelector"] or {}, et):
            return True
    return False


carichi = list(modelli())
deployment = {n for t, n, _ in carichi if t == "Deployment"}
servizi = {d["metadata"]["name"] for d in docs if d.get("kind") == "Service"}

# Ingress: l'API server rifiuta un Ingress la cui annotazione di classe non
# coincide con ingressClassName, e un controller che non è ingress-nginx
# ignora in silenzio le annotazioni di ingress-nginx.
for d in docs:
    if d.get("kind") != "Ingress":
        continue
    nome = d["metadata"]["name"]
    classe = (d.get("spec") or {}).get("ingressClassName")
    ann = d["metadata"].get("annotations") or {}
    legacy = ann.get("kubernetes.io/ingress.class")
    if classe and legacy is not None and legacy != classe:
        print(f"l'Ingress {nome} ha classe {classe!r} e annotazione di classe {legacy!r}: l'API server lo rifiuta")
    if classe in altri_controller and any(k.startswith("nginx.ingress.kubernetes.io/") for k in ann):
        print(f"l'Ingress {nome} ha classe {classe!r} ma annotazioni di ingress-nginx, che non avrebbero effetto")

# NetworkPolicy del chart: deve selezionare il Deployment dell'applicazione e
# solo quello (gli altri pod parlano con l'API server, i bridge, la GPU), e
# lasciar entrare sulla porta 3000 ogni CronJob e Jibri, che a fine
# registrazione chiama l'applicazione.
for pol in docs:
    if pol.get("kind") != "NetworkPolicy":
        continue
    if not str((pol["metadata"].get("labels") or {}).get("helm.sh/chart", "")).startswith("pa-webinar-"):
        continue
    nome = pol["metadata"]["name"]
    spec = pol.get("spec") or {}
    selettore = spec.get("podSelector") or {}
    # La policy dei pod della copia del database: nessuno entra, si esce solo
    # verso DNS e PostgreSQL, e deve selezionare proprio quei pod.
    if (pol["metadata"].get("labels") or {}).get("app.kubernetes.io/component") == "backup":
        copie = [(t, n) for t, n, m in carichi if etichette(m).get("app.kubernetes.io/component") == "backup"]
        if not copie:
            print(f"la NetworkPolicy {nome} è resa ma non c'è nessun CronJob della copia del database")
        for t, n, m in carichi:
            sel = seleziona(selettore, etichette(m))
            if etichette(m).get("app.kubernetes.io/component") == "backup" and not sel:
                print(f"la NetworkPolicy {nome} non seleziona {t}/{n}")
            if sel and etichette(m).get("app.kubernetes.io/component") != "backup":
                print(f"la NetworkPolicy {nome} seleziona anche {t}/{n}")
        if spec.get("ingress"):
            print(f"la NetworkPolicy {nome} lascia entrare traffico nei pod della copia del database")
        porte = {p.get("port") for r in spec.get("egress") or [] for p in r.get("ports") or []}
        if not {53, 5432} <= porte or porte - {53, 5432}:
            print(f"la NetworkPolicy {nome} dovrebbe lasciar uscire solo DNS e PostgreSQL (53, 5432), non {sorted(porte)}")
        if any(not r.get("to") for r in spec.get("egress") or []):
            print(f"la NetworkPolicy {nome} ha una regola di uscita senza destinazione")
        continue
    # La policy dei pod di Jibri: entra solo l'applicazione, solo sull'API
    # HTTP (2222), che avvia e ferma registrazioni senza autenticazione.
    if (pol["metadata"].get("labels") or {}).get("app.kubernetes.io/component") == "jibri":
        for t, n, m in carichi:
            sel = seleziona(selettore, etichette(m))
            di_jibri = etichette(m).get("app.kubernetes.io/component") == "jibri"
            if di_jibri and not sel:
                print(f"la NetworkPolicy {nome} non seleziona {t}/{n}")
            if sel and not di_jibri:
                print(f"la NetworkPolicy {nome} seleziona anche {t}/{n}")
        if not any(t == "Deployment" and etichette(m).get("app.kubernetes.io/component") == "jibri" for t, n, m in carichi):
            print(f"la NetworkPolicy {nome} è resa ma Jibri no")
        app_j = next((m for t, n, m in carichi if t == "Deployment"
                      and "app.kubernetes.io/component" not in etichette(m)
                      and etichette(m).get("app.kubernetes.io/name") == "pa-webinar"), None)
        regole = spec.get("ingress") or []
        if app_j is not None and not any(ammette(r, etichette(app_j), 2222) for r in regole):
            print(f"la NetworkPolicy {nome} non lascia all'applicazione la salute di Jibri (2222)")
        if any(not r.get("from") for r in regole):
            print(f"la NetworkPolicy {nome} ha una regola di ingresso senza sorgente: Jibri resterebbe aperto a tutti")
        porte = {p.get("port") for r in regole for p in r.get("ports") or []}
        if porte != {2222}:
            print(f"la NetworkPolicy {nome} dovrebbe ammettere solo la porta 2222, non {sorted(porte)}")
        if "Egress" in (spec.get("policyTypes") or []):
            print(f"la NetworkPolicy {nome} limita l'uscita di Jibri, che apre le sue connessioni verso Prosody, la conferenza e lo storage")
        continue
    # La policy dei sottotitoli live: entrano solo i bridge della release
    # (l'audio) e l'applicazione (lo stato), sulla 8080; escono DNS,
    # l'applicazione (il contesto della stanza) e HTTPS (il modello).
    if (pol["metadata"].get("labels") or {}).get("app.kubernetes.io/component") == "captions":
        for t, n, m in carichi:
            sel = seleziona(selettore, etichette(m))
            dei_sottotitoli = etichette(m).get("app.kubernetes.io/component") == "captions"
            if dei_sottotitoli and not sel:
                print(f"la NetworkPolicy {nome} non seleziona {t}/{n}")
            if sel and not dei_sottotitoli:
                print(f"la NetworkPolicy {nome} seleziona anche {t}/{n}")
        if not any(t == "Deployment" and etichette(m).get("app.kubernetes.io/component") == "captions" for t, n, m in carichi):
            print(f"la NetworkPolicy {nome} è resa ma il servizio dei sottotitoli no")
        istanza_c = (selettore.get("matchLabels") or {}).get("app.kubernetes.io/instance")
        regole = spec.get("ingress") or []
        if any(not r.get("from") for r in regole):
            print(f"la NetworkPolicy {nome} ha una regola di ingresso senza sorgente: i sottotitoli resterebbero aperti a tutti")
        porte = {p.get("port") for r in regole for p in r.get("ports") or []}
        if porte != {8080}:
            print(f"la NetworkPolicy {nome} dovrebbe ammettere solo la porta 8080, non {sorted(porte)}")
        for t, n, m in carichi:
            et = etichette(m)
            if et.get("app.kubernetes.io/component") == "jvb" and et.get("app.kubernetes.io/instance") == istanza_c \
                    and not any(ammette(r, et, 8080) for r in regole):
                print(f"{t}/{n}: il bridge non raggiungerebbe i sottotitoli, la NetworkPolicy {nome} non lo ammette sulla 8080")
        app_c = next((m for t, n, m in carichi if t == "Deployment"
                      and "app.kubernetes.io/component" not in etichette(m)
                      and etichette(m).get("app.kubernetes.io/name") == "pa-webinar"), None)
        if app_c is not None and not any(ammette(r, etichette(app_c), 8080) for r in regole):
            print(f"la NetworkPolicy {nome} non lascia all'applicazione lo stato dei sottotitoli (8080)")
        uscite = spec.get("egress") or []
        porte_u = {p.get("port") for r in uscite for p in r.get("ports") or []}
        if not {53, 3000, 443} <= porte_u:
            print(f"la NetworkPolicy {nome} dovrebbe lasciar uscire DNS, l'applicazione e HTTPS (53, 3000, 443), non {sorted(porte_u)}")
        if app_c is not None and not any(
                any(p.get("port") == 3000 for p in r.get("ports") or [])
                and any("podSelector" in d and "namespaceSelector" not in d and seleziona(d["podSelector"] or {}, etichette(app_c))
                        for d in r.get("to") or [])
                for r in uscite):
            print(f"la NetworkPolicy {nome} non lascia ai sottotitoli il contesto della stanza chiesto all'applicazione (3000)")
        continue
    # La policy del motore di traduzione su CPU: entra solo il worker senza
    # GPU, sulla 8080 (il motore non ha autenticazione); escono DNS e HTTPS
    # (il modello).
    if (pol["metadata"].get("labels") or {}).get("app.kubernetes.io/component") == "postprod-mt":
        for t, n, m in carichi:
            sel = seleziona(selettore, etichette(m))
            del_motore = etichette(m).get("app.kubernetes.io/component") == "postprod-mt"
            if del_motore and not sel:
                print(f"la NetworkPolicy {nome} non seleziona {t}/{n}")
            if sel and not del_motore:
                print(f"la NetworkPolicy {nome} seleziona anche {t}/{n}")
        regole = spec.get("ingress") or []
        if any(not r.get("from") for r in regole):
            print(f"la NetworkPolicy {nome} ha una regola di ingresso senza sorgente: il motore resterebbe aperto a tutti")
        porte = {p.get("port") for r in regole for p in r.get("ports") or []}
        if porte != {8080}:
            print(f"la NetworkPolicy {nome} dovrebbe ammettere solo la porta 8080, non {sorted(porte)}")
        for t, n, m in carichi:
            componente_m = etichette(m).get("app.kubernetes.io/component")
            ammesso = any(ammette(r, etichette(m), 8080) for r in regole)
            if componente_m == "postprod-worker-cpu" and not ammesso:
                print(f"{t}/{n}: il worker senza GPU non raggiungerebbe il motore di traduzione, la NetworkPolicy {nome} non lo ammette sulla 8080")
            if componente_m not in ("postprod-worker-cpu", "postprod-mt") and ammesso:
                print(f"la NetworkPolicy {nome} lascia entrare nel motore di traduzione anche {t}/{n}")
        porte_u = {p.get("port") for r in spec.get("egress") or [] for p in r.get("ports") or []}
        if not {53, 443} <= porte_u:
            print(f"la NetworkPolicy {nome} dovrebbe lasciar uscire DNS e HTTPS (53, 443), non {sorted(porte_u)}")
        continue
    if not any(t == "Deployment" and n == nome and seleziona(selettore, etichette(m)) for t, n, m in carichi):
        print(f"la NetworkPolicy {nome} non seleziona il Deployment dell'applicazione, che resterebbe senza restrizioni")
    for tipo, n, modello in carichi:
        if seleziona(selettore, etichette(modello)) and not (tipo == "Deployment" and n == nome):
            print(f"la NetworkPolicy {nome} seleziona anche {tipo}/{n}, di cui non descrive il traffico")
    istanza = (selettore.get("matchLabels") or {}).get("app.kubernetes.io/instance")
    della_release = {"matchLabels": {k: v for k, v in (selettore.get("matchLabels") or {}).items()
                                     if k != "app.kubernetes.io/component"}}
    for tipo, n, modello in carichi:
        et = etichette(modello)
        cron = tipo == "CronJob" and seleziona(della_release, et)
        jibri = et.get("app.kubernetes.io/component") == "jibri" and et.get("app.kubernetes.io/instance") == istanza
        sottotitoli = et.get("app.kubernetes.io/component") == "captions" and et.get("app.kubernetes.io/instance") == istanza
        if not (cron or jibri or sottotitoli):
            continue
        if not any(ammette(r, et, 3000) for r in spec.get("ingress") or []):
            print(f"{tipo}/{n} non raggiungerebbe l'applicazione: la NetworkPolicy {nome} non lo ammette sulla porta 3000")

# Con la NetworkPolicy accesa, i pod della copia del database hanno la loro.
# (Il sottochart PostgreSQL rende NetworkPolicy sue: contano solo quelle del chart.)
del_chart_np = [d for d in docs if d.get("kind") == "NetworkPolicy"
                and str((d["metadata"].get("labels") or {}).get("helm.sh/chart", "")).startswith("pa-webinar-")]
if del_chart_np:
    copie = {n for t, n, m in carichi if etichette(m).get("app.kubernetes.io/component") == "backup"}
    coperte = [d for d in del_chart_np
               if (d["metadata"].get("labels") or {}).get("app.kubernetes.io/component") == "backup"]
    if copie and not coperte:
        print(f"NetworkPolicy accesa ma nessuna policy per i pod della copia del database ({', '.join(sorted(copie))})")
    sottotitoli = {n for t, n, m in carichi if etichette(m).get("app.kubernetes.io/component") == "captions"}
    if sottotitoli and not any((d["metadata"].get("labels") or {}).get("app.kubernetes.io/component") == "captions"
                               for d in del_chart_np):
        print(f"NetworkPolicy accesa ma nessuna policy per i pod dei sottotitoli ({', '.join(sorted(sottotitoli))})")
    motore = {n for t, n, m in carichi if etichette(m).get("app.kubernetes.io/component") == "postprod-mt"}
    if motore and not any((d["metadata"].get("labels") or {}).get("app.kubernetes.io/component") == "postprod-mt"
                          for d in del_chart_np):
        print(f"NetworkPolicy accesa ma nessuna policy per i pod del motore di traduzione ({', '.join(sorted(motore))})")

# Lo scaler dei bridge con un nome esplicito deve trovare quel Deployment:
# altrimenti legge zero repliche, `kubectl scale` fallisce e con
# `replicaCount: 0` nessun bridge parte mai.
for tipo, n, modello in carichi:
    if tipo != "CronJob":
        continue
    for c in (modello.get("spec") or {}).get("containers") or []:
        testo = " ".join(str(x) for x in (c.get("command") or []) + (c.get("args") or []))
        trovato = re.search(r'JVB_DEPLOY="([^"$]+)"', testo)
        if trovato and trovato.group(1) not in deployment:
            print(f"lo scaler cerca il Deployment {trovato.group(1)!r}, che non è reso")

# Gli indirizzi interni dell'applicazione (JVB_HEALTH_URL e gli altri) sono
# controllati più sotto, con le invarianti della conferenza.

# Bitnami pubblica nel registro pubblico solo `latest`, che cambia contenuto:
# un tag con la versione non esiste (ImagePullBackOff), e `latest` senza
# digest porta un nodo nuovo su una versione diversa dagli altri.
for tipo, n, modello in carichi:
    spec = modello.get("spec") or {}
    for c in (spec.get("containers") or []) + (spec.get("initContainers") or []):
        immagine = str(c.get("image", ""))
        if re.search(r"(^|/)bitnami/", immagine) and "@sha256:" not in immagine:
            print(f"{tipo}/{n}: l'immagine {immagine} non è fissata per digest")
PY
  then
    errore "controllo di rete e immagini non eseguito su $nome: $(head -3 "$OUT/$nome.net.err" | tr '\n' ' ')"
  fi
  while read -r problema; do
    [ -n "$problema" ] && errore "$problema"
  done <"$OUT/$nome.net"

  # La conferenza e il ciclo di vita: indirizzi interni che l'applicazione
  # interroga, ruoli nella sala, chi porta avanti gli eventi, quanti bridge il
  # portale si aspetta. Tutti difetti che non fermano l'installazione e si
  # vedono solo usandola: una pagina di stato rossa con le sale che
  # funzionano, ospiti moderatori, eventi che non si chiudono mai.
  if ! python3 - "$reso" "$nome" "$CHART" >"$OUT/$nome.conf" 2>"$OUT/$nome.conf.err" <<'PY'
import os
import re
import sys

import yaml

docs = [d for d in yaml.safe_load_all(open(sys.argv[1])) if d]
SCRIPT_FINE_REGISTRAZIONE = open(os.path.join(sys.argv[3], "files/jibri-finalize.sh")).read().strip()
profilo = sys.argv[2]


def del_chart(d):
    return str((d["metadata"].get("labels") or {}).get("helm.sh/chart", "")).startswith("pa-webinar-")


def modelli():
    for d in docs:
        tipo, spec = d.get("kind"), d.get("spec") or {}
        if tipo in ("Deployment", "StatefulSet", "DaemonSet"):
            yield tipo, d["metadata"]["name"], spec.get("template") or {}, spec
        elif tipo == "CronJob":
            job = (spec.get("jobTemplate") or {}).get("spec") or {}
            yield tipo, d["metadata"]["name"], job.get("template") or {}, spec


def seleziona(selettore, et):
    return all(str(et.get(k)) == str(v) for k, v in (selettore or {}).items())


carichi = list(modelli())
servizi = {d["metadata"]["name"]: d for d in docs if d.get("kind") == "Service"}
mappe = {d["metadata"]["name"]: d.get("data") or {} for d in docs if d.get("kind") == "ConfigMap"}

# L'applicazione: il Deployment del chart senza componente, e il suo ConfigMap.
app = next((d for d in docs if d.get("kind") == "Deployment" and del_chart(d)
            and "app.kubernetes.io/component" not in (d["spec"]["template"]["metadata"].get("labels") or {})), None)
if app is None:
    print("nessun Deployment dell'applicazione reso")
    sys.exit(0)
nome_app = app["metadata"]["name"]
contenitore = app["spec"]["template"]["spec"]["containers"][0]
variabili = dict(mappe.get(nome_app, {}))
for e in contenitore.get("env") or []:
    if "value" in e:
        variabili[e["name"]] = str(e["value"])


def breve(host):
    """Il nome del Service dentro un indirizzo di cluster, o None se è esterno."""
    trovato = re.match(r"^([a-z0-9-]+)\.[a-z0-9-]+\.svc(\.[a-z0-9.-]+)?$", host)
    if trovato:
        return trovato.group(1)
    return None if "." in host else host


def pod_di(servizio):
    """I modelli di pod che un Service seleziona."""
    sel = (servizio.get("spec") or {}).get("selector") or {}
    return [(t, n, m) for t, n, m, _ in carichi
            if sel and seleziona(sel, (m.get("metadata") or {}).get("labels") or {})]


def porta_pod(servizio, porta, modello):
    """La porta del container dietro una porta del Service."""
    for p in (servizio.get("spec") or {}).get("ports") or []:
        if p.get("port") != porta:
            continue
        bersaglio = p.get("targetPort", porta)
        if isinstance(bersaglio, int):
            return bersaglio
        for c in (modello.get("spec") or {}).get("containers") or []:
            for cp in c.get("ports") or []:
                if cp.get("name") == bersaglio:
                    return cp.get("containerPort")
        return None
    return False


# Ogni indirizzo interno punta a un Service reso, su una porta che il Service
# espone, e con la NetworkPolicy accesa la policy dell'applicazione deve
# lasciar passare il traffico verso quella porta dei pod: altrimenti la sonda
# scade e la pagina di stato segna un guasto che non c'è.
politica = next((d for d in docs if d.get("kind") == "NetworkPolicy" and del_chart(d)
                 and d["metadata"]["name"] == nome_app), None)


def uscita_ammessa(et, porta):
    for regola in (politica.get("spec") or {}).get("egress") or []:
        porte = regola.get("ports")
        if porte and not any(p.get("port") == porta for p in porte):
            continue
        destinazioni = regola.get("to")
        if not destinazioni:
            return True
        for dest in destinazioni:
            if "podSelector" in dest and "namespaceSelector" not in dest \
                    and seleziona((dest["podSelector"] or {}).get("matchLabels") or {}, et):
                return True
    return False


interni = ["JVB_HEALTH_URL", "JIBRI_HEALTH_URL", "JITSI_WEB_INTERNAL_URL",
           "PROSODY_INTERNAL_URL", "JICOFO_HEALTH_URL", "CAPTIONS_STATUS_URL"]
for chiave in interni:
    url = variabili.get(chiave)
    if not url:
        continue
    trovato = re.match(r"^http://([^:/]+)(?::(\d+))?", url)
    if not trovato:
        print(f"{chiave} non è un indirizzo http interno: {url!r}")
        continue
    nome_svc = breve(trovato.group(1))
    if nome_svc is None:
        continue
    porta = int(trovato.group(2) or 80)
    svc = servizi.get(nome_svc)
    if svc is None:
        print(f"{chiave} punta al Service {nome_svc!r}, che non è reso")
        continue
    pods = pod_di(svc)
    if not pods:
        print(f"{chiave}: il Service {nome_svc!r} non seleziona nessun pod reso")
        continue
    for t, n, m in pods:
        cp = porta_pod(svc, porta, m)
        if cp is False:
            print(f"{chiave} usa la porta {porta}, che il Service {nome_svc!r} non espone")
            break
        if politica is not None and cp and not uscita_ammessa((m.get("metadata") or {}).get("labels") or {}, cp):
            print(f"{chiave}: la NetworkPolicy {nome_app} non lascia uscire l'applicazione verso {t}/{n} sulla porta {cp}")

# Conferenza nel cluster: le sonde della pagina di stato hanno i loro indirizzi
# interni, e Jibri si interroga solo se c'è.
web = [n for n in servizi if n.endswith("-web") and any(
    (m.get("metadata") or {}).get("labels", {}).get("app.kubernetes.io/component") == "web"
    for _, _, m in pod_di(servizi[n]))]
jibri_reso = any(n.endswith("-jibri") for n in servizi)
if web:
    for chiave in ("JITSI_WEB_INTERNAL_URL", "PROSODY_INTERNAL_URL", "JICOFO_HEALTH_URL"):
        if not variabili.get(chiave):
            print(f"la conferenza è nel cluster ma l'applicazione non ha {chiave}: la pagina di stato passerebbe dal nome pubblico")
if "JIBRI_HEALTH_URL" in variabili and not jibri_reso:
    print(f"JIBRI_HEALTH_URL è impostato ({variabili['JIBRI_HEALTH_URL']}) ma Jibri non è reso: ogni richiesta della pagina di stato aspetterebbe un Service inesistente")
if jibri_reso and "JIBRI_HEALTH_URL" not in variabili:
    print("Jibri è reso ma l'applicazione non ha JIBRI_HEALTH_URL")
# Jibri recente apre l'API di salute solo su 127.0.0.1: il portale, da un altro
# pod, la raggiunge solo se Jibri la apre su tutte le interfacce.
if jibri_reso and "JIBRI_HEALTH_URL" in variabili:
    for _, nome_j, modello_j, _ in carichi:
        if ((modello_j.get("metadata") or {}).get("labels") or {}).get("app.kubernetes.io/component") != "jibri":
            continue
        ambiente = {}
        for c in (modello_j.get("spec") or {}).get("containers") or []:
            for f in c.get("envFrom") or []:
                ambiente.update(mappe.get((f.get("configMapRef") or {}).get("name"), {}))
            for e in c.get("env") or []:
                if "value" in e:
                    ambiente[e["name"]] = str(e["value"])
        if "jibri.api.http.external-api-host=0.0.0.0" not in str(ambiente.get("JAVA_TOOL_OPTIONS", "")):
            print(f"{nome_j}: senza -Djibri.api.http.external-api-host=0.0.0.0 in JAVA_TOOL_OPTIONS l'API di salute di Jibri ascolta solo su 127.0.0.1 e il portale non la raggiunge (JIBRI_HEALTH_URL)")
        # Lo script di fine registrazione: montato dove Jibri lo cerca, ed e'
        # quello del chart (che firma l'avviso al portale), non una copia.
        spec_j = modello_j.get("spec") or {}
        volumi_j = {v.get("name"): v for v in spec_j.get("volumes") or []}
        script = None
        for c in spec_j.get("containers") or []:
            for m in c.get("volumeMounts") or []:
                if m.get("mountPath") == "/config/finalize.sh":
                    v = volumi_j.get(m.get("name")) or {}
                    dati = mappe.get((v.get("configMap") or {}).get("name"), {})
                    script = dati.get(m.get("subPath") or "finalize.sh")
        if script is None:
            print(f"{nome_j}: nessuno script montato in /config/finalize.sh: le registrazioni restano sul disco di Jibri e il portale non le vede")
        elif script.strip() != SCRIPT_FINE_REGISTRAZIONE:
            print(f"{nome_j}: lo script in /config/finalize.sh non e' files/jibri-finalize.sh del chart")
        elif not script.startswith("#!"):
            print(f"{nome_j}: lo script in /config/finalize.sh non comincia con #! alla prima riga: Jibri lo esegue con /bin/sh, che si ferma sugli array bash e non avvisa il portale")
        # Le variabili che lo script usa con l'applicazione.
        url_app = f"http://{nome_app}:{(servizi.get(nome_app) or {}).get('spec', {}).get('ports', [{}])[0].get('port')}"
        if ambiente.get("APP_INTERNAL_URL") != url_app:
            print(f"{nome_j}: APP_INTERNAL_URL e' {ambiente.get('APP_INTERNAL_URL')!r}, il Service dell'applicazione risponde a {url_app!r}")
        chiavi_j = {e["name"]: e for c in spec_j.get("containers") or [] for e in c.get("env") or []}
        segreto_app = next((f.get("secretRef", {}).get("name") for f in contenitore.get("envFrom") or [] if f.get("secretRef")), None)
        rif = ((chiavi_j.get("CRON_API_KEY") or {}).get("valueFrom") or {}).get("secretKeyRef") or {}
        da_secret = any((f.get("secretRef") or {}).get("name") == segreto_app for c in spec_j.get("containers") or [] for f in c.get("envFrom") or [])
        if rif.get("name") != segreto_app and not da_secret:
            print(f"{nome_j}: CRON_API_KEY non arriva dal Secret dell'applicazione ({segreto_app!r}): lo script non puo' chiedere dove caricare il file")

# Come è installata la piattaforma, per la pagina di stato.
if variabili.get("DEPLOY_PROFILE") not in ("simple", "standard", "full"):
    print(f"DEPLOY_PROFILE è {variabili.get('DEPLOY_PROFILE')!r}: atteso simple, standard o full")
pg_reso = any(t == "StatefulSet" and "postgresql" in n for t, n, _, _ in carichi)
if variabili.get("DATABASE_BUNDLED") != ("true" if pg_reso else "false"):
    print(f"DATABASE_BUNDLED è {variabili.get('DATABASE_BUNDLED')!r} ma il database del chart {'è' if pg_reso else 'non è'} reso")
servizio_app = next((n for n, s in servizi.items() if del_chart(s)
                     and seleziona((s.get("spec") or {}).get("selector") or {},
                                   app["spec"]["template"]["metadata"].get("labels") or {})
                     and any(p.get("port") == 3000 or p.get("targetPort") == "http" for p in s["spec"].get("ports") or [])), None)
if variabili.get("METRICS_JOB") != servizio_app:
    print(f"METRICS_JOB è {variabili.get('METRICS_JOB')!r} ma il Service dell'applicazione, che Prometheus usa come job, è {servizio_app!r}")

# Il ciclo di vita degli eventi: esattamente uno fra lo scaler dei bridge e
# il CronJob del ciclo di vita, altrimenti gli eventi non si aprono e non si
# chiudono da soli.
cron = {n for t, n, _, _ in carichi if t == "CronJob"}
scaler = f"{nome_app}-jvb-scaler" in cron
ciclo = f"{nome_app}-lifecycle" in cron
if scaler == ciclo:
    print("lo scaler dei bridge e il CronJob del ciclo di vita sono " + ("resi entrambi" if scaler else "assenti entrambi: nessuno porterebbe avanti gli eventi"))
if ciclo:
    for t, n, m, _ in carichi:
        if n != f"{nome_app}-lifecycle":
            continue
        testo = " ".join(str(x) for c in (m.get("spec") or {}).get("containers") or []
                         for x in (c.get("command") or []) + (c.get("args") or []))
        if "/api/cron/lifecycle" not in testo or "CRON_API_KEY" not in testo:
            print("il CronJob del ciclo di vita non chiama /api/cron/lifecycle con CRON_API_KEY")
if variabili.get("JVB_SCALER_ENABLED") not in ("true", "false"):
    print(f"JVB_SCALER_ENABLED è {variabili.get('JVB_SCALER_ENABLED')!r}")
elif scaler and variabili["JVB_SCALER_ENABLED"] != "true":
    print("lo scaler è reso ma JVB_SCALER_ENABLED non è \"true\"")

# Bridge fissi: il portale non deve aspettarsene più di quanti ne girano,
# altrimenti la sala d'attesa resta chiusa ad aspettare bridge che non
# arriveranno.
bridge = sum(int(spec.get("replicas") or 0) for t, n, m, spec in carichi
             if t == "Deployment" and (m.get("metadata") or {}).get("labels", {}).get("app.kubernetes.io/component") == "jvb")
if bridge > 0 and variabili.get("JVB_SCALER_ENABLED") == "false":
    tetto = variabili.get("JVB_MAX_REPLICAS")
    if not tetto:
        print(f"{bridge} bridge fissi e nessuno scaler, ma JVB_MAX_REPLICAS non è impostato: il portale se ne aspetterebbe fino a sei")
    elif int(tetto) > bridge:
        print(f"JVB_MAX_REPLICAS è {tetto} ma i bridge fissi sono {bridge}")

# Come lavora il bridge, per la stima delle risorse di un evento: quante voci
# inoltra a ogni partecipante (instradamento delle sole voci più forti) e se
# una conferenza passa da un bridge all'altro (Octo). Il portale lo legge da
# JVB_NUM_LOUDEST e JVB_CASCADING: diversi da quello che il bridge fa, la
# stima sbaglia senza che niente lo dica. L'heap della JVM si imposta con
# VIDEOBRIDGE_MAX_MEMORY: VIDEOBRIDGE_OPTS l'immagine non la legge.
ponte = next((v for n, v in mappe.items() if n.endswith("-jvb") and "COLIBRI_REST_ENABLED" in v), None)
if ponte is not None:
    # Come li legge il bridge: vero è true, yes oppure on, in minuscolo; senza
    # numero, 3.
    acceso, voci = False, 3
    for o in str(ponte.get("VIDEOBRIDGE_DEBUG_OPTIONS") or "").split():
        if o.startswith("-Dvideobridge.loudest.route-loudest-only="):
            acceso = o.split("=", 1)[1] in ("true", "yes", "on")
        elif re.fullmatch(r"-Dvideobridge\.loudest\.num-loudest=\d+", o):
            voci = int(o.split("=", 1)[1])
    voci = voci if acceso else 0
    if variabili.get("JVB_NUM_LOUDEST") != str(voci):
        print(f"il bridge inoltra {voci} voci a ogni partecipante (0 = tutte) ma il portale ha JVB_NUM_LOUDEST={variabili.get('JVB_NUM_LOUDEST')!r}")
    predefinito = int(((yaml.safe_load(open(os.path.join(sys.argv[3], "values.yaml"))).get("global") or {}).get("jvb") or {}).get("numLoudest", 0))
    if predefinito < 1:
        print(f"global.jvb.numLoudest in values.yaml è {predefinito}: l'instradamento delle sole voci più forti deve essere acceso per impostazione predefinita")
    atteso = {"ponte-tutte-le-voci": 0, "ponte-cascata": 3}.get(profilo, predefinito)
    if voci != atteso:
        print(f"il bridge inoltra {voci} voci (0 = tutte) invece delle {atteso} di global.jvb.numLoudest")
    if "VIDEOBRIDGE_OPTS" in ponte:
        print("il bridge ha VIDEOBRIDGE_OPTS, che l'immagine non passa alla JVM: l'heap va in VIDEOBRIDGE_MAX_MEMORY, le altre opzioni in VIDEOBRIDGE_DEBUG_OPTIONS")
    cascata = str(ponte.get("ENABLE_OCTO", "")).lower() == "true"
    if cascata != (variabili.get("JVB_CASCADING") == "true"):
        print(f"il bridge ha ENABLE_OCTO={ponte.get('ENABLE_OCTO')!r} ma il portale ha JVB_CASCADING={variabili.get('JVB_CASCADING')!r}")
    if cascata != (profilo == "ponte-cascata"):
        print(f"cascata fra bridge {'accesa' if cascata else 'spenta'} sul profilo {profilo}")
else:
    for chiave in ("JVB_NUM_LOUDEST", "JVB_CASCADING"):
        if chiave in variabili:
            print(f"{chiave} è impostato ({variabili[chiave]!r}) ma il chart non rende il bridge: il portale stimerebbe un bridge che non conosce")

# Ruoli nella sala: con i token del portale e Jicofo autenticato, ogni
# partecipante diventerebbe moderatore. Il chart spegne l'autenticazione di
# Jicofo e fa assegnare i ruoli a Prosody dal token.
comune = next((v for n, v in mappe.items() if n.endswith("-common") and "ENABLE_AUTH" in v), None)
jicofo = next((v for n, v in mappe.items() if n.endswith("-jicofo") and "JICOFO_ENABLE_REST" in v), None)
prosody = next((v for n, v in mappe.items() if n.endswith("-prosody") and "AUTH_TYPE" in v), None)
if comune is not None and jicofo is not None and prosody is not None:
    if str(comune.get("ENABLE_AUTH")) == "true" and str(prosody.get("AUTH_TYPE")) == "jwt":
        if str(jicofo.get("JICOFO_ENABLE_AUTH", "")).lower() not in ("false", "0"):
            print("Jicofo ha l'autenticazione accesa con i token del portale: ogni partecipante diventerebbe moderatore")
        moduli = [m.strip() for m in str(prosody.get("XMPP_MUC_MODULES", "")).split(",") if m.strip()]
        if "token_affiliation" not in moduli:
            print("Prosody non carica token_affiliation: i ruoli nella sala non verrebbero dal token")
        if "pa_media_lock" not in moduli:
            print("Prosody non carica pa_media_lock: i limiti dei partecipanti varrebbero solo nella barra della sala")
        if str(jicofo.get("ENABLE_AUTO_OWNER", "")).lower() != "false":
            print("Jicofo con ENABLE_AUTO_OWNER acceso: il primo a entrare diventerebbe moderatore")
        # Ogni modulo del progetto richiesto deve arrivare, con il suo aggancio,
        # da un ConfigMap montato in /prosody-plugins-custom.
        agganci = {
            "token_affiliation_custom": "muc-occupant-pre-join",
            "pa_media_lock": "muc-occupant-joined",
            "pa_captions": "muc-room-created",
            "pa_occupants": "muc-occupant-joined",
        }
        sts = next((d for d in docs if d.get("kind") == "StatefulSet" and d["metadata"]["name"].endswith("-prosody")), None)
        for nome, aggancio in agganci.items():
            if nome not in moduli:
                continue
            ok = False
            if sts:
                ps = sts["spec"]["template"]["spec"]
                volumi = {v["name"]: v for v in ps.get("volumes") or []}
                for c in ps.get("containers") or []:
                    for vm in c.get("volumeMounts") or []:
                        if not str(vm.get("mountPath", "")).startswith("/prosody-plugins-custom"):
                            continue
                        cm = ((volumi.get(vm["name"]) or {}).get("configMap") or {}).get("name")
                        if cm in mappe and f"mod_{nome}.lua" in mappe[cm] \
                                and aggancio in mappe[cm][f"mod_{nome}.lua"]:
                            ok = True
            if not ok:
                print(f"Prosody carica {nome} ma nessun ConfigMap reso lo monta in /prosody-plugins-custom")

# Il Service dell'applicazione seleziona i pod per nome e istanza e manda il
# traffico alla porta `http`: un altro pod con quelle etichette e una porta
# con quel nome finirebbe fra gli indirizzi del portale, e una richiesta ogni
# tanto risponderebbe qualcun altro.
if servizio_app:
    for t, n, m in pod_di(servizi[servizio_app]):
        if n == nome_app:
            continue
        if any(cp.get("name") == "http" for c in (m.get("spec") or {}).get("containers") or [] for cp in c.get("ports") or []):
            print(f"{t}/{n} ha una porta chiamata http ed è selezionato dal Service {servizio_app}: riceverebbe richieste del portale")

# Sottotitoli live: il servizio, l'indirizzo che Jicofo dà al bridge, il
# modulo di Prosody e l'indirizzo dello stato per il portale vanno insieme.
# Uno senza gli altri non è un errore di installazione: è un moderatore che
# accende i sottotitoli e non vede niente.
sottotitoli = [(t, n, m, spec) for t, n, m, spec in carichi if t == "Deployment"
               and ((m.get("metadata") or {}).get("labels") or {}).get("app.kubernetes.io/component") == "captions"]
opzioni = str((jicofo or {}).get("JAVA_TOOL_OPTIONS", "")).split() if jicofo is not None else []
modello_url = next((o.split("=", 1)[1] for o in opzioni if o.startswith("-Djicofo.transcription.url-template=")), None)
intestazione = next((o.split("=", 1)[1] for o in opzioni if o.startswith("-Djicofo.transcription.http-headers.X-Captions-Token=")), None)
moduli_p = [x.strip() for x in str((prosody or {}).get("XMPP_MUC_MODULES", "")).split(",") if x.strip()]
if len(sottotitoli) > 1:
    print(f"{len(sottotitoli)} Deployment dei sottotitoli resi invece di uno")
if sottotitoli:
    _, nome_s, modello_s, spec_s = sottotitoli[0]
    ps = modello_s.get("spec") or {}
    if jicofo is not None:
        trovato = re.match(r"^ws://([a-z0-9-]+):(\d+)/transcribe/\{\{MEETING_ID\}\}$", modello_url or "")
        if not trovato:
            print(f"Jicofo non ha l'indirizzo dei sottotitoli in JAVA_TOOL_OPTIONS (url-template {modello_url!r}): il bridge non saprebbe dove mandare l'audio")
        else:
            svc = servizi.get(trovato.group(1))
            if svc is None:
                print(f"Jicofo manda l'audio al Service {trovato.group(1)!r}, che non è reso")
            elif not any(n == nome_s for _, n, _ in pod_di(svc)):
                print(f"il Service {trovato.group(1)} non seleziona {nome_s}")
            elif not porta_pod(svc, int(trovato.group(2)), modello_s):
                print(f"il Service {trovato.group(1)} non espone la porta {trovato.group(2)} dei sottotitoli")
    if prosody is not None:
        if str(prosody.get("PA_CAPTIONS_ENABLED")) != "true":
            print(f"i sottotitoli sono resi ma Prosody ha PA_CAPTIONS_ENABLED={prosody.get('PA_CAPTIONS_ENABLED')!r}: le stanze non sarebbero trascrivibili")
        if "pa_captions" not in moduli_p:
            print("i sottotitoli sono resi ma Prosody non carica pa_captions")
    if not variabili.get("CAPTIONS_STATUS_URL"):
        print("i sottotitoli sono resi ma l'applicazione non ha CAPTIONS_STATUS_URL")
    gw = next((c for c in ps.get("containers") or [] if c.get("name") == "gateway"), {})
    amb = {e["name"]: e for e in gw.get("env") or []}
    if (amb.get("CAPTIONS_AUTH_TOKEN") or {}).get("value") != intestazione:
        print("il segreto dei sottotitoli non è lo stesso nel gateway (CAPTIONS_AUTH_TOKEN) e in Jicofo (X-Captions-Token): il gateway rifiuterebbe il bridge")
    # Le voci trascritte insieme: il portale ne stima le risorse con lo
    # stesso numero che il gateway applica.
    if variabili.get("CAPTIONS_MAX_STREAMS") != str((amb.get("CAPTIONS_MAX_STREAMS") or {}).get("value")):
        print(f"il gateway trascrive al massimo {(amb.get('CAPTIONS_MAX_STREAMS') or {}).get('value')!r} voci ma il portale ha CAPTIONS_MAX_STREAMS={variabili.get('CAPTIONS_MAX_STREAMS')!r}")
    contesto = str((amb.get("CAPTIONS_CONTEXT_URL") or {}).get("value", ""))
    porta_app = (servizi.get(nome_app) or {}).get("spec", {}).get("ports", [{}])[0].get("port")
    if contesto != f"http://{nome_app}:{porta_app}/api/internal/captions/context":
        print(f"CAPTIONS_CONTEXT_URL è {contesto!r}: il Service dell'applicazione risponde a http://{nome_app}:{porta_app}")
    rif = ((amb.get("CAPTIONS_CONTEXT_TOKEN") or {}).get("valueFrom") or {}).get("secretKeyRef") or {}
    segreto_app = next((f.get("secretRef", {}).get("name") for f in contenitore.get("envFrom") or [] if f.get("secretRef")), None)
    if rif.get("name") != segreto_app or rif.get("key") != "CRON_API_KEY":
        print(f"CAPTIONS_CONTEXT_TOKEN non arriva da CRON_API_KEY del Secret dell'applicazione ({segreto_app!r}): il portale rifiuterebbe le richieste del gateway")
    scarica = next((c for c in ps.get("initContainers") or [] if c.get("name") == "fetch-model"), None)
    if scarica is None:
        print(f"{nome_s}: nessun initContainer fetch-model, il motore partirebbe senza modello")
    else:
        amb_f = {e["name"]: str(e.get("value", "")) for e in scarica.get("env") or []}
        if not re.match(r"^[0-9a-f]{64}$", amb_f.get("CAPTIONS_MODEL_SHA256", "")):
            print(f"{nome_s}: CAPTIONS_MODEL_SHA256 non è un'impronta SHA-256")
    if not (ps.get("securityContext") or {}).get("runAsNonRoot"):
        print(f"{nome_s}: il pod non è dichiarato senza privilegi (runAsNonRoot)")
    for c in (ps.get("containers") or []) + (ps.get("initContainers") or []):
        csc = c.get("securityContext") or {}
        if not (csc.get("readOnlyRootFilesystem") and csc.get("allowPrivilegeEscalation") is False):
            print(f"{nome_s}/{c.get('name')}: il contenitore non ha il filesystem in sola lettura senza escalation di privilegi")
    scaler_s = f"{nome_app}-jvb-scaler" in {n for t, n, _, _ in carichi if t == "CronJob"}
    if scaler_s and "replicas" in spec_s:
        print(f"{nome_s} scrive le repliche ({spec_s['replicas']}) ma lo scaler le porta: ogni aggiornamento le rimetterebbe al valore del chart")
    if not scaler_s and spec_s.get("replicas") != 1:
        print(f"{nome_s}: senza scaler serve una replica fissa, non {spec_s.get('replicas')!r}")
else:
    if modello_url or intestazione:
        print("i sottotitoli non sono resi ma Jicofo ha ancora l'indirizzo del servizio in JAVA_TOOL_OPTIONS")
    if prosody is not None and str(prosody.get("PA_CAPTIONS_ENABLED")) == "true":
        print("i sottotitoli non sono resi ma Prosody ha PA_CAPTIONS_ENABLED=true")
    if variabili.get("CAPTIONS_STATUS_URL"):
        print(f"i sottotitoli non sono resi ma l'applicazione ha CAPTIONS_STATUS_URL ({variabili['CAPTIONS_STATUS_URL']})")
    if variabili.get("CAPTIONS_MAX_STREAMS"):
        print(f"i sottotitoli non sono resi ma l'applicazione ha CAPTIONS_MAX_STREAMS ({variabili['CAPTIONS_MAX_STREAMS']})")

# Autorità di certificazione in più: il file indicato a Node deve esistere nel
# volume montato.
ca = variabili.get("NODE_EXTRA_CA_CERTS")
if profilo == "semplice-ca" and not ca:
    print("app.extraCaCerts è impostato ma NODE_EXTRA_CA_CERTS no")
if ca:
    volumi = {v["name"]: v for v in app["spec"]["template"]["spec"].get("volumes") or []}
    trovato = False
    for vm in contenitore.get("volumeMounts") or []:
        base = str(vm.get("mountPath", "")).rstrip("/") + "/"
        if not ca.startswith(base):
            continue
        sorgente = volumi.get(vm["name"]) or {}
        voci = ((sorgente.get("configMap") or sorgente.get("secret") or {}).get("items")) or []
        if vm.get("readOnly") and any(base + i.get("path", "") == ca for i in voci):
            trovato = True
    if not trovato:
        print(f"NODE_EXTRA_CA_CERTS è {ca} ma nessun volume in sola lettura monta quel file")
PY
  then
    errore "controllo della conferenza non eseguito su $nome: $(head -3 "$OUT/$nome.conf.err" | tr '\n' ' ')"
  fi
  while read -r problema; do
    [ -n "$problema" ] && errore "$problema"
  done <"$OUT/$nome.conf"

  # Nomi pubblici, richieste dei componenti della conferenza e copia del
  # database: difetti che non fermano l'installazione e si vedono usandola,
  # cioè link verso un nome e Ingress su un altro, Jicofo ucciso per primo a
  # memoria scarsa, copie leggibili da tutti o che nessuno sa ripristinare.
  if ! python3 - "$reso" "$nome" >"$OUT/$nome.sito" 2>"$OUT/$nome.sito.err" <<'PY'
import sys
from urllib.parse import urlparse

import yaml

docs = [d for d in yaml.safe_load_all(open(sys.argv[1])) if d]
profilo = sys.argv[2]


def del_chart(d):
    return str((d["metadata"].get("labels") or {}).get("helm.sh/chart", "")).startswith("pa-webinar-")


def modelli():
    for d in docs:
        tipo, spec = d.get("kind"), d.get("spec") or {}
        if tipo in ("Deployment", "StatefulSet"):
            yield tipo, d, spec.get("template") or {}
        elif tipo == "CronJob":
            job = (spec.get("jobTemplate") or {}).get("spec") or {}
            yield tipo, d, job.get("template") or {}


def componente(modello):
    return ((modello.get("metadata") or {}).get("labels") or {}).get("app.kubernetes.io/component")


mappe = {d["metadata"]["name"]: d.get("data") or {} for d in docs if d.get("kind") == "ConfigMap"}
servizi = {d["metadata"]["name"] for d in docs if d.get("kind") == "Service"}
app = next((d for d in docs if d.get("kind") == "Deployment" and del_chart(d)
            and "app.kubernetes.io/component" not in (d["spec"]["template"]["metadata"].get("labels") or {})), None)
if app is None:
    sys.exit(0)
nome_app = app["metadata"]["name"]
env = mappe.get(nome_app, {})

# ── Nomi pubblici: link dell'applicazione e Ingress sullo stesso nome ──
ingress = [d for d in docs if d.get("kind") == "Ingress"]


def regole(ing, esatte=False):
    """Gli host delle regole con percorso / (Prefix, o Exact se richiesto)."""
    for r in (ing.get("spec") or {}).get("rules") or []:
        for p in ((r.get("http") or {}).get("paths") or []):
            if p.get("path") == "/" and (p.get("pathType") == "Exact") == esatte:
                yield r.get("host")


portale = next((d for d in ingress if d["metadata"]["name"] == nome_app), None)
url = env.get("NEXT_PUBLIC_APP_URL", "")
if portale is not None:
    host_url = urlparse(url).hostname if url else None
    for h in regole(portale):
        if h != host_url:
            print(f"l'Ingress del portale serve {h!r} ma NEXT_PUBLIC_APP_URL è {url!r}")
for ing in ingress:
    ospiti = {r.get("host") for r in (ing.get("spec") or {}).get("rules") or []}
    for t in (ing.get("spec") or {}).get("tls") or []:
        for h in t.get("hosts") or []:
            if h not in ospiti:
                print(f"l'Ingress {ing['metadata']['name']} chiede un certificato per {h!r}, che non serve")

comune = next((v for n, v in mappe.items() if n.endswith("-common") and "PUBLIC_URL" in v), None)
dominio = env.get("NEXT_PUBLIC_JITSI_DOMAIN")
if comune is not None:
    pubblico = urlparse(str(comune.get("PUBLIC_URL", ""))).hostname
    if pubblico != dominio:
        print(f"la conferenza si crede su {pubblico!r} (PUBLIC_URL) ma il portale la apre su {dominio!r} (NEXT_PUBLIC_JITSI_DOMAIN)")
    sale = [d["metadata"]["name"] for d in ingress for h in regole(d) if h == dominio]
    if len(sale) != 1:
        print(f"il nome della conferenza {dominio!r} è servito sul percorso / da {len(sale)} Ingress ({', '.join(sale) or 'nessuno'}): ne serve esattamente uno")
    for conf in (d for d in ingress if d["metadata"]["name"] in sale and d["metadata"]["name"].endswith("-conference")):
        dietro = {p["backend"]["service"]["name"] for r in conf["spec"]["rules"] for p in r["http"]["paths"]}
        if not dietro <= servizi:
            print(f"l'Ingress {conf['metadata']['name']} punta a {sorted(dietro)}, Service non resi")
        if (conf["metadata"].get("annotations") or {}).get("cert-manager.io/cluster-issuer", "x") in (None, ""):
            print(f"l'Ingress {conf['metadata']['name']} ha un'annotazione di cert-manager vuota")
if profilo in ("k3s", "k3s-sito", "k3s-componenti", "semplice-minikube", "minikube-sito"):
    for ing in ingress:
        if "cert-manager.io/cluster-issuer" in (ing["metadata"].get("annotations") or {}):
            print(f"l'Ingress {ing['metadata']['name']} porta ancora l'annotazione di cert-manager, che su questo profilo non c'è")

if profilo in ("k3s-sito", "semplice-sito", "minikube-sito"):
    atteso = {"k3s-sito": ("webinar.ente.example", "meet.ente.example"),
              "semplice-sito": ("webinar.ente.example", "meet.ente.example"),
              "minikube-sito": ("app.192.0.2.10.nip.io", "jitsi.192.0.2.10.nip.io")}[profilo]
    if url != f"https://{atteso[0]}" or dominio != atteso[1]:
        print(f"site.* non ricavato: NEXT_PUBLIC_APP_URL={url!r}, NEXT_PUBLIC_JITSI_DOMAIN={dominio!r}")
    tutti = {r.get("host") for d in ingress for r in (d.get("spec") or {}).get("rules") or []}
    if tutti != set(atteso):
        print(f"gli Ingress servono {sorted(tutti)} invece dei nomi di site.* {list(atteso)}")
    senza = [d["metadata"]["name"] for d in ingress if not (d.get("spec") or {}).get("tls")]
    if senza:
        print(f"Ingress senza tls con site.* e certificati indicati: {senza}")

# ── Componenti della conferenza: richieste e sonda del bridge ──
for tipo, d, m in modelli():
    comp = componente(m)
    if comp not in ("jicofo", "prosody", "web", "jvb") or "jitsi-meet" not in d["metadata"]["name"]:
        continue
    # Il container principale; gli altri sono esportatori di metriche.
    for c in ((m.get("spec") or {}).get("containers") or [])[:1]:
        richieste = (c.get("resources") or {}).get("requests") or {}
        if comp != "jvb" and not ("cpu" in richieste and "memory" in richieste):
            print(f"{tipo}/{d['metadata']['name']}: nessuna richiesta di CPU e memoria, primo a essere ucciso a memoria scarsa")
        if comp == "jvb":
            sonda = c.get("livenessProbe") or {}
            if int(sonda.get("timeoutSeconds") or 1) < 5 or \
                    int(sonda.get("periodSeconds") or 10) * int(sonda.get("failureThreshold") or 3) < 60:
                print(f"{tipo}/{d['metadata']['name']}: sonda di vita del bridge troppo stretta ({sonda}): un nodo carico lo riavvia e fa cadere le conferenze")
            pronto = c.get("readinessProbe") or {}
            if pronto and (int(pronto.get("timeoutSeconds") or 1) < 5 or
                           int(pronto.get("periodSeconds") or 10) * int(pronto.get("failureThreshold") or 3) < 30):
                print(f"{tipo}/{d['metadata']['name']}: sonda di prontezza del bridge troppo stretta ({pronto}): su un nodo carico il bridge esce dal Service della sua API e il portale lo legge come spento")

# ── Lavori pianificati che chiamano il portale ──
# All'avvio a freddo il portale non risponde per un minuto o più: ogni
# chiamata di un CronJob deve riprovare qualunque errore per almeno un minuto
# (pa-webinar.cronCurlRetry), altrimenti i primi giri lasciano pod in Error, e
# la finestra dei tentativi deve stare nella scadenza del Job.
import re

for tipo, d, m in modelli():
    if tipo != "CronJob":
        continue
    scadenza = ((d["spec"].get("jobTemplate") or {}).get("spec") or {}).get("activeDeadlineSeconds")
    for c in (m.get("spec") or {}).get("containers") or []:
        testo = "\n".join(str(x) for x in (c.get("command") or []) + (c.get("args") or []))
        for riga in testo.replace("\\\n", " ").splitlines():
            if not re.search(r"\bcurl\b", riga) or not re.search(r"/api/(cron|internal)/", riga):
                continue
            nome_cj = d["metadata"]["name"]
            finestra = re.search(r"--retry-max-time (\d+)", riga)
            tentativi = re.search(r"--retry (\d+)", riga)
            pausa = re.search(r"--retry-delay (\d+)", riga)
            if "--retry-connrefused" not in riga or not (finestra and tentativi and pausa):
                print(f"{nome_cj}: la chiamata al portale non usa pa-webinar.cronCurlRetry "
                      f"(--retry-connrefused, --retry-max-time): all'avvio a freddo fallisce e lascia pod in Error")
                continue
            secondi = int(finestra.group(1))
            if secondi < 60:
                print(f"{nome_cj}: riprova per {secondi} s, meno di un minuto: non copre l'avvio a freddo del portale")
            if int(tentativi.group(1)) * int(pausa.group(1)) < secondi:
                print(f"{nome_cj}: {tentativi.group(1)} tentativi ogni {pausa.group(1)} s finiscono prima dei {secondi} s di --retry-max-time")
            if scadenza is not None and secondi + 30 > int(scadenza):
                print(f"{nome_cj}: {secondi} s di tentativi non lasciano tempo al lavoro nella scadenza del Job ({scadenza} s)")

# ── Copia del database ──
copie = {d["metadata"]["name"]: (d, m) for tipo, d, m in modelli()
         if tipo == "CronJob" and componente(m) == "backup"}
if profilo in ("k3s-sito", "semplice-backup") and len(copie) != 2:
    print(f"copia del database accesa ma i CronJob resi sono {sorted(copie)}")
pg = next((d for d in docs if d.get("kind") == "StatefulSet" and "postgresql" in d["metadata"]["name"]), None)
pvc = {d["metadata"]["name"]: d for d in docs if d.get("kind") == "PersistentVolumeClaim"}
segreti = {d["metadata"]["name"]: set((d.get("stringData") or d.get("data") or {}).keys())
           for d in docs if d.get("kind") == "Secret"}


def cerca(nodo, chiave):
    if isinstance(nodo, dict):
        for k, v in nodo.items():
            if k == chiave and isinstance(v, str):
                yield v
            else:
                yield from cerca(v, chiave)
    elif isinstance(nodo, list):
        for v in nodo:
            yield from cerca(v, chiave)


for nome_cj, (cj, m) in copie.items():
    ps = m.get("spec") or {}
    c = (ps.get("containers") or [{}])[0]
    testo = " ".join(str(x) for x in (c.get("command") or []) + (c.get("args") or []))
    if nome_cj.endswith("-backup-tools"):
        if cj["spec"].get("suspend") is not True:
            print(f"{nome_cj} non è sospeso: partirebbe da solo")
        if "pg_restore" in testo or "pg_dump" in testo:
            print(f"{nome_cj} esegue da solo un'operazione sul database: deve solo aspettare i comandi di chi lo apre")
    else:
        for pezzo in ("umask 077", "pg_dump --format=custom", "pg_restore --list", "RETENTION"):
            if pezzo not in testo:
                print(f"{nome_cj}: il comando non contiene {pezzo!r}")
        if cj["spec"].get("concurrencyPolicy") != "Forbid":
            print(f"{nome_cj}: due copie potrebbero girare insieme sullo stesso volume")
    variabili = {e["name"]: e for e in c.get("env") or []}
    if pg is not None and c.get("image") != pg["spec"]["template"]["spec"]["containers"][0]["image"]:
        print(f"{nome_cj}: immagine {c.get('image')} diversa da quella del database: pg_dump deve essere della stessa versione")
    host = (variabili.get("PGHOST") or {}).get("value")
    if host not in servizi:
        print(f"{nome_cj}: PGHOST {host!r} non è un Service reso")
    rif = ((variabili.get("PGPASSWORD") or {}).get("valueFrom") or {}).get("secretKeyRef") or {}
    montati = set(cerca(pg["spec"]["template"]["spec"], "secretName")) if pg else set()
    if rif.get("name") not in montati:
        print(f"{nome_cj}: la password viene dal Secret {rif.get('name')!r}, che il database non usa ({sorted(montati)})")
    if rif.get("name") in segreti and rif.get("key") not in segreti[rif["name"]]:
        print(f"{nome_cj}: il Secret {rif['name']} non ha la chiave {rif.get('key')}")
    sc = ps.get("securityContext") or {}
    csc = c.get("securityContext") or {}
    if not (sc.get("runAsNonRoot") and csc.get("readOnlyRootFilesystem") and csc.get("allowPrivilegeEscalation") is False):
        print(f"{nome_cj}: il pod non gira come utente senza privilegi con il filesystem in sola lettura")
    if ps.get("automountServiceAccountToken") is not False:
        print(f"{nome_cj}: il pod riceve un token dell'API di Kubernetes che non gli serve")
    volumi = {v["name"]: v for v in ps.get("volumes") or []}
    claim = ((volumi.get("backup") or {}).get("persistentVolumeClaim") or {}).get("claimName")
    if profilo == "semplice-backup":
        if claim != "copie-db" or any(n.endswith("-backup") for n in pvc):
            print(f"{nome_cj}: con persistence.existingClaim il volume deve essere quello indicato e nessun PVC va reso (claim {claim!r})")
        if (variabili.get("RETENTION") or {}).get("value") != "3":
            print(f"{nome_cj}: RETENTION non segue backup.retention")
    elif claim not in pvc:
        print(f"{nome_cj}: il volume {claim!r} non è un PVC reso")
    elif (pvc[claim]["metadata"].get("annotations") or {}).get("helm.sh/resource-policy") != "keep":
        print(f"il PVC {claim} delle copie non ha helm.sh/resource-policy: keep: helm uninstall lo cancellerebbe")
PY
  then
    errore "controllo di nomi, conferenza e copie non eseguito su $nome: $(head -3 "$OUT/$nome.sito.err" | tr '\n' ' ')"
  fi
  while read -r problema; do
    [ -n "$problema" ] && errore "$problema"
  done <"$OUT/$nome.sito"

  # Storage e TURN degli addon di k3s (infra/onprem/k3s/addons). Gli script
  # creano fuori dal chart oggetti che contano su nomi, etichette e porte di
  # questa resa: se il chart o il sottochart li cambiano, lo storage o il TURN
  # smettono di funzionare senza che l'installazione fallisca.
  if ! python3 - "$reso" "$nome" "infra/onprem/k3s/addons" "$OUT" >"$OUT/$nome.addon" 2>"$OUT/$nome.addon.err" <<'PY'
import re
import sys

import yaml

docs = [d for d in yaml.safe_load_all(open(sys.argv[1])) if d]
profilo = sys.argv[2]
cartella = sys.argv[3]


def di(tipo):
    return [d for d in docs if d.get("kind") == tipo]


def etichette(d):
    return (((d.get("spec") or {}).get("template") or {}).get("metadata") or {}).get("labels") or {}


mappe = {d["metadata"]["name"]: d.get("data") or {} for d in di("ConfigMap")}
app = next((v for v in mappe.values() if "NEXT_PUBLIC_APP_URL" in v), {})

# In ogni profilo: le registrazioni si caricano e si riproducono dal browser
# con URL firmati, quindi il loro indirizzo è un'origine https. Quello dei
# file lo usano solo i pod.
v = app.get("RECORDING_S3_ENDPOINT")
if v and not str(v).startswith("https://"):
    print(f"RECORDING_S3_ENDPOINT={v!r}: lo storage delle registrazioni deve essere un'origine https raggiungibile dai browser")

if profilo == "k3s-addon":
    # I file di stato emulati qui sopra hanno le stesse chiavi di quelli che
    # gli script scrivono: si ricavano dalle righe `echo` del blocco che
    # finisce in "$FILE_VALORI", con le variabili al posto dei valori.
    def generato(script):
        testo = open(f"{cartella}/{script}").read()
        inizio = testo.index("FILE_VALORI=")
        fine = testo.index('> "$FILE_VALORI"', inizio)
        righe = []
        for r in testo[inizio:fine].splitlines():
            m = re.match(r'\s*echo "(.*)"\s*$', r)
            if m:
                righe.append(re.sub(r"\$\{?[A-Za-z_][A-Za-z_0-9]*\}?", "x", m.group(1).replace('\\"', '"')))
        return yaml.safe_load("\n".join(righe)) or {}

    def percorsi(nodo, prefisso=""):
        if isinstance(nodo, dict):
            for k, v in nodo.items():
                yield from percorsi(v, f"{prefisso}.{k}" if prefisso else str(k))
        else:
            yield prefisso

    facoltativi = {"app.extraCaCerts.configMapName", "app.extraCaCerts.key"}
    for script, emulato in (("storage.sh", "addon-storage.yaml"), ("turn.sh", "addon-turn.yaml")):
        da_script = set(percorsi(generato(script))) - facoltativi
        da_qui = set(percorsi(yaml.safe_load(open(f"{sys.argv[4]}/{emulato}")) or {}))
        if da_script != da_qui:
            print(f"{emulato} non ha le chiavi che scrive {script}: mancano {sorted(da_script - da_qui)}, in più {sorted(da_qui - da_script)}")

    # Storage: i bucket e la regione del file di esempio sono quelli che
    # storage.sh crea.
    costanti = dict(re.findall(r'^(REGIONE|BUCKET_FILE|BUCKET_REGISTRAZIONI)="([^"]+)"',
                               open(f"{cartella}/storage.sh").read(), re.M))
    attesi = {"STORAGE_FILES_PROVIDER": "s3",
              "STORAGE_FILES_S3_BUCKET": costanti.get("BUCKET_FILE"),
              "RECORDING_S3_BUCKET": costanti.get("BUCKET_REGISTRAZIONI"),
              "STORAGE_FILES_S3_REGION": costanti.get("REGIONE"),
              "RECORDING_S3_REGION": costanti.get("REGIONE"),
              "STORAGE_FILES_S3_ENDPOINT": "https://s3.ente.example",
              "RECORDING_S3_ENDPOINT": "https://s3.ente.example"}
    for k, v in attesi.items():
        if str(app.get(k)) != str(v):
            print(f"storage degli addon: {k} è {app.get(k)!r}, storage.sh si aspetta {v!r}")
    jibri = [d for d in di("Deployment") + di("StatefulSet") if etichette(d).get("app.kubernetes.io/component") == "jibri"]
    if app.get("RECORDING_STORAGE_TYPE") and not jibri:
        print("RECORDING_STORAGE_TYPE impostato senza Jibri: il portale aspetterebbe un registratore che non c'è")
    # Il portale raggiunge lo storage dal nome pubblico, cioè da Traefik.
    uscita = [r for pol in di("NetworkPolicy") if pol["metadata"]["name"] == "videocall-pa-webinar"
              for r in pol["spec"].get("egress") or []
              if any((t.get("namespaceSelector") or {}).get("matchLabels", {}).get("kubernetes.io/metadata.name") == "kube-system"
                     for t in r.get("to") or [])
              and any(p.get("port") == 8443 for p in r.get("ports") or [])]
    if not uscita:
        print("la NetworkPolicy del portale non lascia uscire verso Traefik (kube-system, 8443): lo storage su s3.<...> non si raggiunge")

    # TURN: coturn reso, con le etichette su cui contano il Service TCP e la
    # NetworkPolicy di turn.sh.
    coturn = [d for d in di("Deployment") if etichette(d).get("app.kubernetes.io/component") == "coturn"]
    if len(coturn) != 1:
        print(f"TURN degli addon: {len(coturn)} Deployment di coturn resi invece di uno")
    for d in coturn:
        et = etichette(d)
        voluti = {"app.kubernetes.io/name": "jitsi-meet", "app.kubernetes.io/instance": "videocall",
                  "app.kubernetes.io/component": "coturn"}
        if any(et.get(k) != v for k, v in voluti.items()):
            print(f"coturn ha le etichette {et}: turn.sh seleziona {voluti}")
        c = d["spec"]["template"]["spec"]["containers"][0]
        porte = {(p.get("protocol", "TCP"), p.get("containerPort")) for p in c.get("ports") or []}
        if ("TCP", 3478) not in porte:
            print("coturn non espone TCP 3478, verso cui Traefik inoltra TURNS")
        if c.get("command"):
            print("coturn ha un comando proprio: l'indirizzo dei relay (REAL_EXTERNAL_IP) lo legge solo il comando dell'immagine")
        sorgenti = [f.get("secretRef", {}).get("name") for f in c.get("envFrom") or [] if f.get("secretRef")]
        if "videocall-turn" not in sorgenti:
            print(f"coturn non legge il segreto dal Secret di turn.sh (legge {sorgenti})")
    servizi = [d for d in di("Service") if d["metadata"]["name"] == "videocall-jitsi-meet-coturn"]
    for svc in servizi:
        porte = sorted((p.get("protocol", "TCP"), p.get("port")) for p in svc["spec"].get("ports") or [])
        if svc["spec"].get("type") != "LoadBalancer" or porte != [("UDP", 3478)]:
            print(f"Service di coturn {svc['spec'].get('type')} {porte}: su k3s serve LoadBalancer con la sola UDP 3478 (la 443 è di Traefik)")
    if not servizi:
        print("Service di coturn non reso")
    if di("Certificate"):
        print("reso un Certificate di cert-manager: su k3s il TLS di TURNS lo termina Traefik")
    if any("TURN_CREDENTIALS" in ((d.get("stringData") or d.get("data") or {})) for d in di("Secret")):
        print("il chart rende un segreto di coturn: cambierebbe a ogni resa invece di venire dal Secret di turn.sh")
    conf = str(mappe.get("videocall-jitsi-meet-coturn-config", {}).get("turnserver.conf", ""))
    if "tls-listening-port" in conf or "no-tls" not in conf:
        print("coturn ascolta anche in TLS: su k3s TURNS arriva da Traefik in chiaro su TCP 3478")
    for r in ("10.42.0.0-10.42.0.255", "203.0.113.10"):
        if f"allowed-peer-ip={r}" not in conf:
            print(f"allowed-peer-ip={r} manca nella configurazione di coturn")
    if str(mappe.get("videocall-jitsi-meet-coturn", {}).get("REAL_EXTERNAL_IP")) != "203.0.113.10":
        print("REAL_EXTERNAL_IP non arriva a coturn: i relay verrebbero annunciati come 0.0.0.0")
    if di("PodDisruptionBudget") and any("coturn" in d["metadata"]["name"] for d in di("PodDisruptionBudget")):
        print("PodDisruptionBudget di coturn reso: con un solo coturn su un solo nodo blocca lo svuotamento del nodo")
    # Prosody annuncia TURN su UDP 3478 e TURNS sulla 443, e l'override di
    # TURNS_PORT vince solo se il suo ConfigMap viene dopo quello di coturn.
    turn = mappe.get("videocall-jitsi-meet-prosody-coturn", {})
    prosody = mappe.get("videocall-jitsi-meet-prosody", {})
    if (turn.get("TURN_HOST"), str(turn.get("TURN_PORT")), turn.get("TURN_TRANSPORT")) != ("turn.ente.example", "3478", "udp"):
        print(f"Prosody annuncia TURN come {turn.get('TURN_HOST')}:{turn.get('TURN_PORT')}/{turn.get('TURN_TRANSPORT')}")
    if (prosody.get("TURNS_HOST"), str(prosody.get("TURNS_PORT"))) != ("turn.ente.example", "443"):
        print(f"Prosody annuncia TURNS come {prosody.get('TURNS_HOST')}:{prosody.get('TURNS_PORT')}, non turn.ente.example:443")
    for sts in di("StatefulSet"):
        if etichette(sts).get("app.kubernetes.io/component") != "prosody":
            continue
        ordine = [f.get("configMapRef", {}).get("name") for f in sts["spec"]["template"]["spec"]["containers"][0].get("envFrom") or []]
        if "videocall-jitsi-meet-prosody-coturn" not in ordine or "videocall-jitsi-meet-prosody" not in ordine or \
                ordine.index("videocall-jitsi-meet-prosody-coturn") > ordine.index("videocall-jitsi-meet-prosody"):
            print(f"in Prosody il ConfigMap di coturn non precede quello con TURNS_PORT: {ordine}")
    # La NetworkPolicy di turn.sh apre a coturn la sola porta dei media del bridge.
    bridge = [p.get("containerPort") for d in di("Deployment") if etichette(d).get("app.kubernetes.io/component") == "jvb"
              for c in d["spec"]["template"]["spec"]["containers"] for p in c.get("ports") or []
              if p.get("protocol") == "UDP"]
    if 10000 not in bridge:
        print(f"il bridge non riceve i media su UDP 10000 ({bridge}): turn.sh va lanciato con --jvb-port")
PY
  then
    errore "controllo degli addon non eseguito su $nome: $(head -3 "$OUT/$nome.addon.err" | tr '\n' ' ')"
  fi
  while read -r problema; do
    [ -n "$problema" ] && errore "$problema"
  done <"$OUT/$nome.addon"

  # Post-produzione AI: quale worker prende quali lavori, quale motore si
  # accende. Difetti che non fermano l'installazione e si pagano dopo: una
  # trascrizione presa dal worker senza GPU e uccisa a metà, la GPU accesa per
  # tradurre due righe di testo, un motore di traduzione che scarica un
  # modello diverso o finisce sul pool con la GPU.
  if ! python3 - "$reso" "$nome" >"$OUT/$nome.pp" 2>"$OUT/$nome.pp.err" <<'PY'
import json
import os
import re
import subprocess
import sys
import tempfile

import yaml

docs = [d for d in yaml.safe_load_all(open(sys.argv[1])) if d]
profilo = sys.argv[2]
GPU = {"TRANSCRIBE", "TRANSCRIBE_MULTITRACK", "DUB"}


def del_chart(d):
    return str((d["metadata"].get("labels") or {}).get("helm.sh/chart", "")).startswith("pa-webinar-")


def pod(d):
    spec = d.get("spec") or {}
    if d.get("kind") == "CronJob":
        spec = ((spec.get("jobTemplate") or {}).get("spec") or {})
    return ((spec.get("template") or {}).get("spec")) or {}


def componente(d):
    spec = d.get("spec") or {}
    if d.get("kind") == "CronJob":
        spec = ((spec.get("jobTemplate") or {}).get("spec") or {})
    return (((spec.get("template") or {}).get("metadata") or {}).get("labels") or {}).get("app.kubernetes.io/component")


def tipi(cj):
    for c in pod(cj).get("containers") or []:
        for e in c.get("env") or []:
            if e.get("name") == "AI_WORKER_KINDS":
                return {k.strip() for k in str(e.get("value", "")).split(",") if k.strip()}
    return None


cron = [d for d in docs if d.get("kind") == "CronJob" and del_chart(d)]
w_gpu = next((d for d in cron if componente(d) == "postprod-worker"), None)
w_cpu = next((d for d in cron if componente(d) == "postprod-worker-cpu"), None)
orch = next((d for d in cron if componente(d) == "cronjob-postprod-orchestrator"), None)
motore = next((d for d in docs if d.get("kind") == "Deployment" and componente(d) == "postprod-mt"), None)

if profilo.startswith("postprod") and not (w_gpu and orch):
    print("profilo della post-produzione senza il worker o l'orchestratore resi")

if w_cpu is not None:
    k = tipi(w_cpu)
    if not k:
        print("il worker senza GPU non ha AI_WORKER_KINDS: si rifiuta di partire")
    elif k & GPU:
        print(f"il worker senza GPU prende anche {sorted(k & GPU)}: una trascrizione o un doppiaggio finirebbero uccisi a metà")
if w_gpu is not None:
    k = tipi(w_gpu)
    if k is None:
        print("il worker con la GPU non ha AI_WORKER_KINDS: prenderebbe anche la traduzione dei testi, che non deve accendere la GPU")
    elif "TRANSLATE_TEXT" in k:
        print("il worker con la GPU prende la traduzione dei testi (TRANSLATE_TEXT): accenderebbe la GPU per qualche riga di testo")
    elif w_cpu is None and not (k >= {"TRANSCRIBE", "SUMMARIZE", "TRANSLATE", "ARCHIVE", "REPORT"}):
        print(f"senza worker CPU il worker con la GPU deve prendere gli altri lavori, prende solo {sorted(k)}")

# vLLM si accende solo per i lavori che lo usano (desiredLlm del portale).
if orch is not None:
    testo = "\n".join(str(x) for c in pod(orch).get("containers") or [] for x in (c.get("command") or []) + (c.get("args") or []))
    if "VLLM_DEPLOY=" in testo and "desiredLlm" not in testo:
        print("l'orchestratore accende vLLM per ogni lavoro, anche quelli che non lo usano: manca desiredLlm")


def orchestra(risposta):
    """Un giro dello script dell'orchestratore reso, con curl che risponde
    `risposta` (compatta, come Response.json del portale) e kubectl finto
    senza worker attivi: i modelli da cui crea un worker."""
    comando = next((c.get("command") or [] for c in pod(orch).get("containers") or []), [])
    with tempfile.TemporaryDirectory() as finti:
        registro = os.path.join(finti, "creati")
        for nome_f, corpo in (("curl", 'printf %s "$RISPOSTA"\n'),
                              ("kubectl", '[ "$1" = create ] && echo "$@" >>"$REGISTRO"\nexit 0\n')):
            percorso = os.path.join(finti, nome_f)
            with open(percorso, "w") as f:
                f.write("#!/bin/sh\n" + corpo)
            os.chmod(percorso, 0o755)
        env = {"PATH": finti + os.pathsep + os.environ.get("PATH", ""), "CRON_API_KEY": "x",
               "RISPOSTA": json.dumps(risposta, separators=(",", ":")), "REGISTRO": registro}
        subprocess.run(comando, env=env, capture_output=True, timeout=60, check=False)
        righe = open(registro).read().split("\n") if os.path.exists(registro) else []
    return [r.split("--from=cronjob/", 1)[1].split()[0] for r in righe if "--from=cronjob/" in r]


# Lo script dell'orchestratore su una coda di prova: la traduzione dei testi
# (TRANSLATE_TEXT) non accende mai il worker con la GPU, che non la prende;
# un'app che non manda le misure nuove vale come prima.
if orch is not None and w_gpu is not None:
    gpu = w_gpu["metadata"]["name"]
    cpu = w_cpu["metadata"]["name"] if w_cpu is not None else None
    base = {"pipelineEnabled": True, "claimed": 0, "running": 0, "maxConcurrent": 2}
    sola_traduzione = {**base, "runnable": 1, "desired": 1, "desiredGpu": 0, "desiredCpu": 1,
                       "desiredLlm": 0, "desiredMt": 1, "desiredWithoutMt": 0}
    trascrizione = {**base, "runnable": 1, "desired": 1, "desiredGpu": 1, "desiredCpu": 0,
                    "desiredLlm": 1, "desiredMt": 0, "desiredWithoutMt": 1}
    app_vecchia = {**base, "runnable": 1, "desired": 1}
    creati = orchestra(sola_traduzione)
    if gpu in creati:
        print(f"una traduzione dei testi in coda accende il worker con la GPU, che non la prende: {creati}")
    if cpu is not None and creati != [cpu]:
        print(f"una traduzione dei testi in coda non accende il worker senza GPU: {creati}")
    if orchestra(trascrizione) != [gpu]:
        print(f"una trascrizione in coda non accende il worker con la GPU: {orchestra(trascrizione)}")
    if cpu is None and orchestra(app_vecchia) != [gpu]:
        print(f"senza worker CPU, con un'app che non manda desiredWithoutMt, il lavoro in coda non accende il worker con la GPU: {orchestra(app_vecchia)}")

app = next((d for d in docs if d.get("kind") == "Deployment" and del_chart(d) and componente(d) is None), None)
mappa = next((d.get("data") or {} for d in docs if d.get("kind") == "ConfigMap" and app is not None
              and d["metadata"]["name"] == app["metadata"]["name"]), {})

if motore is None:
    if "AI_MT_BASE_URL" in mappa:
        print("AI_MT_BASE_URL impostato senza il motore di traduzione reso: il portale offrirebbe una traduzione che non parte")
    sys.exit(0)

nome = motore["metadata"]["name"]
spec = pod(motore)
if w_cpu is None or "TRANSLATE_TEXT" not in (tipi(w_cpu) or set()):
    print("motore di traduzione reso, ma nessun worker senza GPU prende TRANSLATE_TEXT")
contenitori = (spec.get("containers") or []) + (spec.get("initContainers") or [])
for c in contenitori:
    if not re.search(r"@sha256:[0-9a-f]{64}$", str(c.get("image", ""))):
        print(f"{nome}/{c.get('name')}: l'immagine {c.get('image')} non è fissata per digest")
    risorse = json.dumps(c.get("resources") or {})
    if "nvidia.com/gpu" in risorse:
        print(f"{nome}/{c.get('name')} chiede una GPU: il motore di traduzione gira su CPU")
# Mai sul pool con la GPU: niente selettori o tolleranze del worker con la GPU.
gpu_spec = pod(w_gpu) if w_gpu is not None else {}
for k, v in (gpu_spec.get("nodeSelector") or {}).items():
    if (spec.get("nodeSelector") or {}).get(k) == v:
        print(f"il motore di traduzione va sui nodi {k}={v}, quelli del worker con la GPU")
for t in gpu_spec.get("tolerations") or []:
    if t in (spec.get("tolerations") or []):
        print(f"il motore di traduzione tollera {t}, la marcatura del pool con la GPU")
if any(str(v) in json.dumps(spec.get("affinity") or {}) for v in (gpu_spec.get("nodeSelector") or {}).values()):
    print("l'affinità del motore di traduzione nomina il pool con la GPU")
# Il modello: indirizzo a revisione fissa e impronta.
init = next((c for c in spec.get("initContainers") or [] if c.get("name") == "fetch-model"), None)
variabili = {e["name"]: str(e.get("value", "")) for e in (init or {}).get("env") or []}
if init is None:
    print("il motore di traduzione non scarica né verifica il modello (initContainer fetch-model)")
elif not re.fullmatch(r"[0-9a-f]{64}", variabili.get("MT_MODEL_SHA256", "")) or "sha256sum -c" not in json.dumps(init.get("command")):
    print("il modello del motore di traduzione si scarica senza verificarne l'impronta")
elif profilo == "postprod-mt" and not re.search(r"/[0-9a-f]{40}/", variabili.get("MT_MODEL_URL", "")):
    print(f"l'indirizzo del modello non è a revisione fissa: {variabili.get('MT_MODEL_URL')}")
argomenti = " ".join(str(a) for c in spec.get("containers") or [] for a in c.get("args") or [])
if variabili.get("MT_MODEL_PATH") and variabili["MT_MODEL_PATH"] not in argomenti:
    print(f"il motore carica un file diverso da quello scaricato ({variabili.get('MT_MODEL_PATH')})")
# La cache dei prompt di llama.cpp: le richieste sono di una riga e non la
# riusano mai. Con il valore predefinito di llama.cpp (8 GiB) cresce fino a
# portare il pod oltre la sua memoria a metà di un lavoro grande.
lista = [str(a) for c in (spec.get("containers") or [])[:1] for a in c.get("args") or []]
if "--cache-ram" not in lista:
    print("il motore di traduzione non limita la cache dei prompt (--cache-ram): la memoria cresce a ogni richiesta fino a uccidere il pod")
else:
    cache = (lista[lista.index("--cache-ram") + 1:] or [""])[0]
    if not re.fullmatch(r"-1|\d+", cache):
        print(f"--cache-ram è seguito da {cache!r}, non da un numero di MiB")
    elif profilo == "postprod-mt" and cache != "0":
        print(f"--cache-ram è {cache}: il valore predefinito del chart deve essere 0")
# Il Service e l'indirizzo che il portale passa al worker.
servizio = next((d for d in docs if d.get("kind") == "Service" and d["metadata"]["name"] == nome), None)
etichette_m = ((motore["spec"].get("template") or {}).get("metadata") or {}).get("labels") or {}
if servizio is None or any(etichette_m.get(k) != v for k, v in (servizio["spec"].get("selector") or {}).items()):
    print(f"nessun Service {nome} che selezioni i pod del motore")
indirizzo = mappa.get("AI_MT_BASE_URL", "")
trovato = re.match(r"^http://([a-z0-9-]+)(\.[a-z0-9.-]+)?:(\d+)/v1$", indirizzo)
if not trovato or trovato.group(1) != nome or trovato.group(3) != "8080":
    print(f"AI_MT_BASE_URL è {indirizzo!r}: deve puntare al Service {nome} sulla 8080, /v1")
if not mappa.get("AI_MT_MODEL_ID"):
    print("AI_MT_MODEL_ID manca: il portale non saprebbe quale modello scrivere sulle traduzioni")
# Le repliche: senza, le porta l'orchestratore, che deve conoscere il
# Deployment e poterlo scalare.
if "replicas" not in motore["spec"]:
    testo = "\n".join(str(x) for c in pod(orch).get("containers") or [] for x in (c.get("command") or [])) if orch else ""
    if f'MT_DEPLOY="{nome}"' not in testo:
        print(f"il motore di traduzione non ha repliche fisse, ma l'orchestratore non lo scala ({nome})")
    ruoli = [d for d in docs if d.get("kind") == "Role" and "postprod-orchestrator" in d["metadata"]["name"]]
    if not any("deployments/scale" in (r.get("resources") or []) and nome in (r.get("resourceNames") or [nome])
               for d in ruoli for r in d.get("rules") or []):
        print(f"l'orchestratore non ha il permesso di scalare {nome}")
PY
  then
    errore "controllo della post-produzione non eseguito su $nome: $(head -3 "$OUT/$nome.pp.err" | tr '\n' ' ')"
  fi
  while read -r problema; do
    [ -n "$problema" ] && errore "$problema"
  done <"$OUT/$nome.pp"

  # Un nome di risorsa oltre i 63 caratteri viene rifiutato all'apply.
  while read -r n; do
    [ "${#n}" -le 63 ] || errore "nome oltre 63 caratteri: $n"
  done < <(sed -n 's/^  name: //p' "$reso" | sort -u)
done

# Le guardie che fermano la resa: una combinazione incoerente deve fallire, con
# un messaggio che nomina il valore da correggere. Una guardia che non scatta
# più non la nota nessun altro controllo.
echo "guardie"
deve_fallire() {
  local descrizione="$1" atteso="$2"
  shift 2
  if helm template videocall "$CHART" -n videocall "${comuni[@]}" \
      -f "$CHART/examples/values-simple.yaml" "$@" >/dev/null 2>"$OUT/guardia.err"; then
    errore "guardia non scattata: $descrizione"
  elif ! grep -q "$atteso" "$OUT/guardia.err"; then
    errore "guardia su $descrizione: messaggio inatteso: $(head -2 "$OUT/guardia.err" | tr '\n' ' ')"
  fi
}
deve_fallire "Secret e ConfigMap insieme in app.extraCaCerts" "app.extraCaCerts" \
  --set app.extraCaCerts.secretName=a --set app.extraCaCerts.configMapName=b
deve_fallire "Jicofo senza autenticazione e Prosody senza i ruoli dal token" "XMPP_MUC_MODULES" \
  --set-string 'jitsi-meet.prosody.extraEnvs.XMPP_MUC_MODULES=muc_size'
deve_fallire "modulo dei ruoli richiesto ma non montato" "/prosody-plugins-custom" \
  --set 'jitsi-meet.prosody.extraVolumeMounts=null'
deve_fallire "modulo dei ruoli senza il blocco di microfono e video" "pa_media_lock" \
  --set-string 'jitsi-meet.prosody.extraEnvs.XMPP_MUC_MODULES=token_affiliation\,token_affiliation_custom'
deve_fallire "sottotitoli accesi senza il modulo di Prosody" "pa_captions" \
  --set-string 'jitsi-meet.prosody.extraEnvs.XMPP_MUC_MODULES=token_affiliation\,token_affiliation_custom\,pa_media_lock'
deve_fallire "impronta del modello dei sottotitoli malformata" "captions.model.sha256" \
  --set captions.model.sha256=abc
deve_fallire "modello dei sottotitoli senza indirizzo" "captions.model.url" \
  --set captions.model.url=
deve_fallire "segreto dei sottotitoli con uno spazio" "global.captions.bridgeToken" \
  --set 'global.captions.bridgeToken=due parole'
deve_fallire "contesto destro del motore non ammesso" "captions.engine.rightContext" \
  --set captions.engine.rightContext=2
deve_fallire "opzioni della JVM di Jicofo senza l'indirizzo dei sottotitoli" "JAVA_TOOL_OPTIONS" \
  --set-string 'jitsi-meet.jicofo.extraEnvs.JAVA_TOOL_OPTIONS=-Xss1m'
deve_fallire "script di fine registrazione montato due volte" "_finalize_sh" \
  --set jitsi-meet.jibri.enabled=true --set-string 'jitsi-meet.jibri.custom.other._finalize_sh=#!/bin/sh'
# Una sola versione di Jitsi: la sola parte web fissata a un'altra versione, e un
# componente lasciato al predefinito del sottochart.
deve_fallire "parte web a una versione di Jitsi diversa dal resto" "web=stable-10741" \
  --set jitsi-meet.web.image.tag=stable-10741-rnnoise-r3
deve_fallire "componente lasciato alla versione del sottochart" "jicofo=" \
  --set 'jitsi-meet.jicofo.image.tag=null'
deve_fallire "componente su un tag mobile accanto a versioni fissate" "jvb=stable)" \
  --set jitsi-meet.jvb.image.tag=stable
deve_fallire "parte web su una versione unstable" "web=unstable-" \
  --set jitsi-meet.web.image.tag=unstable-11200
deve_fallire "componente su un tag mobile con digest" "jvb=stable@" \
  --set 'jitsi-meet.jvb.image.tag=stable@sha256:0000000000000000000000000000000000000000000000000000000000000000'
# Nomi pubblici: forma, coincidenza con le chiavi esplicite, valori del
# sottochart che il chart non può ricavare.
deve_fallire "site.portalHost con lo schema" "site.portalHost" \
  --set site.portalHost=https://webinar.ente.example
deve_fallire "portale e conferenza sullo stesso nome" "due nomi distinti" \
  --set site.portalHost=webinar.ente.example --set site.conferenceHost=webinar.ente.example
deve_fallire "site.portalHost diverso da NEXT_PUBLIC_APP_URL" "NEXT_PUBLIC_APP_URL" \
  --set site.portalHost=webinar.ente.example --set app.env.NEXT_PUBLIC_APP_URL=https://altro.ente.example
deve_fallire "site.portalHost diverso da un host dell'Ingress" "ingress.hosts" \
  --set site.portalHost=webinar.ente.example --set 'ingress.hosts[0].host=altro.ente.example'
deve_fallire "site.conferenceHost senza jitsi-meet.publicURL" "jitsi-meet.publicURL" \
  --set site.conferenceHost=meet.ente.example
deve_fallire "site.conferenceHost con l'host di esempio nell'Ingress del sottochart" "jitsi.conferenceIngress.enabled: true" \
  --set site.conferenceHost=meet.ente.example --set jitsi-meet.publicURL=https://meet.ente.example
deve_fallire "due Ingress per la conferenza" "jitsi-meet.web.ingress.enabled: false" \
  --set jitsi.conferenceIngress.enabled=true
deve_fallire "certificato lasciato sull'Ingress spento del sottochart" "jitsi.conferenceIngress.tls" \
  --set jitsi.conferenceIngress.enabled=true --set jitsi-meet.web.ingress.enabled=false \
  --set site.conferenceHost=meet.ente.example --set jitsi-meet.publicURL=https://meet.ente.example \
  --set 'jitsi-meet.web.ingress.tls[0].secretName=meet-tls' --set 'jitsi.conferenceIngress.tls=null'
deve_fallire "annotazione lasciata sull'Ingress spento del sottochart" "jitsi.conferenceIngress.annotations" \
  --set jitsi.conferenceIngress.enabled=true --set jitsi-meet.web.ingress.enabled=false \
  --set site.conferenceHost=meet.ente.example --set jitsi-meet.publicURL=https://meet.ente.example \
  --set-string 'jitsi-meet.web.ingress.annotations.traefik\.ingress\.kubernetes\.io/router\.tls=true'
# Copia del database: solo con il PostgreSQL del chart, con un numero di copie.
deve_fallire "copia del database senza il PostgreSQL del chart" "backup.enabled" \
  --set backup.enabled=true --set postgresql.enabled=false \
  --set secrets.generate.DATABASE_URL=postgresql://u:p@db.ente.example:5432/pa_webinar
deve_fallire "copia del database con zero copie" "backup.retention" \
  --set backup.enabled=true --set backup.retention=0
# Motore di traduzione su CPU: solo con il worker senza GPU, con un modello
# verificabile.
deve_fallire "motore di traduzione senza il worker senza GPU" "postprod.worker.cpu.enabled" \
  --set postprod.enabled=true --set postprod.mt.enabled=true --set postprod.worker.cpu.enabled=false
deve_fallire "impronta del modello di traduzione malformata" "postprod.mt.model.sha256" \
  --set postprod.enabled=true --set postprod.mt.enabled=true --set postprod.mt.model.sha256=abc
deve_fallire "file del modello di traduzione con un percorso" "postprod.mt.model.file" \
  --set postprod.enabled=true --set postprod.mt.enabled=true --set postprod.mt.model.file=../modello.gguf
deve_fallire "cache dei prompt del motore di traduzione negativa" "postprod.mt.cacheRamMiB" \
  --set postprod.enabled=true --set postprod.mt.enabled=true --set postprod.mt.cacheRamMiB=-5
# Instradamento delle sole voci più forti: un numero, e le opzioni della JVM
# del bridge che lo portano davvero.
deve_fallire "numero di voci più forti non intero" "global.jvb.numLoudest" \
  --set-string global.jvb.numLoudest=cinque
deve_fallire "opzioni della JVM del bridge senza le voci più forti" "VIDEOBRIDGE_DEBUG_OPTIONS" \
  --set-string 'jitsi-meet.jvb.extraEnvs.VIDEOBRIDGE_DEBUG_OPTIONS=-Xss1m'
deve_fallire "opzioni della JVM del bridge con un altro numero di voci" "VIDEOBRIDGE_DEBUG_OPTIONS" \
  --set global.jvb.numLoudest=0 \
  --set-string 'jitsi-meet.jvb.extraEnvs.VIDEOBRIDGE_DEBUG_OPTIONS=-Dvideobridge.loudest.route-loudest-only=true'

echo
if [ "$fallimenti" -gt 0 ]; then
  echo "$fallimenti problemi"
  exit 1
fi
echo "chart valido su tutti i profili"
