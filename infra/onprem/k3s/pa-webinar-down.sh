#!/usr/bin/env bash
#
# Toglie un'installazione fatta con pa-webinar-up.sh: la release Helm e il
# namespace, con il database, i volumi, la casella di prova e i componenti
# facoltativi. I dati dell'installazione sono cancellati, non messi da parte:
# prima, se servono, un backup (scripts/backup.sh) copiato fuori dal server.
#
# Uso:  infra/onprem/k3s/pa-webinar-down.sh --portal FQDN [--k3s] [--purge] [--purge-images] [--yes]
#   (nessuna opzione)  toglie PA Webinar dal server; k3s resta, e un nuovo
#                      pa-webinar-up.sh riparte da un database vuoto con gli
#                      stessi segreti. Chiede conferma (il nome del portale)
#   --k3s              disinstalla anche k3s dal server (k3s-uninstall.sh):
#                      tutto quello che gira nel cluster, immagini comprese
#   --purge            cancella anche la cartella di stato: segreti, autorità
#                      locale, certificati, kubeconfig (anche kubeconfig.tunnel),
#                      opzioni. La prossima installazione ne genera di nuovi
#   --purge-images     toglie le immagini dell'applicazione che pa-webinar-up.sh
#                      ha costruito con docker su questa macchina (quelle
#                      elencate in images.built nella cartella di stato), e le
#                      loro copie importate nel server se k3s resta. Un'altra
#                      installazione da questa macchina che le usava le
#                      ricostruisce al prossimo lancio
#   --name NOME        l'installazione, se a pa-webinar-up.sh ne hai dato uno
#   --state-dir DIR    la cartella di stato, se a pa-webinar-up.sh ne hai data una
#   --yes, -y          nessuna domanda di conferma (come minikube-down.sh)
#
# Server, utente ssh, namespace e release vengono dalle opzioni ricordate da
# pa-webinar-up.sh (install.conf nella cartella di stato). Il contesto di
# kubectl e ~/.kube/config non si toccano.

set -euo pipefail

CARTELLA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOME=""; PORTALE_ARG=""; STATO=""; K3S="no"; PURGE="no"; PURGE_IMMAGINI="no"; SI="no"

errore() { printf '\n✗ %s\n' "$*" >&2; exit 1; }
passo() { printf '\n── %s\n' "$*"; }
nota() { printf '   %s\n' "$*"; }
uso() { awk 'NR < 3 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --portal) PORTALE_ARG="${2:?}"; shift 2 ;;
    --name) NOME="${2:?}"; shift 2 ;;
    --state-dir) STATO="${2:?}"; shift 2 ;;
    --k3s) K3S="si"; shift ;;
    --purge) PURGE="si"; shift ;;
    --purge-images) PURGE_IMMAGINI="si"; shift ;;
    --yes|-y) SI="si"; shift ;;
    -h|--help) uso; exit 0 ;;
    *) uso >&2; errore "Opzione sconosciuta: $1" ;;
  esac
done
NOME="${NOME:-$PORTALE_ARG}"
ARG_STATO=""
if [ -n "$STATO" ]; then ARG_STATO=" --state-dir '$STATO'"; fi
[ -n "$NOME" ] || [ -n "$STATO" ] || { uso >&2; errore "Serve --portal (o --name) per sapere quale installazione."; }
STATO="${STATO:-${XDG_CONFIG_HOME:-$HOME/.config}/pa-webinar/k3s/$NOME}"
CONF="$STATO/install.conf"
[ -r "$CONF" ] || errore "Non trovo $CONF: è la cartella di stato di pa-webinar-up.sh? (--name, --state-dir)"

HOST_SSH=""; LOCALE="no"; SSH_CHIAVE=""; SSH_PORTA=""; SSH_OPZIONI=(); NAMESPACE="pa-webinar"; RELEASE="pa-webinar"; PORTALE=""
while IFS= read -r riga || [ -n "$riga" ]; do
  case "$riga" in ''|'#'*) continue ;; esac
  k="${riga%%=*}"; v="${riga#*=}"
  case "$k" in
    HOST) HOST_SSH="$v" ;;
    LOCALE) LOCALE="$v" ;;
    SSH_CHIAVE) SSH_CHIAVE="$v" ;;
    SSH_PORTA) SSH_PORTA="$v" ;;
    SSH_OPZIONE) SSH_OPZIONI+=("$v") ;;
    NAMESPACE) NAMESPACE="${v:-$NAMESPACE}" ;;
    RELEASE) RELEASE="${v:-$RELEASE}" ;;
    PORTALE) PORTALE="$v" ;;
  esac
