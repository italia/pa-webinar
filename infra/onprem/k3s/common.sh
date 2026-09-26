# shellcheck shell=bash
#
# Funzioni comuni a install-server.sh e install-agent.sh (sul nodo), e a
# preload-images.sh e pa-webinar-up.sh (sulla postazione): non si esegue da
# solo. Gli script si lanciano da una copia dell'intera cartella
# infra/onprem/k3s, perché leggono questo file e i file di configurazione
# accanto a sé.

# Versione di k3s provata con il chart. Un'altra si passa con --version, a
# rischio di chi la sceglie: Traefik, ServiceLB e kube-router cambiano con k3s.
K3S_VERSIONE_PROVATA="v1.36.4+k3s1"

CARTELLA_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Reti interne predefinite di k3s: servono in NO_PROXY anche quando non si
# cambiano, perché il traffico verso pod e Service non deve passare dal proxy.
CLUSTER_CIDR="10.42.0.0/16"
SERVICE_CIDR="10.43.0.0/16"

# ── Opzioni comuni (valori predefiniti) ─────────────────────────
K3S_VERSIONE="$K3S_VERSIONE_PROVATA"
NODE_IP=""
FLANNEL_IFACE=""
PROXY="${HTTPS_PROXY:-${https_proxy:-${HTTP_PROXY:-${http_proxy:-}}}}"
NO_PROXY_EXTRA="${NO_PROXY:-${no_proxy:-}}"
AMBITO_PROXY="containerd"
FILE_REGISTRI=""
CARTELLA_AIRGAP=""
SYSCTL="si"
ATTESA="si"
ETICHETTE=()
TAINT=()

log()  { printf '[k3s] %s\n' "$*" >&2; }
fine() { printf '[k3s] ERRORE: %s\n' "$*" >&2; exit 1; }

richiedi_root() {
  [ "$(id -u)" -eq 0 ] || fine "va lanciato come root, per esempio: sudo env HTTPS_PROXY=... $0 ..."
}

# Opzioni condivise dai due script. Restituisce 0 se ha consumato l'opzione
# (e in CONSUMATI quante parole), 1 se non è sua.
# shellcheck disable=SC2034  # CONSUMATI la leggono gli script che includono questo file
CONSUMATI=0
# shellcheck disable=SC2034
opzione_comune() {
  CONSUMATI=2
  case "$1" in
    --version)        K3S_VERSIONE="${2:?manca il valore di --version}" ;;
    --node-ip)        NODE_IP="${2:?manca il valore di --node-ip}" ;;
    --flannel-iface)  FLANNEL_IFACE="${2:?manca il valore di --flannel-iface}" ;;
    --proxy)          PROXY="${2:?manca il valore di --proxy}" ;;
    --no-proxy)       NO_PROXY_EXTRA="${2:?manca il valore di --no-proxy}" ;;
    --proxy-scope)    AMBITO_PROXY="${2:?manca il valore di --proxy-scope}" ;;
    --registries)     FILE_REGISTRI="${2:?manca il valore di --registries}" ;;
    --airgap-dir)     CARTELLA_AIRGAP="${2:?manca il valore di --airgap-dir}" ;;
    --cluster-cidr)   CLUSTER_CIDR="${2:?manca il valore di --cluster-cidr}" ;;
    --service-cidr)   SERVICE_CIDR="${2:?manca il valore di --service-cidr}" ;;
    --node-label)     ETICHETTE+=("${2:?manca il valore di --node-label}") ;;
    --node-taint)     TAINT+=("${2:?manca il valore di --node-taint}") ;;
    --no-sysctl)      SYSCTL="no"; CONSUMATI=1 ;;
    --no-wait)        ATTESA="no"; CONSUMATI=1 ;;
    *) return 1 ;;
  esac
  return 0
}

