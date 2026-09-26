#!/usr/bin/env bash
#
# Immagini per nodi k3s che non possono (o non devono) prelevarle da soli:
# nodi senza Internet, dietro un proxy che non vede il registro, o senza le
# credenziali che il registro del progetto oggi chiede anche in lettura.
#
#   list       elenca OGNI immagine che il chart rende con i valori dati
#              (helm template: container, initContainer, CronJob, hook, e i
#              modelli da cui nascono i Job del registratore e della
#              post-produzione)
#   save       le preleva su una macchina che raggiunge i registri, con le
#              credenziali di quella macchina, in un unico archivio OCI. Le
#              immagini che il registro non dà e il docker di questa macchina
#              ha (costruite qui) si prendono da docker
#   build      costruisce con docker le immagini dell'applicazione da questo
#              checkout, poi fa come save con quelle al posto delle
#              pubblicate: la strada per chi non ha accesso al registro del
#              progetto. Scrive accanto all'archivio i valori delle immagini
#              da passare a helm (<archivio>.values.yaml)
#   import     sul nodo: importa l'archivio in k3s, fissa le immagini contro
#              la pulizia automatica del kubelet e controlla che ogni
#              riferimento del chart si risolva
#   fetch-k3s  binario, install.sh e immagini di sistema di k3s alla versione
#              provata, per install-*.sh --airgap-dir
#
# Uso:  ./preload-images.sh list [--chart DIR] [-- <argomenti di helm template>]
#       ./preload-images.sh save --out FILE [--arch amd64] [--list FILE] [--from-docker] [--chart DIR] [-- <argomenti>]
#       ./preload-images.sh build --out FILE [--tag TAG] [--chart DIR] [-- <argomenti>]
#       sudo ./preload-images.sh import FILE
#       ./preload-images.sh fetch-k3s --out DIR [--version V] [--arch amd64]
#
# Gli argomenti di helm vanno dati come all'installazione (stessi -f, stessi
# --set, compresi i tag delle immagini): sono loro a decidere quali
# componenti, e quindi quali immagini, esistono. Senza argomenti: profilo
# semplice + values-k3s.yaml, con le immagini alla versione del chart.
#
# save --from-docker prende dal docker di questa macchina ogni immagine con
# tag che ci trova, le altre dal registro. Senza, docker serve solo per le
# immagini che il registro rifiuta.
#
# build: su un tag di rilascio vX.Y.Z le immagini si chiamano
# pa-webinar:X.Y.Z e pa-webinar:vX.Y.Z-migrate, su un altro commit
# pa-webinar:local-<sha> e pa-webinar:local-<sha>-migrate (--tag per un altro
# nome). Le immagini costruite hanno l'architettura di questa macchina, che
# deve essere quella dei nodi.
#
# Dove: list, save, build e fetch-k3s su Linux o macOS (bash 3.2 o
# successiva, con helm; save e build vogliono anche skopeo e python3, build e
# --from-docker anche docker); import sul nodo, come root. Il chart va
# preparato prima con `helm dependency build`.
#
# Ciò che l'archivio fissa: un riferimento con digest (`repo@sha256:…`)
# viene copiato con l'indice multi-architettura originale, perché il kubelet
# cerca proprio quel digest; un riferimento solo con tag viene copiato per
# l'architettura dei nodi, e sul nodo vale la copia importata. Il file
# `<archivio>.images.txt` registra digest e riferimento di ogni immagine.

set -euo pipefail

CARTELLA_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART="$CARTELLA_SCRIPT/../../helm/pa-webinar"
ARCH="amd64"
# Il nome delle immagini dell'applicazione costruite da build.
REPO_LOCALE="pa-webinar"
# Il binario di k3s, per percorso: su RHEL e derivate sudo toglie
# /usr/local/bin dal PATH (secure_path).
K3S="${K3S:-}"

# Funzioni e versioni comuni agli script della cartella (versione provata di
# k3s, download, tag delle immagini dal checkout). Prima delle funzioni di
# questo script: log e fine sono quelle qui sotto.
# shellcheck source=common.sh
. "$CARTELLA_SCRIPT/common.sh"