done < "$CONF"
[ "$LOCALE" = "si" ] || [ -n "$HOST_SSH" ] || errore "$CONF non dice su quale server è l'installazione."
# Le immagini che pa-webinar-up.sh ha costruito con docker su questa macchina
# (--images local, o la scelta automatica fuori da un tag di rilascio).
IMMAGINI_COSTRUITE=()
if [ -r "$STATO/images.built" ]; then
  while IFS= read -r riga || [ -n "$riga" ]; do
    case "$riga" in *[!A-Za-z0-9._:/-]*|'') continue ;; esac
    IMMAGINI_COSTRUITE+=("$riga")
  done < "$STATO/images.built"
fi

cat <<FINE

   Installazione   ${PORTALE:-$NOME}
   Server          ${HOST_SSH:-questa macchina}
   Da togliere     release $RELEASE e namespace $NAMESPACE: database, volumi, email in coda,
                   file caricati nello storage del cluster. Non si recuperano.
FINE
[ "$K3S" = "si" ] && printf '                   k3s dal server (k3s-uninstall.sh), con tutto il cluster\n'
[ "$PURGE" = "si" ] && printf '                   la cartella di stato %s (segreti, CA, kubeconfig)\n' "$STATO"
if [ "$PURGE_IMMAGINI" = "si" ] && [ "${#IMMAGINI_COSTRUITE[@]}" -gt 0 ]; then
  printf '                   le immagini costruite su questa macchina: %s\n' "${IMMAGINI_COSTRUITE[*]}"
fi
if [ "$SI" != "si" ]; then
  [ -t 0 ] || errore "Senza terminale serve --yes."
  printf '\nPer confermare scrivi il nome del portale (%s): ' "${PORTALE:-$NOME}"
  read -r risposta
  [ "$risposta" = "${PORTALE:-$NOME}" ] || errore "Annullato: nessuna modifica."
fi

# ── Accesso al server (come pa-webinar-up.sh) ───────────────────
TMP_LOCALE="$(mktemp -d "${TMPDIR:-/tmp}/pa-webinar-down.XXXXXX")"
PRESA=""
SSH=()
chiudi() {
  local esito=$?
  if [ -n "$PRESA" ] && [ -S "$PRESA" ]; then ssh -o ControlPath="$PRESA" -O exit "$HOST_SSH" >/dev/null 2>&1 || true; fi
  rm -rf "$TMP_LOCALE"
  return "$esito"
}
trap chiudi EXIT
cita() { local a out=""; for a in "$@"; do out="$out$(printf '%q' "$a") "; done; printf '%s' "$out"; }
PREFISSO_ROOT=""
remoto() { if [ "$LOCALE" = "si" ]; then "$@"; else ssh "${SSH[@]}" "$HOST_SSH" -- "$(cita "$@")"; fi; }
remoto_root() {
  if [ "$LOCALE" = "si" ]; then
    if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
  else
    ssh "${SSH[@]}" "$HOST_SSH" -- "$PREFISSO_ROOT$(cita "$@")"
  fi
}
if [ "$LOCALE" = "no" ]; then
  PRESA="$TMP_LOCALE/ssh"
  SSH_BASE=(-o ControlPath="$PRESA" -o ConnectTimeout=20 -o ServerAliveInterval=30)
  if [ -n "$SSH_CHIAVE" ]; then SSH_BASE+=(-i "$SSH_CHIAVE"); fi
  if [ -n "$SSH_PORTA" ]; then SSH_BASE+=(-p "$SSH_PORTA"); fi
  for o in ${SSH_OPZIONI[@]+"${SSH_OPZIONI[@]}"}; do SSH_BASE+=(-o "$o"); done
  ssh -o ControlMaster=yes -o ControlPersist=no "${SSH_BASE[@]}" -f -N "$HOST_SSH" \
    || errore "ssh verso $HOST_SSH non riuscito."
  SSH=(-o ControlMaster=no "${SSH_BASE[@]}")
  if [ "$(remoto id -u)" != "0" ]; then
    remoto sudo -n true 2>/dev/null || errore "Su $HOST_SSH l'utente non ha sudo senza password."
    PREFISSO_ROOT="sudo -n "
  fi