uso_opzioni_comuni() {
  cat <<'FINE'
Rete del nodo
  --node-ip IP             indirizzo del nodo verso gli altri nodi e i client
                           (predefinito: quello della rotta di default)
  --flannel-iface NOME     scheda per il traffico tra nodi, su VM con più schede
  --cluster-cidr CIDR      rete dei pod (predefinito: 10.42.0.0/16)
  --service-cidr CIDR      rete dei Service (predefinito: 10.43.0.0/16)
  --node-label K=V         etichetta del nodo (ripetibile)
  --node-taint K=V:EFFETTO taint del nodo (ripetibile)

Proxy, registro, nodi senza Internet
  --proxy URL              proxy HTTP(S), per esempio http://<proxy>:<porta>
                           (predefinito: HTTPS_PROXY o HTTP_PROXY dell'ambiente)
  --no-proxy LISTA         voci in più per NO_PROXY, separate da virgola (la
                           rete dei nodi, un registro interno); pod, Service,
                           .svc, .cluster.local e l'IP del nodo ci sono già
  --proxy-scope AMBITO     containerd (predefinito): il proxy vale solo per
                           prelevare le immagini; all: anche per k3s e kubelet
  --registries FILE        registries.yaml da installare (mirror, credenziali,
                           CA): vedi registries.yaml.example
  --airgap-dir DIR         binario, install.sh, checksum e immagini di sistema
                           di k3s preparati con `preload-images.sh fetch-k3s`:
                           nessun download dal nodo

Altro
  --version V              versione di k3s (predefinita: quella provata)
  --no-sysctl              non installare 90-pa-webinar-jvb.conf
  --no-wait                non aspettare che il nodo sia pronto
  -h, --help               questo aiuto
FINE
}

architettura() {
  case "$(uname -m)" in
    x86_64|amd64)  echo amd64 ;;
    aarch64|arm64) echo arm64 ;;
    *) fine "architettura non supportata: $(uname -m)" ;;
  esac
}

# Nome del binario nel rilascio di k3s per un'architettura.
nome_binario() {
  if [ "$1" = amd64 ]; then echo k3s; else echo "k3s-$1"; fi
}

# Il `+` delle versioni di k3s va codificato negli URL di GitHub.
url_rilascio() {
  printf 'https://github.com/k3s-io/k3s/releases/download/%s/%s' "${1//+/%2B}" "$2"
}

url_installer() {
  printf 'https://raw.githubusercontent.com/k3s-io/k3s/%s/install.sh' "${1//+/%2B}"
}

# Il proxy arriva a curl dall'ambiente, non dalla riga di comando: un
# indirizzo con credenziali non finisce nell'elenco dei processi.
scarica() {
  local url="$1" dest="$2"
  https_proxy="$PROXY" HTTPS_PROXY="$PROXY" curl -sSfL --retry 3 --connect-timeout 20 -o "$dest" "$url" \
    || fine "download non riuscito: $url"
}

# Un URL da scrivere nei log, senza utente e password.
senza_credenziali() {
  printf '%s' "$1" | sed -E 's#^([A-Za-z][A-Za-z0-9+.-]*://)[^/@]*@#\1***@#'
}

rileva_node_ip() {
  [ -n "$NODE_IP" ] && return 0
  # Senza rotta di default (reti isolate) `ip route get` fallisce: si passa
  # agli indirizzi della macchina, e infine alla richiesta di --node-ip.
  NODE_IP="$(ip -4 route get 1.1.1.1 2>/dev/null \
    | awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }' || true)"
  [ -n "$NODE_IP" ] || NODE_IP="$(hostname -I 2>/dev/null | awk '{ print $1 }' || true)"
  [ -n "$NODE_IP" ] || fine "indirizzo del nodo non rilevato: passalo con --node-ip"
}

# NO_PROXY completo: reti interne del cluster, nomi interni, il nodo stesso,
# più quello che passa chi installa. Il primo argomento aggiunge un host
# (l'agent ci mette il server).
componi_no_proxy() {
  local extra_host="${1:-}" voci
  voci="127.0.0.0/8,localhost,$CLUSTER_CIDR,$SERVICE_CIDR,.svc,.cluster.local,$NODE_IP"
  [ -n "$extra_host" ] && voci="$voci,$extra_host"
  [ -n "$NO_PROXY_EXTRA" ] && voci="$voci,$NO_PROXY_EXTRA"
  printf '%s' "$voci"
}