log()  { printf '[immagini] %s\n' "$*" >&2; }
fine() { printf '[immagini] ERRORE: %s\n' "$*" >&2; exit 1; }

# L'aiuto è il commento in testa al file, fino alla prima riga di codice.
uso() { awk 'NR < 3 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}"; }

# Riferimento nella forma completa che usa containerd: registro esplicito
# (docker.io per Docker Hub), `library/` per le immagini ufficiali, `latest`
# quando manca il tag. Il registro resta com'è scritto: registry-1.docker.io
# per containerd non è docker.io.
normalizza() {
  local ref="$1" primo resto
  primo="${ref%%/*}"
  if [ "$primo" = "$ref" ]; then
    ref="docker.io/library/$ref"
  elif [[ "$primo" != *.* && "$primo" != *:* && "$primo" != localhost ]]; then
    ref="docker.io/$ref"
  fi
  resto="${ref##*/}"
  if [[ "$ref" != *@* && "$resto" != *:* ]]; then
    ref="$ref:latest"
  fi
  printf '%s' "$ref"
}

# Nome con cui l'immagine va importata: quello che il kubelet chiede al
# runtime. Con un digest il tag non conta (containerd lo scarta).
nome_import() {
  local ref="$1" repo digest
  if [[ "$ref" == *@* ]]; then
    digest="${ref#*@}"
    repo="${ref%@*}"
    # Toglie il tag, se c'è, solo dall'ultimo componente del percorso.
    if [[ "${repo##*/}" == *:* ]]; then repo="${repo%:*}"; fi
    printf '%s@%s' "$repo" "$digest"
  else
    printf '%s' "$ref"
  fi
}

# Segreti fittizi, solo per far passare le guardie del chart durante la resa:
# non cambiano quali immagini esistono. Stanno in testa, e gli argomenti di
# chi lancia vincono.
FITTIZI=(
  --set-string secrets.generate.POSTGRES_PASSWORD=elenco
  --set-string secrets.generate.POSTGRES_ADMIN_PASSWORD=elenco
  --set-string secrets.generate.REDIS_PASSWORD=elenco
  --set-string secrets.generate.JITSI_JWT_SECRET=elenco
  --set-string jitsi-meet.jicofo.xmpp.password=elenco
  --set-string jitsi-meet.jvb.xmpp.password=elenco
  --set-string jitsi-meet.jibri.xmpp.password=elenco
  --set-string jitsi-meet.jibri.recorder.password=elenco
)

elenca() {
  command -v helm >/dev/null || fine "serve helm"
  [ -e "$CHART" ] || fine "chart non trovato: $CHART (usa --chart)"
  # I sottochart non sono nel repository: senza, helm template fallisce con
  # un messaggio che non dice cosa fare.
  if [ -d "$CHART" ] && [ -z "$(ls -A "$CHART/charts" 2>/dev/null)" ]; then
    fine "mancano i sottochart del chart. Prima:
  helm repo add bitnami https://charts.bitnami.com/bitnami
  helm repo add jitsi-contrib https://jitsi-contrib.github.io/jitsi-helm/
  helm dependency build $CHART"
  fi
  local argomenti=()
  [ $# -gt 0 ] && argomenti=("$@")
  if [ "${#argomenti[@]}" -eq 0 ]; then
    argomenti=(-f "$CHART/examples/values-simple.yaml" -f "$CHART/examples/values-k3s.yaml")
    log "nessun argomento per helm: profilo semplice + values-k3s.yaml, immagini alla versione del chart"
  fi
  local resa
  resa="$(helm template elenco "$CHART" --skip-tests "${FITTIZI[@]}" "${argomenti[@]}")" \
    || fine "helm template non riuscito: controlla gli argomenti, che sono quelli dell'installazione"
  local ref
  printf '%s\n' "$resa" \
    | sed -nE 's/^[[:space:]]*(- )?image:[[:space:]]*"?([^"[:space:]]+)"?[[:space:]]*$/\2/p' \
    | sort -u \
    | while read -r ref; do
        normalizza "$ref"; printf '\n'
      done | sort -u
}

# Avvisi sui riferimenti che non fissano una versione.
avvisa_mobili() {
  local ref tag
  while read -r ref; do
    [[ "$ref" == *@* ]] && continue
    tag="${ref##*:}"
    case "${tag%-migrate}" in
      latest|dev|main|stable|edge|nightly)
        log "ATTENZIONE: $ref ha un tag mobile: l'archivio fissa la copia di oggi, ma un nodo che la riprelevasse avrebbe un'altra immagine" ;;
    esac
  done
}

cmd_list() {
  local argomenti=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --chart) CHART="${2:?manca il valore di --chart}"; shift 2 ;;
      --) shift; argomenti=("$@"); break ;;
      -h|--help) uso; exit 0 ;;
      *) fine "opzione sconosciuta per list: $1" ;;
    esac
  done
  local elenco
  # ${a[@]+…}: con bash 3.2 (macOS) e set -u un array vuoto non si espande.
  elenco="$(elenca ${argomenti[@]+"${argomenti[@]}"})"
  printf '%s\n' "$elenco" | avvisa_mobili
  printf '%s\n' "$elenco"
}

