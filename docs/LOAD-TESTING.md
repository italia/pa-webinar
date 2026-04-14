# Load testing — eventi-dtd

Guida pratica per misurare la capacità di un deployment eventi-dtd usando
[jitsi-meet-torture](https://github.com/jitsi/jitsi-meet-torture) — lo stesso
tool di load test che il progetto Jitsi utilizza in CI per validare le release.

Questa guida è pensata sia per chi sviluppa la piattaforma sia per le PA che
la adottano in riuso e vogliono validare i numeri di sizing sulla propria
infrastruttura prima di metterla in produzione.

## TL;DR

```bash
# 1. Scegli una room e un nome di test
export JITSI_ROOM="load-test-$(date +%s)"

# 2. Conia un JWT valido (usa lo stesso segreto del tuo deployment)
export JITSI_JWT_SECRET="$(kubectl -n eventi-dtd get secret \
  eventi-dtd-app-secrets -o jsonpath='{.data.JITSI_JWT_SECRET}' | base64 -d)"
export JITSI_JWT=$(node scripts/load-test/mint-jwt.mjs \
  --room "$JITSI_ROOM" --name "LoadBot")

# 3. Punta al tuo Jitsi (o usa port-forward, vedi sotto)
export JITSI_URL="https://jitsi.example.com"

# 4. Lancia il test
PARTICIPANTS=100 SENDERS=5 DURATION=600 \
  ./scripts/load-test/run-torture.sh
```

## Compatibilità con eventi-dtd

jitsi-meet-torture è **compatibile** con questo progetto, con alcune note:

| Aspetto | Stato | Note |
|---|---|---|
| Accesso alle room | ✅ | Torture apre `<JITSI_URL>/<room>?jwt=...` — è l'URL della room Jitsi, non del portale eventi-dtd |
| Autenticazione JWT | ✅ | Il chart eventi-dtd configura Prosody per richiedere un JWT valido. `scripts/load-test/mint-jwt.mjs` produce token compatibili con la stessa configurazione dell'app (`app/src/lib/auth/jwt.ts`) |
| IFrame API del portale | ❌ | Torture **non** usa l'IFrame del portale: va direttamente al dominio Jitsi. Il test misura la capacità del motore video, non del portale Next.js |
| Q&A, polls, word cloud | ❌ | Non testabili con torture: sono feature del portale. Per un load test end-to-end del portale usa un tool HTTP (k6, Locust) contro le API REST |
| Recording (Jibri) | ⚠️ | Torture non avvia registrazioni. Se vuoi testare anche Jibri, lancia una registrazione manuale via moderator API durante il run |

In sintesi: **torture misura il piano video (Jitsi)**, che è la metrica critica
per decidere il sizing dei JVB. Per testare il portale (registrazione utenti,
signaling, Q&A sotto carico) serve un tool HTTP separato — vedi [sezione
dedicata](#load-test-del-portale).

## Come accedere a Jitsi durante i test

Il chart di default espone Jitsi su un hostname pubblico ma **redirecta la
home page `/`** verso il portale (vedi `infra/helm/eventi-dtd/templates/ingress-jitsi-web.yaml`).
I path delle room (`/nomeroom`), IFrame API (`/external_api.js`), BOSH
(`/http-bind`) e XMPP WebSocket (`/xmpp-websocket`) restano invece raggiungibili:
senza di questi l'IFrame del portale non funzionerebbe.

Hai quindi tre strategie:

### 1. Pubblico (il più semplice)

Se il tuo deployment espone il dominio Jitsi su internet (caso standard), punta
`JITSI_URL` direttamente al suo hostname:

```bash
export JITSI_URL=https://jitsi.example.com
./scripts/load-test/run-torture.sh
```

**Attenzione**: lanciare un load test da client internet consuma banda in
ingresso dell'ingress controller e produce traffico visibile. Usa questa
modalità solo su deployment di test/staging, mai su produzione durante eventi
reali.

### 2. Port-forward (per test locali)

Evita qualunque traffico pubblico usando `kubectl port-forward`:

```bash
kubectl -n eventi-dtd port-forward svc/eventi-dtd-jitsi-meet-web 8443:443 &
export JITSI_URL=https://localhost:8443
./scripts/load-test/run-torture.sh
```

Chrome rifiuterà il certificato self-signed: passa `-Dchrome.accept.insecure.certs=true`
al comando Maven (già incluso nello script quando `JITSI_URL` inizia con
`https://localhost`).

### 3. In-cluster Kubernetes Job (il più realistico)

Esegui torture **dentro lo stesso cluster** come Job, così il traffico resta
su rete interna e il test non consuma banda egress:

```bash
# 1. Conia un JWT e caricalo come secret
kubectl -n eventi-dtd create secret generic torture-jwt \
  --from-literal=jwt="$(JITSI_JWT_SECRET=$SECRET \
    node scripts/load-test/mint-jwt.mjs --room load-test --name Bot)"

# 2. Modifica scripts/load-test/k8s-job.yaml: sostituisci RELEASE-NAME e NAMESPACE
# 3. Applica il Job
kubectl -n eventi-dtd apply -f scripts/load-test/k8s-job.yaml
kubectl -n eventi-dtd logs -f job/torture
kubectl -n eventi-dtd delete job torture
```

Questa è la modalità che consigliamo per **validare il sizing di produzione**
prima di un evento grande: il percorso di rete è identico a quello reale tra
JVB e Prosody, ma evita l'ingress.

## Cosa misurare

Durante il test tieni d'occhio le metriche Prometheus che il chart espone:

```bash
kubectl -n eventi-dtd port-forward svc/prometheus-operated 9090:9090
```

Metriche chiave (vedi `docs/ARCHITECTURE.md` § Metriche):

| Metrica | Cosa indica |
|---|---|
| `eventi_jvb_participants` | Partecipanti collegati al bridge. Confronta con il numero spawned da torture |
| `eventi_jvb_stress_level` | Indicatore interno JVB: > 0.8 indica saturazione, sopra 1.0 degradazione qualità |
| `eventi_jvb_conferences` | Numero di conferenze attive sul bridge |
| `rate(container_network_transmit_bytes_total[1m])` | Banda egress del pod JVB — il più delle volte è questo il vero tetto |
| CPU/RAM pod JVB | Saturazione risorse container |
| `eventi_event_participants_total` | Histogram di fine evento — baseline per confronti nel tempo |

Un test ben riuscito mostra:

- `eventi_jvb_participants` che raggiunge il target senza drop
- `stress_level` stabile sotto 0.8
- Nessun errore `NS_ERROR_*` o `BridgeChannelMessage` nei log JVB
- Banda egress prevedibile (~50-100 kbps per ricevitore moltiplicato per senders)

## Cosa provare: scenari consigliati

Per avere una curva di capacità utile, esegui almeno questi test in sequenza
sul tuo deployment target, **partendo dal più piccolo** e documentando i
risultati in un changelog interno:

| Scenario | Participants | Senders | Durata | Obiettivo |
|---|---|---|---|---|
| Smoke test | 10 | 2 | 120s | Verifica che l'intera catena funzioni |
| Evento piccolo | 50 | 3 | 600s | Valida la configurazione tipica webinar |
| Evento medio | 150 | 5 | 900s | Verifica il sizing "Standard" |
| Evento grande | 300 | 8 | 900s | Verifica il sizing "Completa" (singolo JVB) |
| Stress test | 400-500 | 10 | 600s | Trova il punto di rottura del singolo bridge |
| Multi-evento | 2 × 150 | 2 × 5 | 900s | Valida la distribuzione su più JVB |

> **Senders vs Receivers**: in Malleus Jitsificus, i *senders* pubblicano audio+video, i *receivers* si limitano a ricevere. In un webinar tipico solo moderatori e relatori sono senders (2-8), tutti gli altri sono receivers. Dimensiona i senders in base al tuo caso d'uso reale, altrimenti sottostimi la capacità.

## Load test del portale

Per misurare la capacità del portale Next.js (registrazione, rendering pagina
evento, API Q&A) separatamente dal motore video, usa [k6](https://k6.io/) o
[Locust](https://locust.io/) contro le API REST documentate in
`/api/openapi.json`. Endpoint rilevanti:

- `POST /api/events/:slug/register` — registrazione partecipante (cardinalità più alta durante eventi grandi)
- `GET /api/events/:slug` — caricamento pagina evento pubblica (cacheable)
- `POST /api/events/:slug/questions` — submit Q&A durante l'evento
- `POST /api/events/:slug/questions/:id/upvote` — upvote in tempo reale

Uno script k6 di base può essere aggiunto in futuro in `scripts/load-test/portal-k6.js`. Per ora, l'approccio consigliato è dimensionare l'HPA Next.js (`min=2, max=6`) con margine e osservare `nextjs_http_request_duration_seconds` durante un evento reale.

## Interpretare i risultati e aggiornare la documentazione

Se trovi numeri di capacità diversi da quelli dichiarati in
`docs/ARCHITECTURE.md` e `docs/DEPLOYMENT.md`, **aggiornali**. Valori indicativi
basati su hardware di riferimento sono utili come punto di partenza, ma numeri
misurati sul proprio cluster sono sempre più credibili per le PA che valutano
il riuso.

Quando pubblichi risultati, includi:

- Versione eventi-dtd e versione Jitsi
- Cloud/provider e tipo istanza del node pool JVB
- Banda di uplink cluster
- Config `values.yaml` rilevante (CPU/memory JVB, `octo.enabled`, numero repliche)
- Metriche osservate (grafici Prometheus, stress level, banda)

## Esecuzione locale con Docker / Podman

Per iterazioni veloci (o quando non vuoi occupare il cluster), puoi eseguire
lo stesso load test sulla tua macchina locale via container. È la via più
pratica se disponi di una workstation con RAM/CPU abbondanti (indicativamente
64+ GB e 16+ core per test interessanti in media mode).

### Requisiti

- `podman` **oppure** `docker` (podman preferito, funziona rootless)
- Rete in uscita verso il dominio Jitsi del deploy che stai testando
- Il **secret JWT** dello stesso deploy (`JITSI_JWT_SECRET`) — puoi estrarlo dal cluster:
  ```bash
  kubectl -n videocall-test get secret videocall-secrets \
    -o jsonpath='{.data.JITSI_JWT_SECRET}' | base64 -d
  ```

### Build dell'immagine

Dentro `scripts/load-test/` trovi un `Dockerfile` che installa JDK 17, Maven,
Google Chrome stable, chromedriver matched e clona `jitsi-meet-torture` con
dipendenze Maven pre-scaricate. Il build dura 3-5 minuti ma successivamente
ogni run parte in ~5 secondi.

```bash
cd eventi-dtd/scripts/load-test
podman build -t eventi-dtd-load-test .
# oppure
docker build -t eventi-dtd-load-test .
```

### Esecuzione

Usa lo script wrapper `run-local.sh`, che gestisce runtime detection (podman/docker)
e propaga le env var al container:

```bash
# Smoke test contro l'env test pubblico (stile scenario webinar scalato)
JITSI_URL=https://jitsi-test.innovazione.gov.it \
JITSI_JWT_SECRET="$(kubectl -n videocall-test get secret videocall-secrets \
  -o jsonpath='{.data.JITSI_JWT_SECRET}' | base64 -d)" \
JITSI_JWT_SUBJECT=jitsi-test.innovazione.gov.it \
PARTICIPANTS=20 SENDERS=5 DURATION=300 \
  ./run-local.sh
```

### Scenari consigliati per la workstation locale

Con una workstation tipo 128 GB RAM / 24 core / 1 Gbps puoi realisticamente girare:

| Scenario | Env | Cosa misura |
|---|---|---|
| **Webinar signaling-only** | `USE_LOAD_TEST=true RECEIVERS_PER_TAB=25 PARTICIPANTS=500 SENDERS=2 DURATION=600` | Tenuta di Prosody + Jicofo con molte sessioni concorrenti. Nessuna banda media. |
| **Webinar con media** | `USE_LOAD_TEST=false PARTICIPANTS=30 SENDERS=5 DURATION=600` | Senders video reali + receiver che decodificano streams. Misura CPU/banda JVB per bot. |
| **Videocall di gruppo** | `USE_LOAD_TEST=false PARTICIPANTS=80 SENDERS=80 DURATION=600` | Tutti publishing video simultanei (~80 × 400 MB ≈ 32 GB). Stress forte su JVB. |
| **Stress vero (a rottura)** | Aumenta `PARTICIPANTS` finché non vedi frame drop o timeout | Trova il punto di rottura sulla tua infra |

Per scenari > 100 bot in media mode, ci sono **tuning chiave**:

```bash
# /dev/shm grande — headless Chrome ci appoggia la memoria video
SHM_SIZE=8g ./run-local.sh

# Abbassa la risoluzione del video fake per risparmiare CPU
# (modifica Dockerfile o monta un y4m alternativo)
```

### Interpretare i risultati

Alla fine del run, Maven stampa `Tests run: X, Failures: Y`. Un test riuscito
ha `Failures: 0` e ogni partecipante mostra `Hung up` + `Closing` in sequenza.

Durante il run, in un altro terminale osserva:
- `top` / `htop` sulla macchina — saturazione CPU = troppi bot per questa macchina
- Rete out — `vnstat` o `nload` — per quantificare la banda uscente verso Jitsi
- Lato cluster: `kubectl -n <ns> top pod -l app.kubernetes.io/component=jvb` per la saturazione JVB

### Limiti dell'approccio "single machine"

Una singola workstation spinge fino a qualche centinaio di bot in media mode,
ma per test veramente grandi (1000+ bot video real-time) serve un **Selenium
Grid** con N browser node distribuiti, oppure il Kubernetes Job in parallel mode
(vedi [sezione K8s in-cluster](#3-in-cluster-kubernetes-job-il-più-realistico)).
La workstation è perfetta per lo sviluppo iterativo e per validare changeset;
per capacity planning vero conviene il cluster.

## Risorse

- [jitsi-meet-torture su GitHub](https://github.com/jitsi/jitsi-meet-torture)
- [Malleus Jitsificus — Jitsi blog post](https://jitsi.org/blog/jitsi-videobridge-performance-evaluation/)
- [Jitsi scalability guide](https://jitsi.github.io/handbook/docs/devops-guide/scalable)
- `docs/ARCHITECTURE.md` § Scaling e capacità