fi

# ── PA Webinar ──────────────────────────────────────────────────
K3S_ATTIVO="no"
if remoto_root test -x /usr/local/bin/k3s && [ "$(remoto_root systemctl is-active k3s 2>/dev/null || true)" = "active" ]; then
  K3S_ATTIVO="si"
  passo "Release $RELEASE e namespace $NAMESPACE"
  remoto_root cat /etc/rancher/k3s/k3s.yaml > "$TMP_LOCALE/kubeconfig"
  chmod 600 "$TMP_LOCALE/kubeconfig"
  if [ "$LOCALE" = "no" ]; then
    porta_api=""
    for p in $(seq 16443 16543); do
      if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then porta_api="$p"; break; fi
    done
    [ -n "$porta_api" ] || errore "Nessuna porta locale libera per il tunnel verso l'API."
    ssh "${SSH[@]}" -O forward -L "127.0.0.1:$porta_api:127.0.0.1:6443" "$HOST_SSH" >/dev/null 2>&1 \
      || errore "Tunnel ssh verso l'API di k3s non riuscito."
    sed -i.orig "s#https://127.0.0.1:6443#https://127.0.0.1:$porta_api#" "$TMP_LOCALE/kubeconfig"
  fi
  kc() { kubectl --kubeconfig "$TMP_LOCALE/kubeconfig" "$@"; }
  if helm --kubeconfig "$TMP_LOCALE/kubeconfig" status "$RELEASE" -n "$NAMESPACE" >/dev/null 2>&1; then
    helm --kubeconfig "$TMP_LOCALE/kubeconfig" uninstall "$RELEASE" -n "$NAMESPACE" --wait --timeout 5m >/dev/null
    nota "release $RELEASE tolta"
  else
    nota "release $RELEASE già assente"
  fi
  # Il namespace porta via Secret, volumi (local-path cancella anche la
  # cartella sul disco del server), Mailpit e i componenti facoltativi.
  if kc get namespace "$NAMESPACE" >/dev/null 2>&1; then
    kc delete namespace "$NAMESPACE" --wait --timeout=5m >/dev/null
    nota "namespace $NAMESPACE cancellato, con i volumi"
  else
    nota "namespace $NAMESPACE già assente"
  fi
  # I volumi local-path si cancellano in modo asincrono: si aspetta che non
  # ne resti nessuno del namespace.
  for _ in $(seq 1 30); do
    [ -z "$(kc get pv -o jsonpath="{range .items[?(@.spec.claimRef.namespace=='$NAMESPACE')]}{.metadata.name}{'\n'}{end}" 2>/dev/null)" ] && break
    sleep 2
  done
  resti="$(kc get pv -o jsonpath="{range .items[?(@.spec.claimRef.namespace=='$NAMESPACE')]}{.metadata.name}{' '}{end}" 2>/dev/null || true)"
  [ -z "$resti" ] || nota "ATTENZIONE: volumi ancora presenti: $resti (kubectl delete pv)"
  # Le copie importate nel containerd del server sono fissate (pinned) contro
  # la pulizia del kubelet: se k3s resta, restano lì finché non si tolgono.
  if [ "$PURGE_IMMAGINI" = "si" ] && [ "$K3S" = "no" ]; then
    for img in ${IMMAGINI_COSTRUITE[@]+"${IMMAGINI_COSTRUITE[@]}"}; do
      if remoto_root /usr/local/bin/k3s ctr -n k8s.io images rm "docker.io/library/$img" >/dev/null 2>&1; then
        nota "immagine $img tolta dal server"
      fi
    done
  fi
else
  nota "k3s non è attivo sul server: niente da togliere nel cluster"
fi