# Un tag delle migrazioni nella forma senza `v` esiste solo per i rilasci
# pubblicati da quando il flusso di rilascio la produce; quella con la `v`
# del tag git esiste per tutti.
suggerimento() {
  case "$1" in
    */pa-webinar:[0-9]*-migrate)
      printf ' (per i rilasci meno recenti il tag delle migrazioni ha la v: passa app.migration.image.tag=v%s)' "${1##*:}" ;;
  esac
}

# Monta un unico layout OCI dalle copie `dir:` di skopeo (una cartella per
# immagine: manifest.json, i manifest delle singole architetture come
# <digest>.manifest.json, i blob per digest). I manifest restano byte per
# byte quelli del registro, anche nel formato Docker: il digest non cambia, e
# containerd importa layout OCI con tipi Docker. I blob comuni a più
# immagini si scrivono una volta. In index.json, una voce per riga, il nome
# con cui containerd importa l'immagine (io.containerd.image.name) e il
# riferimento del chart, che `import` legge senza bisogno di jq sul nodo.
componi_layout() {
  local copie="$1" mappa="$2" layout="$3"
  python3 - "$copie" "$mappa" "$layout" <<'PY'
import hashlib, json, os, re, sys
copie, mappa_path, layout = sys.argv[1:4]
blobs = os.path.join(layout, "blobs", "sha256")
os.makedirs(blobs, exist_ok=True)
esadecimale = re.compile(r"^[0-9a-f]{64}$")

def tipo(manifest):
    if manifest.get("mediaType"):
        return manifest["mediaType"]
    if "manifests" in manifest:
        return "application/vnd.oci.image.index.v1+json"
    return "application/vnd.oci.image.manifest.v1+json"

def sposta(sorgente, digest_hex):
    dest = os.path.join(blobs, digest_hex)
    if os.path.exists(dest):
        os.remove(sorgente)
    else:
        os.replace(sorgente, dest)

voci = []
with open(mappa_path) as f:
    for riga in f:
        etichetta, nome, ref = riga.rstrip("\n").split("\t")
        cartella = os.path.join(copie, etichetta)
        with open(os.path.join(cartella, "manifest.json"), "rb") as m:
            grezzo = m.read()
        digest = hashlib.sha256(grezzo).hexdigest()
        if "@sha256:" in nome and nome.split("@sha256:")[1] != digest:
            sys.exit(f"{ref}: il manifest copiato ha digest sha256:{digest}, non quello del chart")
        for voce in os.listdir(cartella):
            percorso = os.path.join(cartella, voce)
            if voce.endswith(".manifest.json") and esadecimale.match(voce[:-14]):
                with open(percorso, "rb") as m:
                    if hashlib.sha256(m.read()).hexdigest() != voce[:-14]:
                        sys.exit(f"{ref}: manifest {voce} corrotto")
                sposta(percorso, voce[:-14])
            elif esadecimale.match(voce):
                sposta(percorso, voce)
        with open(os.path.join(blobs, digest), "wb") as m:
            m.write(grezzo)
        voci.append({
            "mediaType": tipo(json.loads(grezzo)),
            "digest": "sha256:" + digest,
            "size": len(grezzo),
            "annotations": {
                "io.containerd.image.name": nome,
                "io.pa-webinar.chart-ref": ref,
            },
        })
with open(os.path.join(layout, "oci-layout"), "w") as f:
    json.dump({"imageLayoutVersion": "1.0.0"}, f)
with open(os.path.join(layout, "index.json"), "w") as f:
    json.dump({"schemaVersion": 2, "manifests": voci}, f, indent=1)
    f.write("\n")
for v in voci:
    print(v["digest"], v["annotations"]["io.pa-webinar.chart-ref"])
PY
}

