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
)

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
  esac
}

# Il modulo Prosody che assegna i ruoli dal token esiste in due copie: quella
# che monta lo stack Docker Compose e quella che il chart mette nel proprio
# ConfigMap (un chart non legge file fuori dalla sua cartella). Devono restare
# identiche.
modulo="mod_token_affiliation_custom.lua"
if ! cmp -s "infra/jitsi/prosody-plugins/$modulo" "$CHART/files/prosody-plugins/$modulo"; then
  errore "infra/jitsi/prosody-plugins/$modulo e $CHART/files/prosody-plugins/$modulo sono diversi: aggiorna la copia del chart"
fi

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
        if not (cron or jibri):
            continue
        if not any(ammette(r, et, 3000) for r in spec.get("ingress") or []):
            print(f"{tipo}/{n} non raggiungerebbe l'applicazione: la NetworkPolicy {nome} non lo ammette sulla porta 3000")

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
  if ! python3 - "$reso" "$nome" >"$OUT/$nome.conf" 2>"$OUT/$nome.conf.err" <<'PY'
import re
import sys

import yaml

docs = [d for d in yaml.safe_load_all(open(sys.argv[1])) if d]
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
           "PROSODY_INTERNAL_URL", "JICOFO_HEALTH_URL"]
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
        if str(jicofo.get("ENABLE_AUTO_OWNER", "")).lower() != "false":
            print("Jicofo con ENABLE_AUTO_OWNER acceso: il primo a entrare diventerebbe moderatore")
        if "token_affiliation_custom" in moduli:
            sts = next((d for d in docs if d.get("kind") == "StatefulSet" and d["metadata"]["name"].endswith("-prosody")), None)
            ok = False
            if sts:
                ps = sts["spec"]["template"]["spec"]
                volumi = {v["name"]: v for v in ps.get("volumes") or []}
                for c in ps.get("containers") or []:
                    for vm in c.get("volumeMounts") or []:
                        if not str(vm.get("mountPath", "")).startswith("/prosody-plugins-custom"):
                            continue
                        cm = ((volumi.get(vm["name"]) or {}).get("configMap") or {}).get("name")
                        if cm in mappe and "mod_token_affiliation_custom.lua" in mappe[cm] \
                                and "muc-occupant-pre-join" in mappe[cm]["mod_token_affiliation_custom.lua"]:
                            ok = True
            if not ok:
                print("Prosody carica token_affiliation_custom ma nessun ConfigMap reso lo monta in /prosody-plugins-custom")

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

echo
if [ "$fallimenti" -gt 0 ]; then
  echo "$fallimenti problemi"
  exit 1
fi
echo "chart valido su tutti i profili"