controlla_opzioni_comuni() {
  case "$AMBITO_PROXY" in containerd|all) ;; *) fine "--proxy-scope vale containerd o all" ;; esac
  [ -z "$FILE_REGISTRI" ] || [ -r "$FILE_REGISTRI" ] || fine "registries.yaml non leggibile: $FILE_REGISTRI"
  [ -z "$CARTELLA_AIRGAP" ] || [ -d "$CARTELLA_AIRGAP" ] || fine "cartella non trovata: $CARTELLA_AIRGAP"
  if [ "$K3S_VERSIONE" != "$K3S_VERSIONE_PROVATA" ]; then
    log "ATTENZIONE: k3s $K3S_VERSIONE non è la versione provata con il chart ($K3S_VERSIONE_PROVATA)"
  fi
  command -v systemctl >/dev/null || fine "serve systemd"
  command -v sha256sum >/dev/null || fine "serve sha256sum (coreutils)"
  if [ -z "$CARTELLA_AIRGAP" ]; then
    command -v curl >/dev/null || fine "serve curl (oppure --airgap-dir)"
  fi
  controlla_selinux
}

# ── SELinux (RHEL e derivate, SUSE) ─────────────────────────────
# Con SELinux k3s vuole la sua policy (pacchetto k3s-selinux, che richiede
# container-selinux) e il binario etichettato container_runtime_exec_t.
# install.sh fa entrambe le cose solo se gli si lascia scaricare i pacchetti:
# con INSTALL_K3S_SKIP_DOWNLOAD=true salta anche SELinux, con =binary salta
# solo il binario, che qui arriva già verificato. Quindi:
#   - policy già installata: nessun download, il binario si etichetta qui;
#   - policy assente su una distribuzione RPM, con la rete: install.sh
#     installa i pacchetti come l'installazione standard di k3s (il gestore
#     di pacchetti deve raggiungere rpm.rancher.io, con il proxy della sua
#     configurazione: l'ambiente di install.sh non lo contiene);
#   - policy assente con --airgap-dir: con SELinux in enforcing ci si ferma
#     prima di toccare il nodo, perché k3s partirebbe senza policy.
# INSTALL_K3S_SKIP_SELINUX_RPM=true e INSTALL_K3S_SELINUX_WARN=true fanno
# quello che fanno in install.sh, e arrivano fino a lui.
POLICY_K3S=/usr/share/selinux/packages/k3s.pp
SALTA_DOWNLOAD=true

stato_selinux() {
  local stato=""
  command -v getenforce >/dev/null 2>&1 && stato="$(getenforce 2>/dev/null || true)"
  printf '%s' "${stato:-Disabled}"
}

distribuzione_rpm() {
  [ -d /usr/share/selinux ] || return 1
  command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1 \
    || command -v zypper >/dev/null 2>&1 || command -v rpm-ostree >/dev/null 2>&1
}

controlla_selinux() {
  [ -f "$POLICY_K3S" ] && return 0
  if [ "${INSTALL_K3S_SKIP_SELINUX_RPM:-}" = true ]; then
    log "SELinux: INSTALL_K3S_SKIP_SELINUX_RPM=true, la policy di k3s non si installa né si controlla"
    return 0
  fi
  if [ -z "$CARTELLA_AIRGAP" ]; then
    if distribuzione_rpm; then
      SALTA_DOWNLOAD=binary
      log "SELinux ($(stato_selinux)): install.sh installerà container-selinux e k3s-selinux (serve rpm.rancher.io; dietro un proxy, quello della configurazione di dnf)"
    fi
    return 0
  fi
  case "$(stato_selinux)" in
    Enforcing)
      if [ "${INSTALL_K3S_SELINUX_WARN:-}" = true ]; then
        log "ATTENZIONE: SELinux in enforcing senza la policy di k3s (INSTALL_K3S_SELINUX_WARN=true): i pod potrebbero non partire"
      else
        fine "SELinux è in enforcing e manca la policy di k3s ($POLICY_K3S). Senza Internet installa prima container-selinux, dai repository della distribuzione, e k3s-selinux, da un mirror di rpm.rancher.io; poi rilancia"
      fi ;;
    Permissive)
      log "ATTENZIONE: SELinux in permissive senza la policy di k3s: installa container-selinux e k3s-selinux prima di passare a enforcing" ;;
  esac
}