# Vero se il docker di questa macchina ha l'immagine $1 (per tag).
in_docker() {
  command -v docker >/dev/null 2>&1 && docker image inspect "$1" >/dev/null 2>&1
}

# Copia l'immagine $1 dal docker di questa macchina nella cartella $2, se è
# dell'architettura dei nodi.
copia_da_docker() {
  local ref="$1" dest="$2" arch
  arch="$(docker image inspect --format '{{.Architecture}}' "$ref" 2>/dev/null || true)"
  [ "$arch" = "$ARCH" ] || fine "$ref nel docker di questa macchina è linux/${arch:-?}, i nodi sono linux/$ARCH"
  rm -rf "$dest"
  skopeo copy --quiet "docker-daemon:$ref" "dir:$dest" || fine "copia dal docker di questa macchina non riuscita: $ref"
}

cmd_save() {
  local out="" file_elenco="" argomenti=() da_docker="no"
  while [ $# -gt 0 ]; do
    case "$1" in
      --out) out="${2:?manca il valore di --out}"; shift 2 ;;
      --arch) ARCH="${2:?manca il valore di --arch}"; shift 2 ;;
      --list) file_elenco="${2:?manca il valore di --list}"; shift 2 ;;
      --from-docker) da_docker="si"; shift ;;
      --chart) CHART="${2:?manca il valore di --chart}"; shift 2 ;;
      --) shift; argomenti=("$@"); break ;;
      -h|--help) uso; exit 0 ;;
      *) fine "opzione sconosciuta per save: $1" ;;
    esac
  done
  [ -n "$out" ] || fine "manca --out <archivio.tar>"
  command -v skopeo >/dev/null || fine "serve skopeo (pacchetto skopeo di Debian, Ubuntu, Fedora, RHEL)"
  command -v python3 >/dev/null || fine "serve python3"
  if [ "$da_docker" = si ]; then
    command -v docker >/dev/null || fine "--from-docker: serve docker"
    docker info >/dev/null 2>&1 || fine "--from-docker: il demone docker non risponde (docker info)"
  fi

  local elenco
  if [ -n "$file_elenco" ]; then
    elenco="$(grep -vE '^[[:space:]]*(#|$)' "$file_elenco" | while read -r r; do normalizza "$r"; printf '\n'; done | sort -u)"
  else
    elenco="$(elenca ${argomenti[@]+"${argomenti[@]}"})"
  fi
  [ -n "$elenco" ] || fine "nessuna immagine da salvare"
  printf '%s\n' "$elenco" | avvisa_mobili

  # Globale: la trap di uscita la legge quando la funzione è già finita.
  LAVORO="$(mktemp -d)"
  trap 'rm -rf "$LAVORO"' EXIT
  local layout="$LAVORO/oci" copie="$LAVORO/copie" mappa="$LAVORO/mappa.tsv" n=0 ref nome etichetta
  mkdir -p "$copie"
  : > "$mappa"
  while read -r ref; do
    n=$((n + 1))
    etichetta="img-$n"
    nome="$(nome_import "$ref")"
    if [[ "$ref" == *@* ]]; then
      # Indice intero e digest intatti: è il digest che il chart chiede, e
      # l'archivio serve anche a nodi di un'altra architettura.
      log "[$n] $ref (tutte le architetture, digest conservato)"
      skopeo copy --retry-times 3 --quiet --multi-arch all --preserve-digests \
        "docker://$nome" "dir:$copie/$etichetta" || fine "copia non riuscita: $ref"
    elif [ "$da_docker" = si ] && in_docker "$ref"; then
      log "[$n] $ref (dal docker di questa macchina)"
      copia_da_docker "$ref" "$copie/$etichetta"
    else
      log "[$n] $ref (linux/$ARCH)"
      # Un'immagine costruita qui (pa-webinar:<tag>, senza registro) non è in
      # nessun registro: se il docker di questa macchina ce l'ha, si prende
      # da lì.
      if ! skopeo copy --retry-times 3 --quiet --override-os linux --override-arch "$ARCH" \
          "docker://$ref" "dir:$copie/$etichetta" 2> "$LAVORO/errore"; then
        if in_docker "$ref"; then
          log "    il registro non la dà, il docker di questa macchina sì: uso quella"
          copia_da_docker "$ref" "$copie/$etichetta"
        else
          cat "$LAVORO/errore" >&2
          fine "copia non riuscita: $ref$(suggerimento "$ref")"
        fi
      fi
    fi
    printf '%s\t%s\t%s\n' "$etichetta" "$nome" "$ref" >> "$mappa"
  done <<< "$elenco"

  componi_layout "$copie" "$mappa" "$layout" > "$out.images.txt"
  tar -C "$layout" -cf "$out" oci-layout index.json blobs
  log "archivio: $out ($(du -h "$out" | cut -f1), $n immagini); elenco con i digest: $out.images.txt"
  log "sul nodo: sudo ./preload-images.sh import $(basename "$out")"
}