# ── k3s ─────────────────────────────────────────────────────────
if [ "$K3S" = "si" ]; then
  passo "k3s"
  if remoto_root test -x /usr/local/bin/k3s-uninstall.sh; then
    remoto_root /usr/local/bin/k3s-uninstall.sh >/dev/null 2>&1 || errore "k3s-uninstall.sh non riuscito sul server."
    nota "k3s disinstallato (cluster, immagini, /var/lib/rancher/k3s, /etc/rancher/k3s)"
  else
    nota "k3s non è installato"
  fi
  remoto_root rm -f /etc/sysctl.d/90-pa-webinar-jvb.conf
fi

# ── Cartella di stato ───────────────────────────────────────────
if [ "$PURGE" = "si" ]; then
  passo "Cartella di stato"
  # Solo i file che scrivono pa-webinar-up.sh e i componenti facoltativi,
  # poi la cartella se è rimasta vuota: uno --state-dir sbagliato non deve
  # poter cancellare altro.
  for f in install.conf install.conf.tmp secrets.env secrets.env.tmp smtp.env smtp.env.tmp extra-ca.crt \
           site.yaml kubeconfig kubeconfig.tunnel k3s.sha256 archive.sha256 helm-notes.txt build.log ca.key ca.crt \
           storage.env garage.env values-storage.yaml turn.env values-turn.yaml images.built; do
    rm -f "${STATO:?}/$f"
  done
  if [ -d "$STATO/tls" ]; then
    for r in portale conferenza storage turn; do rm -f "$STATO/tls/$r.key" "$STATO/tls/$r.crt"; done
    rmdir "$STATO/tls" 2>/dev/null || true
  fi
  if rmdir "$STATO" 2>/dev/null; then
    nota "cancellata $STATO"
  else
    nota "in $STATO restano altri file: non li tocco"
  fi
  nota "se avevi reso fidata l'autorità locale \"PA Webinar CA ($NOME, …)\", toglila dai browser."
else
  nota "segreti e opzioni restano in $STATO (--purge per cancellarli): un nuovo pa-webinar-up.sh li riusa"
fi

# ── Immagini su questa macchina ─────────────────────────────────
if [ "$PURGE_IMMAGINI" = "si" ] && [ "${#IMMAGINI_COSTRUITE[@]}" -eq 0 ]; then
  nota "nessuna immagine costruita su questa macchina è registrata in $STATO/images.built"
elif [ "${#IMMAGINI_COSTRUITE[@]}" -gt 0 ]; then
  if [ "$PURGE_IMMAGINI" = "si" ]; then
    passo "Immagini costruite su questa macchina"
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
      for img in "${IMMAGINI_COSTRUITE[@]}"; do
        if ! docker image inspect "$img" >/dev/null 2>&1; then
          nota "$img già assente"
        elif docker image rm "$img" >/dev/null 2>&1; then
          nota "$img tolta"
        else
          nota "ATTENZIONE: $img non si toglie (la usa un container?): docker image rm $img"
        fi
      done
      rm -f "$STATO/images.built"
      rmdir "$STATO" 2>/dev/null || true
    else
      nota "docker non risponde: le immagini restano (docker image rm ${IMMAGINI_COSTRUITE[*]})"
    fi
  elif [ "$PURGE" = "si" ]; then
    # Il loro elenco se n'è andato con la cartella di stato: il comando si
    # stampa qui, un altro lancio non saprebbe più quali sono.
    nota "le immagini costruite restano nel docker di questa macchina: docker image rm ${IMMAGINI_COSTRUITE[*]}"
  else
    nota "le immagini costruite restano nel docker di questa macchina (--purge-images per toglierle)"
  fi
fi
printf '\n✓ Fatto.\n'
if [ "$LOCALE" = "no" ] && { [ "$K3S" = "si" ] || [ "$PURGE" = "si" ]; }; then
  printf '  %s\n' "Se avevi aperto il tunnel ssh verso l'API di k3s (ssh -N -L …), chiudilo (Ctrl-C)."
fi
if [ "$K3S" = "no" ] && [ "$K3S_ATTIVO" = "si" ]; then
  if [ "$PURGE" = "si" ]; then
    printf '  k3s resta sul server: per toglierlo, sul server sudo /usr/local/bin/k3s-uninstall.sh\n'
  else
    printf '  k3s resta sul server: %s --portal %s%s --k3s per toglierlo.\n' "$CARTELLA/pa-webinar-down.sh" "${PORTALE:-$NOME}" "$ARG_STATO"
  fi
fi