# Con la policy già installata install.sh non etichetta il binario (lo fa
# solo quando installa i pacchetti), e una nuova copia del binario perde
# l'etichetta: la si rimette qui, prima che k3s parta.
etichetta_binario() {
  [ -f "$POLICY_K3S" ] && [ "$SALTA_DOWNLOAD" = true ] || return 0
  [ "$(stato_selinux)" != Disabled ] || return 0
  if chcon -u system_u -r object_r -t container_runtime_exec_t /usr/local/bin/k3s 2>/dev/null; then
    log "SELinux: /usr/local/bin/k3s etichettato container_runtime_exec_t"
  elif [ "$(stato_selinux)" = Enforcing ]; then
    fine "SELinux: non riesco a etichettare /usr/local/bin/k3s come container_runtime_exec_t"
  fi
}

# Porta in $1 binario, install.sh e checksum di k3s: dalla cartella air-gap o
# da GitHub (attraverso il proxy, se c'è). Il binario si installa solo se il
# checksum coincide con quello pubblicato nel rilascio.
prepara_artefatti() {
  local dest="$1" arch binario
  arch="$(architettura)"
  binario="$(nome_binario "$arch")"
  if [ -n "$CARTELLA_AIRGAP" ]; then
    for f in "$binario" install.sh "sha256sum-$arch.txt"; do
      [ -r "$CARTELLA_AIRGAP/$f" ] || fine "manca $CARTELLA_AIRGAP/$f (prepara la cartella con preload-images.sh fetch-k3s)"
      cp "$CARTELLA_AIRGAP/$f" "$dest/$f"
    done
  else
    log "scarico k3s $K3S_VERSIONE ($arch)${PROXY:+ attraverso il proxy}"
    scarica "$(url_rilascio "$K3S_VERSIONE" "$binario")" "$dest/$binario"
    scarica "$(url_rilascio "$K3S_VERSIONE" "sha256sum-$arch.txt")" "$dest/sha256sum-$arch.txt"
    scarica "$(url_installer "$K3S_VERSIONE")" "$dest/install.sh"
  fi
  ( cd "$dest" && grep -E "[[:space:]]$binario\$" "sha256sum-$arch.txt" | sha256sum -c --quiet - ) \
    || fine "checksum del binario di k3s non valido"
  install -m 0755 "$dest/$binario" /usr/local/bin/k3s
  log "k3s installato in /usr/local/bin/k3s ($(/usr/local/bin/k3s --version | head -1))"

  # Immagini di sistema di k3s (Traefik, CoreDNS, ServiceLB, local-path,
  # metrics-server, pause): k3s le importa da qui a ogni avvio.
  if [ -n "$CARTELLA_AIRGAP" ]; then
    local img
    for img in "$CARTELLA_AIRGAP"/k3s-airgap-images-"$arch".tar*; do
      [ -e "$img" ] || continue
      mkdir -p /var/lib/rancher/k3s/agent/images
      cp "$img" /var/lib/rancher/k3s/agent/images/
      log "immagini di sistema pronte: $(basename "$img")"
    done
  fi
}

installa_sysctl() {
  [ "$SYSCTL" = si ] || return 0
  install -m 0644 "$CARTELLA_SCRIPT/90-pa-webinar-jvb.conf" /etc/sysctl.d/90-pa-webinar-jvb.conf
  sysctl -q -p /etc/sysctl.d/90-pa-webinar-jvb.conf
  log "buffer UDP del bridge: rmem_max=$(sysctl -n net.core.rmem_max) wmem_max=$(sysctl -n net.core.wmem_max)"
}

installa_registri() {
  [ -n "$FILE_REGISTRI" ] || return 0
  mkdir -p /etc/rancher/k3s
  # Può contenere credenziali del registro: leggibile solo da root.
  install -m 0600 "$FILE_REGISTRI" /etc/rancher/k3s/registries.yaml
  log "registries.yaml installato"
}