# Architettura di questa macchina, nei nomi dei nodi (amd64, arm64).
arch_locale() {
  case "$(uname -m)" in
    x86_64|amd64) echo amd64 ;;
    aarch64|arm64) echo arm64 ;;
    *) uname -m ;;
  esac
}

cmd_build() {
  local out="" tag="" argomenti=() radice tag_mig tags commit
  while [ $# -gt 0 ]; do
    case "$1" in
      --out) out="${2:?manca il valore di --out}"; shift 2 ;;
      --tag) tag="${2:?manca il valore di --tag}"; shift 2 ;;
      --arch) ARCH="${2:?manca il valore di --arch}"; shift 2 ;;
      --chart) CHART="${2:?manca il valore di --chart}"; shift 2 ;;
      --) shift; argomenti=("$@"); break ;;
      -h|--help) uso; exit 0 ;;
      *) fine "opzione sconosciuta per build: $1" ;;
    esac
  done
  [ -n "$out" ] || fine "manca --out <archivio.tar>"
  command -v docker >/dev/null || fine "serve docker"
  docker info >/dev/null 2>&1 || fine "il demone docker non risponde (docker info): avvialo, o controlla i permessi dell'utente"
  [ "$(arch_locale)" = "$ARCH" ] \
    || fine "questa macchina è $(arch_locale), i nodi $ARCH: costruisci le immagini su una macchina della stessa architettura dei nodi"
  radice="$(cd "$CARTELLA_SCRIPT/../../.." && pwd)"
  [ -f "$radice/Dockerfile" ] || fine "Dockerfile non trovato in $radice: build si lancia da una copia del repository"

  # I nomi delle due immagini: dal tag di rilascio del checkout, o dal commit.
  if [ -n "$tag" ]; then
    [[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9._-]{0,120}$ ]] || fine "--tag non è un tag valido: $tag"
    case "$tag" in
      [0-9]*.[0-9]*.[0-9]*) tag_mig="v$tag-migrate" ;;
      *) tag_mig="$tag-migrate" ;;
    esac
  else
    tags="$(tag_da_checkout "$radice")" || fine "non ricavo la versione del checkout (git o Chart.yaml): passala con --tag"
    read -r tag tag_mig <<< "$tags"
  fi
  if checkout_modificato "$radice"; then
    log "ATTENZIONE: il checkout ha modifiche non salvate: finiscono nelle immagini $REPO_LOCALE:$tag"
  fi
  commit="$(git -C "$radice" rev-parse --short=12 HEAD 2>/dev/null || echo '?')"

  log "costruisco $REPO_LOCALE:$tag e $REPO_LOCALE:$tag_mig da $radice (commit $commit; la prima volta alcuni minuti)"
  costruisci_immagini "$radice" "$REPO_LOCALE:$tag" "$REPO_LOCALE:$tag_mig" "" \
    || fine "docker build non riuscito (l'errore è qui sopra)"

  # I valori delle immagini, per helm e per l'elenco dell'archivio: pullPolicy
  # Never, perché il nodo non potrebbe prelevarle da nessuna parte e un'immagine
  # mancante deve essere un errore chiaro (ErrImageNeverPull), non un tentativo
  # di prelievo da Docker Hub.
  local valori="$out.values.yaml"
  {
    printf '# Scritto da preload-images.sh build: immagini costruite da %s (commit %s).\n' "$(basename "$radice")" "$commit"
    printf '# Da passare a helm con gli altri valori, dopo i file di esempio.\n'
    printf 'app:\n  image:\n    repository: %s\n    tag: "%s"\n    pullPolicy: Never\n' "$REPO_LOCALE" "$tag"
    printf '  migration:\n    image:\n      repository: %s\n      tag: "%s"\n      pullPolicy: Never\n' "$REPO_LOCALE" "$tag_mig"
  } > "$valori"

  if [ "${#argomenti[@]}" -eq 0 ]; then
    argomenti=(-f "$CHART/examples/values-simple.yaml" -f "$CHART/examples/values-k3s.yaml")
    log "nessun argomento per helm: profilo semplice + values-k3s.yaml"
  fi
  # Le immagini pubblicate dal registro, come in save; quelle appena
  # costruite il registro non le ha, e save le prende dal docker di qui.
  cmd_save --out "$out" --arch "$ARCH" --chart "$CHART" -- "${argomenti[@]}" -f "$valori"
  log "valori delle immagini per helm: $valori (-f, dopo i file di esempio e prima dei tuoi)"
}

