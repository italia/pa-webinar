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
# ingress-nginx, Jitsi esterno, i segreti da External Secrets.
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
  "produzione-rete:$CHART/values-production.yaml"
  "completo-segreti-esterni:$CHART/examples/values-full.yaml"
  "jitsi-esterno:"
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
  esac
}

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

# Le statistiche del bridge: l'indirizzo deve essere un Service reso.
for tipo, n, modello in carichi:
    if tipo != "Deployment":
        continue
    for c in (modello.get("spec") or {}).get("containers") or []:
        for e in c.get("env") or []:
            if e.get("name") != "JVB_HEALTH_URL":
                continue
            trovato = re.match(r"https?://([^:/]+)", str(e.get("value", "")))
            if trovato and "." not in trovato.group(1) and trovato.group(1) not in servizi:
                print(f"JVB_HEALTH_URL punta all'host {trovato.group(1)!r}, che non è un Service reso")

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

  # Un nome di risorsa oltre i 63 caratteri viene rifiutato all'apply.
  while read -r n; do
    [ "${#n}" -le 63 ] || errore "nome oltre 63 caratteri: $n"
  done < <(sed -n 's/^  name: //p' "$reso" | sort -u)
done

echo
if [ "$fallimenti" -gt 0 ]; then
  echo "$fallimenti problemi"
  exit 1
fi
echo "chart valido su tutti i profili"