# Scrive la configurazione di k3s in un file suo, senza toccare un
# config.yaml già presente. Il resto delle righe arriva dallo script chiamante.
scrivi_configurazione() {
  local extra="$1" file=/etc/rancher/k3s/config.yaml.d/50-pa-webinar.yaml v
  mkdir -p /etc/rancher/k3s/config.yaml.d
  {
    echo "# Scritto da infra/onprem/k3s: rilanciare lo script per cambiarlo."
    echo "node-ip: \"$NODE_IP\""
    [ -n "$FLANNEL_IFACE" ] && echo "flannel-iface: \"$FLANNEL_IFACE\""
    if [ "${#ETICHETTE[@]}" -gt 0 ]; then
      echo "node-label:"
      for v in "${ETICHETTE[@]}"; do echo "  - \"$v\""; done
    fi
    if [ "${#TAINT[@]}" -gt 0 ]; then
      echo "node-taint:"
      for v in "${TAINT[@]}"; do echo "  - \"$v\""; done
    fi
    printf '%s' "$extra"
  } > "$file"
  chmod 0600 "$file"
  log "configurazione di k3s: $file"
}

# Un valore tra apici singoli, per un file letto da sh.
quota_sh() {
  printf "'%s'" "${1//\'/\'\\\'\'}"
}