cmd_import() {
  local file="${1:-}"
  [ -n "$file" ] || fine "manca l'archivio da importare"
  [ -r "$file" ] || fine "archivio non leggibile: $file"
  [ "$(id -u)" -eq 0 ] || fine "va lanciato come root (sudo)"
  if [ -z "$K3S" ]; then
    if [ -x /usr/local/bin/k3s ]; then K3S=/usr/local/bin/k3s; else K3S="$(command -v k3s 2>/dev/null || true)"; fi
  fi
  [ -n "$K3S" ] && [ -x "$K3S" ] || fine "k3s non è installato su questo nodo"

  local nomi riferimenti
  nomi="$(tar -xOf "$file" index.json | sed -nE 's/.*"io\.containerd\.image\.name": *"([^"]+)".*/\1/p')"
  riferimenti="$(tar -xOf "$file" index.json | sed -nE 's/.*"io\.pa-webinar\.chart-ref": *"([^"]+)".*/\1/p')"
  [ -n "$nomi" ] || fine "l'archivio non è stato preparato con preload-images.sh save"

  log "importo $(printf '%s\n' "$nomi" | wc -l) immagini (le più grandi richiedono qualche minuto)"
  "$K3S" ctr -n k8s.io images import "$file" >/dev/null

  # Il kubelet cancella le immagini inutilizzate quando il disco si riempie:
  # su un nodo che non può riprelevarle sarebbe un guasto al riavvio del pod.
  local nome
  while read -r nome; do
    "$K3S" ctr -n k8s.io images label "$nome" io.cri-containerd.pinned=pinned >/dev/null
  done <<< "$nomi"

  # Controllo con i riferimenti esatti del chart, attraverso il runtime come
  # li chiede il kubelet.
  local ref mancanti=0
  while read -r ref; do
    if "$K3S" crictl inspecti "$ref" >/dev/null 2>&1; then
      log "presente: $ref"
    else
      log "MANCANTE: $ref"
      mancanti=$((mancanti + 1))
    fi
  done <<< "$riferimenti"
  [ "$mancanti" -eq 0 ] || fine "$mancanti immagini non si risolvono"
  log "tutte le immagini sono sul nodo e fissate"
  controlla_aiutante_local_path
}

# local-path crea ogni volume con un pod di supporto, la cui immagine k3s
# preleva solo alla prima richiesta di volume: su un nodo senza rete il
# volume del database resterebbe in attesa per sempre. L'immagine è tra
# quelle di sistema di k3s (fetch-k3s, install-*.sh --airgap-dir).
# Sul server il nome si legge dalla ConfigMap di local-path; su un agent,
# dove non c'è il kubeconfig, si cerca l'immagine che k3s usa di solito.
# Nessuno dei due comandi deve fermare lo script se fallisce.
controlla_aiutante_local_path() {
  local aiuto immagini
  aiuto="$("$K3S" kubectl -n kube-system get configmap local-path-config \
    -o jsonpath='{.data.helperPod\.yaml}' 2>/dev/null \
    | sed -nE 's/^[[:space:]]*image:[[:space:]]*"?([^"[:space:]]+)"?.*$/\1/p' | head -1 || true)"
  if [ -n "$aiuto" ]; then
    "$K3S" crictl inspecti "$aiuto" >/dev/null 2>&1 && return 0
  else
    immagini="$("$K3S" crictl images 2>/dev/null || true)"
    case "$immagini" in *mirrored-library-busybox*) return 0 ;; esac
    aiuto="l'immagine"
  fi
  log "ATTENZIONE: manca $aiuto con cui local-path crea i volumi. Conta solo se il nodo non raggiunge nessun registro, nemmeno attraverso un proxy o un mirror (con un proxy o un mirror k3s la preleva da sé al primo volume). In quel caso copia in /var/lib/rancher/k3s/agent/images/ le immagini di sistema di k3s (preload-images.sh fetch-k3s) e riavvia k3s (o k3s-agent)"
}

cmd_fetch_k3s() {
  local out="" versione="$K3S_VERSIONE_PROVATA"
  while [ $# -gt 0 ]; do
    case "$1" in
      --out) out="${2:?manca il valore di --out}"; shift 2 ;;
      --version) versione="${2:?manca il valore di --version}"; shift 2 ;;
      --arch) ARCH="${2:?manca il valore di --arch}"; shift 2 ;;
      -h|--help) uso; exit 0 ;;
      *) fine "opzione sconosciuta per fetch-k3s: $1" ;;
    esac
  done
  [ -n "$out" ] || fine "manca --out <cartella>"
  command -v curl >/dev/null || fine "serve curl"
  # sha256sum su Linux, shasum su macOS.
  local verifica
  if command -v sha256sum >/dev/null 2>&1; then verifica="sha256sum"
  elif command -v shasum >/dev/null 2>&1; then verifica="shasum -a 256"
  else fine "serve sha256sum o shasum"; fi
  mkdir -p "$out"
  local binario immagini
  binario="$(nome_binario "$ARCH")"
  immagini="k3s-airgap-images-$ARCH.tar.zst"
  for f in "$binario" "sha256sum-$ARCH.txt" "$immagini"; do
    log "scarico $f ($versione)"
    scarica "$(url_rilascio "$versione" "$f")" "$out/$f"
  done
  scarica "$(url_installer "$versione")" "$out/install.sh"
  # shellcheck disable=SC2086  # $verifica è un comando con i suoi argomenti
  ( cd "$out" && grep -E "[[:space:]]($binario|$immagini)\$" "sha256sum-$ARCH.txt" | $verifica -c --quiet - ) \
    || fine "checksum non validi in $out"
  log "pronto: $out (copialo sul nodo e usa install-*.sh --airgap-dir)"
}

azione="${1:-}"
[ $# -gt 0 ] && shift
case "$azione" in
  list)      cmd_list "$@" ;;
  save)      cmd_save "$@" ;;
  build)     cmd_build "$@" ;;
  import)    cmd_import "$@" ;;
  fetch-k3s) cmd_fetch_k3s "$@" ;;
  -h|--help|"") uso ;;
  *) fine "azione sconosciuta: $azione (list, save, build, import, fetch-k3s)" ;;
esac
