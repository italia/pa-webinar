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
comuni=(
  --set "secrets.generate.APP_SECRET=$(openssl rand -hex 32)"
  --set "secrets.generate.JITSI_JWT_SECRET=$(openssl rand -hex 32)"
  --set "secrets.generate.PII_ENCRYPTION_KEY=$(openssl rand -hex 32)"
  --set "secrets.generate.CRON_API_KEY=$(openssl rand -hex 32)"
  --set "secrets.generate.ADMIN_API_KEY=$(openssl rand -hex 32)"
  --set "secrets.generate.POSTGRES_PASSWORD=$(openssl rand -hex 24)"
  --set "secrets.generate.POSTGRES_ADMIN_PASSWORD=$(openssl rand -hex 24)"
  --set "secrets.generate.REDIS_PASSWORD=$(openssl rand -hex 24)"
)

profili=(
  "predefinito:"
  "semplice:$CHART/examples/values-simple.yaml"
  "standard:$CHART/examples/values-standard.yaml"
  "completo:$CHART/examples/values-full.yaml"
  "produzione:$CHART/values-production.yaml"
  "sviluppo:$CHART/values-dev.yaml"
)

echo "helm lint"
helm lint "$CHART" >/dev/null || errore "helm lint fallisce"

for voce in "${profili[@]}"; do
  nome="${voce%%:*}"
  file="${voce#*:}"
  reso="$OUT/$nome.yaml"

  args=(template videocall "$CHART" -n videocall "${comuni[@]}")
  [ -n "$file" ] && args+=(-f "$file")

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
PY
  then
    errore "controllo dei Secret non eseguito su $nome: $(head -3 "$OUT/$nome.sec.err" | tr '\n' ' ')"
  fi
  while read -r problema; do
    [ -n "$problema" ] && errore "$problema"
  done <"$OUT/$nome.sec"

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