# Lancia install.sh con un ambiente ripulito: install.sh copia nel file di
# ambiente del servizio ogni variabile K3S_*, CONTAINERD_* e *_PROXY che
# trova, e il proxy deve finirci solo nella forma scelta con --proxy-scope.
# Le variabili (token, proxy con eventuali credenziali) passano da un file
# leggibile solo da root nella cartella di lavoro, non dalla riga di comando
# di `env`, che chiunque sul nodo vede nell'elenco dei processi.
# Argomenti: server|agent, la cartella di lavoro, poi coppie VARIABILE=valore.
lancia_installer() {
  local ruolo="$1" dir="$2"; shift 2
  local ambiente=(
    "INSTALL_K3S_SKIP_DOWNLOAD=$SALTA_DOWNLOAD"
    "INSTALL_K3S_VERSION=$K3S_VERSIONE"
  )
  [ -n "${INSTALL_K3S_SKIP_SELINUX_RPM:-}" ] && ambiente+=("INSTALL_K3S_SKIP_SELINUX_RPM=$INSTALL_K3S_SKIP_SELINUX_RPM")
  [ -n "${INSTALL_K3S_SELINUX_WARN:-}" ] && ambiente+=("INSTALL_K3S_SELINUX_WARN=$INSTALL_K3S_SELINUX_WARN")
  if [ -n "$PROXY" ]; then
    local np
    np="$(componi_no_proxy "${HOST_EXTRA_NO_PROXY:-}")"
    if [ "$AMBITO_PROXY" = all ]; then
      ambiente+=("HTTP_PROXY=$PROXY" "HTTPS_PROXY=$PROXY" "NO_PROXY=$np")
    else
      ambiente+=("CONTAINERD_HTTP_PROXY=$PROXY" "CONTAINERD_HTTPS_PROXY=$PROXY" "CONTAINERD_NO_PROXY=$np")
    fi
    log "proxy per $AMBITO_PROXY: $(senza_credenziali "$PROXY") (NO_PROXY=$np)"
  fi
  local file_ambiente="$dir/ambiente" voce
  ( umask 077; : > "$file_ambiente" )
  for voce in "${ambiente[@]}" "$@"; do
    printf 'export %s=%s\n' "${voce%%=*}" "$(quota_sh "${voce#*=}")" >> "$file_ambiente"
  done
  etichetta_binario
  # shellcheck disable=SC2016  # gli argomenti li espande la shell lanciata
  env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root \
    sh -c '. "$1" && exec sh "$2" "$3"' sh "$file_ambiente" "$dir/install.sh" "$ruolo" \
    || fine "install.sh non riuscito (vedi sopra). Su RHEL e derivate, se il gestore di pacchetti non raggiunge rpm.rancher.io: installa prima container-selinux e k3s-selinux, poi rilancia"
}

# Il nodo si cerca per indirizzo, non per nome: k3s registra il nome
# dell'host in minuscolo, e un node-name in config.yaml lo cambia del tutto.
aspetta_nodo() {
  [ "$ATTESA" = si ] || return 0
  local nome=""
  log "attendo che il nodo $NODE_IP sia Ready"
  for _ in $(seq 1 60); do
    nome="$(/usr/local/bin/k3s kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"|"}{.status.addresses[?(@.type=="InternalIP")].address}{"|"}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' 2>/dev/null \
      | awk -F'|' -v ip="$NODE_IP" 'index(" " $2 " ", " " ip " ") && $3 == "True" { print $1; exit }' || true)"
    if [ -n "$nome" ]; then
      log "nodo $nome Ready"
      return 0
    fi
    sleep 5
  done
  log "il nodo $NODE_IP non è Ready dopo 5 minuti: journalctl -u k3s (o k3s-agent)"
  return 1
}

# ── Immagini dell'applicazione e versione del checkout ──────────
# Chart, file di esempio e immagini vengono dallo stesso tag git: i tag delle
# due immagini si ricavano dal checkout del repository in $1.
#   - su un tag di rilascio vX.Y.Z: "X.Y.Z vX.Y.Z-migrate", i tag pubblicati
#     (l'immagine senza la v, le migrazioni con la v del tag git);
#   - su qualunque altro commit: "local-<sha> local-<sha>-migrate", con le
#     prime 12 cifre del commit, per immagini costruite da questo checkout;
#   - senza git (un archivio dei sorgenti): la versione del chart
#     (appVersion), come su un tag di rilascio.
# Stampa i due tag separati da uno spazio; esce con 1 se non li ricava.
# shellcheck disable=SC2034  # li leggono gli script che includono questo file
REPO_IMMAGINE_PUBBLICATA="ghcr.io/italia/pa-webinar"
# shellcheck disable=SC2034
REPO_IMMAGINE_LOCALE="pa-webinar"

tag_da_checkout() {
  local radice="$1" tag sha versione
  if command -v git >/dev/null 2>&1 && git -C "$radice" rev-parse --git-dir >/dev/null 2>&1; then
    tag="$(git -C "$radice" describe --tags --exact-match --match 'v[0-9]*' HEAD 2>/dev/null || true)"
    if [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      printf '%s %s\n' "${tag#v}" "$tag-migrate"
      return 0
    fi
    sha="$(git -C "$radice" rev-parse --short=12 HEAD 2>/dev/null || true)"
    [ -n "$sha" ] || return 1
    printf 'local-%s local-%s-migrate\n' "$sha" "$sha"
    return 0
  fi
  versione="$(sed -nE 's/^appVersion:[[:space:]]*"?([0-9]+\.[0-9]+\.[0-9]+)"?[[:space:]]*$/\1/p' \
    "$radice/infra/helm/pa-webinar/Chart.yaml" 2>/dev/null | head -n1)"
  [ -n "$versione" ] || return 1
  printf '%s v%s-migrate\n' "$versione" "$versione"
}

# Vero se il checkout in $1 ha modifiche non salvate (file tracciati).
checkout_modificato() {
  command -v git >/dev/null 2>&1 || return 1
  git -C "$1" rev-parse --git-dir >/dev/null 2>&1 || return 1
  ! git -C "$1" diff --quiet HEAD -- 2>/dev/null
}

# Costruisce con docker le due immagini dai sorgenti in $1: l'applicazione
# ($2) e le migrazioni ($3), che girano dallo stadio `builder` come
# nell'immagine pubblicata. L'uscita di docker va in $4 (un file di log), o
# sull'uscita di errore se $4 è vuoto.
costruisci_immagini() {
  local radice="$1" app="$2" migrazioni="$3" registro="${4:-}"
  if [ -n "$registro" ]; then
    docker build --progress=plain -t "$app" "$radice" >> "$registro" 2>&1 || return 1
    docker build --progress=plain --target builder -t "$migrazioni" "$radice" >> "$registro" 2>&1 || return 1
  else
    docker build -t "$app" "$radice" >&2 || return 1
    docker build --target builder -t "$migrazioni" "$radice" >&2 || return 1
  fi
}
