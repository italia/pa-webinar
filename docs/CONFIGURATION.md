# Configuration

## Branding

### Video watermark

The watermark overlaid on the Jitsi video area is configurable from the admin panel under **Impostazioni sito → Branding → Personalizzazione video**:

- **Toggle**: enable/disable the watermark
- **URL**: custom SVG or PNG image (transparent, ~120×40px recommended). Falls back to the organization logo, then to `/images/dtd-watermark.svg`
- **Opacity**: 10% to 80%
- **Position**: bottom-left, bottom-right, top-left, top-right

Settings are stored in the database (`SiteSetting` model) and applied dynamically — no restart needed.

### Waiting room music

The waiting room plays ambient music when a participant clicks "Enable music".

- **Default audio**: place an MP3 file at `app/public/audio/waiting-room-default.mp3`. If no file exists, the music button is still shown but playback will silently fail.
- **Per-event override**: in the admin create/edit event form, set the "Waiting room audio URL" field to a direct URL to an MP3 file. This overrides the default for that specific event.

Requirements for audio files:
- Format: MP3, 128 kbps or lower
- Duration: 30–120 seconds (loops automatically)
- Style: calm ambient/lofi suitable for a professional event lobby
- License: must be royalty-free (CC0, CC-BY, or equivalent)

### Jitsi branding

The platform customizes Jitsi's appearance via several mechanisms:

#### Dynamic branding JSON

The Jitsi branding is served by a dynamic API route at `/api/jitsi-branding.json`. It reads from site settings to generate the branding configuration (background color, logo, invite domain). No static file to edit — configure via the admin panel.

The `dynamicBrandingUrl` in `lib/jitsi/config.ts` points to this API. In production (same-origin via Ingress), Jitsi can fetch it directly. In local dev with cross-origin Jitsi, the fetch may fail silently — this is expected.

#### Custom CSS injection (production only)

When Jitsi is served from the same domain via Ingress (e.g. `eventi.dominio.gov.it/jitsi/`), you can inject custom CSS to restyle the Jitsi toolbar and UI:

1. Create a CSS file at `app/public/jitsi-custom.css`
2. Add to `jitsiInterfaceConfigOverwrite` in `lib/jitsi/config.ts`:
   ```typescript
   CUSTOM_CSS_URL: '/jitsi-custom.css',
   ```

Example custom CSS for production:

```css
/* Match toolbar to DTD navy theme */
.new-toolbox {
  background: linear-gradient(180deg, transparent, rgba(0, 40, 85, 0.9)) !important;
}

/* Style toolbar buttons */
.toolbox-button {
  color: #fff !important;
}

/* Hide Jitsi logo in toolbar */
.oqPGd, .oqPGd > * {
  display: none !important;
}

/* Match filmstrip background */
.filmstrip {
  background: rgba(0, 20, 40, 0.6) !important;
}
```

> **Note**: Jitsi's internal CSS classes may change between versions. Test after every Jitsi upgrade. This approach only works when the CSS file is same-origin with the Jitsi iframe.

#### Visual flow

The live room follows a deliberate color flow from top to bottom:

| Element | Color | Class/Style |
|---|---|---|
| Top bar | `#0066CC` (Bootstrap Italia primary) | `.live-top-bar` |
| Moderator bar | `#1a1a2e` (dark navy) | `.moderator-bar` |
| Jitsi container | `#002855` → `#001428` gradient | `.jitsi-wrapper` |
| Sidebar header | `#0066CC` (matches top bar) | `.live-sidebar-header` |
| Sidebar body | `#ffffff` with blue left border | `.live-sidebar` |
| Page background | `#f0f4f8` → `#e8eef4` | `.live-page-bg` |

## Provider email (SMTP)

L'applicazione invia email di conferma registrazione, promemoria, e link moderatore tramite SMTP.

### Mailgun (raccomandato per GDPR)

```yaml
SMTP_HOST: "smtp.eu.mailgun.org"   # Endpoint EU per compliance GDPR
SMTP_PORT: "587"
SMTP_SECURE: "true"
SMTP_USER: "postmaster@mg.tuodominio.com"
SMTP_PASSWORD: "la-tua-api-key-mailgun"
SMTP_FROM: "eventi@tuodominio.com"
SMTP_FROM_NAME: "Eventi PA"
```

- Usa l'endpoint `smtp.eu.mailgun.org` per garantire che i dati restino in EU
- La password corrisponde all'API key del dominio, non alla password dell'account

### Azure Communication Services

```yaml
SMTP_HOST: "smtp.azurecomm.net"
SMTP_PORT: "587"
SMTP_SECURE: "true"
SMTP_USER: "<resource-name>.<entra-app-id>.<entra-tenant-id>"
SMTP_PASSWORD: "la-tua-access-key"
SMTP_FROM: "DoNotReply@<azure-comm-domain>"
SMTP_FROM_NAME: "Eventi PA"
```

### SendGrid

```yaml
SMTP_HOST: "smtp.sendgrid.net"
SMTP_PORT: "587"
SMTP_SECURE: "true"
SMTP_USER: "apikey"                # Letteralmente "apikey"
SMTP_PASSWORD: "SG.la-tua-api-key"
SMTP_FROM: "eventi@tuodominio.com"
SMTP_FROM_NAME: "Eventi PA"
```

### SMTP generico

```yaml
SMTP_HOST: "mail.tuodominio.com"
SMTP_PORT: "587"
SMTP_SECURE: "true"
SMTP_USER: "eventi@tuodominio.com"
SMTP_PASSWORD: "la-tua-password"
SMTP_FROM: "eventi@tuodominio.com"
SMTP_FROM_NAME: "Eventi PA"
```

### Mailpit (solo sviluppo)

```yaml
SMTP_HOST: "mailpit"
SMTP_PORT: "1025"
SMTP_SECURE: "false"
SMTP_FROM: "test@localhost"
SMTP_FROM_NAME: "Eventi Test"
```

Interfaccia web: http://localhost:8025

## Database

### PostgreSQL nel cluster (modalita semplice)

Usa il subchart Bitnami:

```yaml
postgresql:
  enabled: true
  auth:
    username: eventi
    database: eventi_dtd
    password: "..."
```

### Database esterno

Imposta `postgresql.enabled: false` e fornisci `DATABASE_URL` nel Secret:

| Provider | Formato |
|---|---|
| Azure DB for PostgreSQL | `postgresql://user:pass@server.postgres.database.azure.com:5432/eventi_dtd?sslmode=require` |
| Amazon RDS | `postgresql://user:pass@instance.region.rds.amazonaws.com:5432/eventi_dtd?sslmode=require` |
| Google Cloud SQL | `postgresql://user:pass@private-ip:5432/eventi_dtd?sslmode=require` |
| Self-hosted | `postgresql://user:pass@host:5432/eventi_dtd` |

## Redis (chat pub/sub)

Required per il fan-out chat cross-pod. Lo stato canonico dei messaggi
vive in Postgres (tabella `chat_messages`), ma senza Redis due pod app
non si scambiano messaggi in tempo reale: gli utenti su pod diversi
vedono solo i messaggi del proprio pod fino al refresh. `/api/status`
riporta Redis come **`outage`** (non "idle") quando manca o il ping
fallisce — la chat real-time è una dipendenza richiesta, non opzionale.

### Redis nel cluster (modalità semplice)

Il chart include il subchart Bitnami di Redis con `redis.enabled: true`
di default. L'image è fissata a `latest` per evitare la rimozione del
tag pinnato nel Legacy Catalog Bitnami (policy dal 2025-08-28). Redis
usa autenticazione: metti la password nel Secret come `REDIS_PASSWORD`.

```yaml
redis:
  enabled: true
  architecture: standalone
  image:
    tag: latest
  auth:
    enabled: true
    existingSecret: "videocall-secrets"
    existingSecretPasswordKey: "REDIS_PASSWORD"
  master:
    persistence:
      enabled: false   # pub/sub è ephemeral; canonical state in Postgres

  # Esposizione Prometheus via redis-exporter sidecar. Il chart Bitnami
  # pinna anche il tag dell'exporter nel Legacy Catalog, quindi va
  # sovrascritto a :latest come il primary.
  metrics:
    enabled: true
    image:
      tag: latest
      pullPolicy: Always
    serviceMonitor:
      enabled: true
      namespace: videocall-test   # il namespace dove esce il ServiceMonitor
      interval: 30s
```

### Redis esterno (managed)

Imposta `redis.enabled: false` e fornisci `REDIS_URL` nel Secret:

| Provider | Formato |
|---|---|
| Azure Cache for Redis | `rediss://:accessKey@cache-name.redis.cache.windows.net:6380/0` |
| Amazon ElastiCache | `redis://user:pass@cluster.region.cache.amazonaws.com:6379/0` |
| Google Memorystore | `redis://:pass@private-ip:6379/0` |
| Self-hosted | `redis://:pass@host:6379/0` |

> Usa lo schema `rediss://` (con doppia `s`) per TLS — obbligatorio su
> Azure Cache che accetta solo connessioni cifrate.

### High availability (pianificato)

Il default è standalone (1 pod, no persistence, ~80Mi RAM idle). Su nodi
spot un'eviction = 30-60s di fan-out gap — i messaggi restano in Postgres
ma non propagano in tempo reale durante il reschedule. Per SLA stretti la
roadmap prevede switch a **Valkey** (fork BSD-3 di Redis, Linux Foundation)
con `architecture: replication`: 1 primary + 2 replica + 3 sentinel, ~3×
risorse. Giustificato quando si aggiungono feature critiche come
distributed rate-limiting; per PA con eventi saltuari il fallback
Postgres + reschedule automatico è sufficiente.

### Metriche esposte

Con `redis.metrics.enabled: true` il subchart installa un sidecar
`redis-exporter` e (se `serviceMonitor.enabled: true`) un ServiceMonitor
per Prometheus Operator. Metriche rilevanti:

- `redis_connected_clients` — connessioni TCP (pub + subscriber)
- `redis_memory_used_bytes` — uso memoria
- `redis_commands_processed_total` — rate ops/sec
- `redis_pubsub_channels` — canali pub/sub attivi (≈ eventi con chat live)

Le metriche app-level (`eventi_chat_messages_total`,
`eventi_chat_sse_connections`) sono esposte da `/api/metrics` (prom-client).
L'admin dashboard `/admin/monitoring` aggrega entrambe le sorgenti nella
sezione "Chat in-app & Redis" (richiede `PROMETHEUS_URL` configurato).

## Storage provider (file e registrazioni)

Il portale gestisce due **domini di storage** indipendenti, configurabili
separatamente:

- **files** — materiali evento (PDF, slide, immagini caricate dal moderatore)
- **recordings** — output Jibri + MP4 caricati manualmente

Ogni dominio supporta 2 backend:

- **Azure Blob Storage** — connection string con account key
- **S3-compatibile** — AWS S3, MinIO, Cloudflare R2, Wasabi, Google Cloud
  Storage (via HMAC interop), PSN, qualunque servizio S3 on-prem

Il provider viene scelto per auto-detection dalle env var presenti, oppure
forzato con `STORAGE_FILES_PROVIDER` / `RECORDING_STORAGE_TYPE`. Tutto
passa attraverso l'astrazione `app/src/lib/storage/` — nessun altro modulo
importa SDK vendor direttamente.

### Azure Blob (default DTD)

```yaml
# ConfigMap
AZURE_STORAGE_CONTAINER_NAME: "eventi-files"
RECORDING_STORAGE_TYPE: "azure-blob"
RECORDING_AZURE_CONTAINER: "recordings"

# Secret
AZURE_STORAGE_CONNECTION_STRING: "DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net"
RECORDING_AZURE_CONNECTION_STRING: "DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net"
```

SAS (Shared Access Signature) generati lato app con `StorageSharedKeyCredential`;
upload con PUT diretto, download con redirect firmato a breve scadenza.

### AWS S3

```yaml
# ConfigMap
STORAGE_FILES_PROVIDER: "s3"
STORAGE_FILES_S3_REGION: "eu-south-1"
STORAGE_FILES_S3_BUCKET: "eventi-files"
RECORDING_STORAGE_TYPE: "s3"
RECORDING_S3_REGION: "eu-south-1"
RECORDING_S3_BUCKET: "eventi-recordings"

# Secret
STORAGE_FILES_S3_ACCESS_KEY_ID: "AKIA..."
STORAGE_FILES_S3_SECRET_ACCESS_KEY: "..."
RECORDING_S3_ACCESS_KEY_ID: "AKIA..."
RECORDING_S3_SECRET_ACCESS_KEY: "..."
```

Omettere `*_ENDPOINT` fa puntare al regional endpoint AWS. Per IAM role
su EKS, ometti le credential e l'SDK usa il ServiceAccount IRSA.

### MinIO / S3 on-prem

```yaml
STORAGE_FILES_PROVIDER: "s3"
STORAGE_FILES_S3_ENDPOINT: "https://minio.example.com"
STORAGE_FILES_S3_REGION: "us-east-1"     # MinIO accetta qualunque valore
STORAGE_FILES_S3_BUCKET: "eventi-files"
STORAGE_FILES_S3_FORCE_PATH_STYLE: "true"  # obbligatorio per MinIO
```

`forcePathStyle: true` è richiesto perché MinIO non usa DNS virtual-host
e serve a costruire URL tipo `https://minio/bucket/key` invece di
`https://bucket.minio/key`.

### Google Cloud Storage (via S3 interop HMAC)

```yaml
STORAGE_FILES_PROVIDER: "s3"
STORAGE_FILES_S3_ENDPOINT: "https://storage.googleapis.com"
STORAGE_FILES_S3_REGION: "auto"
STORAGE_FILES_S3_BUCKET: "eventi-files"
STORAGE_FILES_S3_FORCE_PATH_STYLE: "true"
```

Credenziali HMAC da Cloud Console → Storage → Interoperability. L'SDK AWS
autentica e GCS traduce le request. Nativo `@google-cloud/storage` non è
necessario per gli use-case attuali (PUT/GET/DELETE/LIST + presigned URL).

### Cloudflare R2

```yaml
STORAGE_FILES_PROVIDER: "s3"
STORAGE_FILES_S3_ENDPOINT: "https://<account-id>.r2.cloudflarestorage.com"
STORAGE_FILES_S3_REGION: "auto"
STORAGE_FILES_S3_BUCKET: "eventi-files"
```

### PSN / cloud sovrani italiani

La maggior parte espone un'API S3-compatibile — configura come MinIO
sostituendo `STORAGE_FILES_S3_ENDPOINT` con il dominio PSN/CSIRT
(`https://s3.psn.it` o simili) e verifica con il provider se serve
`forcePathStyle`. Per registrazioni usa le stesse env con prefisso
`RECORDING_S3_*`.

### CSP e media-src

Se il bucket ha un dominio custom non coperto automaticamente dal
middleware (che già gestisce `*.blob.core.windows.net`, `*.amazonaws.com`,
`storage.googleapis.com`), aggiungi:

```yaml
RECORDING_MEDIA_CSP_HOSTS: "https://cdn.example.com https://minio.example.com"
```

Il middleware ammette queste origini in `media-src` e `connect-src` così
il player e il form di upload possano comunicare con il bucket.

### Matrice di compatibilità

| Provider | Upload PUT | Download GET | Delete | List | Note |
|---|---|---|---|---|---|
| Azure Blob | ✅ SAS | ✅ SAS | ✅ | ✅ | Default DTD |
| AWS S3 | ✅ presigned | ✅ presigned | ✅ | ✅ | IRSA supportato |
| MinIO | ✅ | ✅ | ✅ | ✅ | `forcePathStyle: true` |
| Cloudflare R2 | ✅ | ✅ | ✅ | ✅ | region `auto` |
| GCS (HMAC) | ✅ | ✅ | ✅ | ✅ | via S3 interop |
| PSN S3 | ✅ | ✅ | ✅ | ✅ | testare per-provider |

## Secrets management

Tre modalita disponibili (configurabili in `secrets.mode`):

| Modalita | Uso | Note |
|---|---|---|
| `existing` | Produzione | Secret creato manualmente o da pipeline CI/CD |
| `external` | Produzione | External Secrets Operator (Azure KV, AWS SM, GCP SM) |
| `generate` | Solo dev/test | Il chart genera il Secret dai valori — MAI in produzione |

Vedi `values.yaml` sezione `secrets` per la configurazione dettagliata.

## Rete Jitsi

### Connettività media (ICE)

Il flusso media WebRTC tra browser e JVB richiede la negoziazione ICE (Interactive Connectivity Establishment). Il percorso dipende dalla rete del client:

| Scenario client | Percorso media | Latenza |
|---|---|---|
| Rete aperta (UDP 10000) | Browser → JVB diretto | Minima |
| NAT simmetrico | Browser → TURN UDP 3478 → coturn → JVB | Bassa |
| Firewall restrittivo (solo 443) | Browser → TURNS TCP 443 → coturn → JVB | Media |

### Configurazione JVB

In ambienti Kubernetes con overlay network, i pod hanno IP interni (es. `192.168.x.x`) non raggiungibili dall'esterno. Configurare:

```yaml
jitsi-meet:
  jvb:
    stunServers: "turn.tuodominio.com:3478"
    extraEnvs:
      JVB_ADVERTISE_PRIVATE_CANDIDATES: "false"
```

| Parametro | Effetto |
|---|---|
| `stunServers` | JVB usa questo server per scoprire il proprio IP pubblico |
| `JVB_ADVERTISE_PRIVATE_CANDIDATES: "false"` | Non annuncia gli IP di pod ai client (irraggiungibili) |

### Configurazione coturn (TURN/TURNS)

coturn è il relay per client che non possono raggiungere il JVB direttamente. È incluso come subchart:

```yaml
jitsi-meet:
  coturn:
    enabled: true
    service:
      type: LoadBalancer
    tls:
      enabled: true
      secretName: coturn-tls
    allowedPeerIPs: "10.0.0.0-10.255.255.255,192.168.0.0-192.168.255.255"
```

Il certificato TLS è necessario per TURNS (TURN over TLS su porta 443). Senza certificato valido, i client dietro firewall restrittivi non potranno connettersi.

Prosody annuncia automaticamente i servizi TURN ai client via XEP-0215:
- `stun:turn.tuodominio.com:3478` (UDP)
- `turn:turn.tuodominio.com:3478` (UDP + TCP)
- `turns:turn.tuodominio.com:443` (TLS su TCP)

### Configurazione client ICE (override)

Se la discovery XEP-0215 non funziona (dipende dalla versione di Jitsi e dalla configurazione Prosody), è possibile forzare la configurazione lato client:

```yaml
jitsi-meet:
  web:
    custom:
      configs:
        _custom_config_js: |
          config.p2p.stunServers = [
            { urls: 'stun:turn.tuodominio.com:3478' }
          ];
          config.p2p.useStunTurn = true;
          config.bridgeChannel = { preferSctp: false };
          config.useTurnUdp = true;
          config.p2p.iceTransportPolicy = 'all';
```

**Parametri importanti:**

| Parametro | Valore | Motivo |
|---|---|---|
| `bridgeChannel.preferSctp` | `false` | Usa WebSocket per il bridge channel. SCTP può causare un deadlock ICE che fa crashare la call quando un utente esce |
| `p2p.useStunTurn` | `true` | Usa i server STUN/TURN anche in modalità P2P (2 partecipanti) |
| `useTurnUdp` | `true` | Abilita TURN UDP come fallback per la connessione al JVB |
| `p2p.iceTransportPolicy` | `'all'` | Prova tutti i candidati ICE (host, srflx, relay) |

### Porte firewall

| Porta | Protocollo | Componente | Obbligatoria | Note |
|---|---|---|---|---|
| 443 | TCP | Ingress (NGINX) | Sì | HTTPS signaling + WebSocket |
| 443 | TCP | coturn LB | Raccomandata | TURNS per client dietro firewall |
| 3478 | UDP+TCP | coturn LB | Raccomandata | STUN/TURN standard |
| 10000 | UDP | JVB LB/NodePort | Raccomandata | Media RTP diretto (migliore latenza) |

> **Nota**: se **tutti** i partecipanti hanno solo la porta 443 aperta, la piattaforma funziona comunque tramite TURNS. La porta 10000 UDP migliora la latenza ma non è strettamente necessaria se coturn è configurato.

### Requisiti firewall per cloud

| Cloud | Configurazione |
|---|---|
| AKS | NSG del node pool `jvb`: inbound UDP 10000. NSG del nodo coturn: inbound TCP 443, UDP 3478 |
| GKE | Firewall rule per il node pool JVB e per il Service LoadBalancer coturn |
| EKS | Security Group del node group JVB. Security Group del Service LoadBalancer coturn |
| On-premise | Regola firewall/iptables per le porte sopra indicate |

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | No | Redis connection string (`redis://` / `rediss://`). Required only for multi-pod chat fan-out. With the in-cluster `redis` subchart the chart derives it at render time from `REDIS_PASSWORD`. |
| `REDIS_PASSWORD` | Cond. | Required when the `redis` subchart is enabled or when `REDIS_URL` is not set explicitly. |
| `APP_SECRET` | Yes | Secret for signing JWTs (admin sessions, Jitsi tokens) |
| `ADMIN_API_KEY` | Yes | Key for admin login |
| `PII_ENCRYPTION_KEY` | Yes | AES-256 key for PII encryption (64 hex chars) |
| `CRON_API_KEY` | Yes | API key for cron endpoints (reminders, cleanup) |
| `NEXT_PUBLIC_APP_URL` | Yes | Public base URL (e.g. `https://videocall.example.com`) |
| `NEXT_PUBLIC_JITSI_DOMAIN` | Yes | Jitsi Meet server domain (e.g. `jitsi.videocall.example.com`) |
| `JITSI_JWT_SECRET` | Yes | Shared secret for Jitsi JWT authentication |
| `JITSI_JWT_APP_ID` | Yes | App identifier used in JWT metadata / `jti` (default: `eventi_dtd`) |
| `JITSI_JWT_ISSUER` | Yes | JWT issuer (default: `eventi-dtd`) |
| `JITSI_JWT_AUDIENCE` | Yes | JWT audience (default: `jitsi`) |
| `JITSI_JWT_SUBJECT` | No | Jitsi tenant/domain for the `sub` claim. Defaults to `NEXT_PUBLIC_JITSI_DOMAIN` |
| `SMTP_HOST` | Yes | SMTP server host |
| `SMTP_PORT` | Yes | SMTP server port (default: 587) |
| `SMTP_SECURE` | No | Enable TLS (default: `true`) |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASSWORD` | No | SMTP password |
| `SMTP_FROM` | Yes | Sender email address |
| `SMTP_FROM_NAME` | No | Sender display name |
| `DEFAULT_DATA_RETENTION_DAYS` | No | GDPR data retention (default: 30) |
| `JVB_MAX_REPLICAS` | No | Max JVB replicas for auto-scaler (default: 4) |
| `RECORDING_STORAGE_TYPE` | No | Recording storage: `azure-blob`, `s3`, `gcs`, `minio`, `local` |
| `RECORDING_WEBHOOK_URL` | No | Webhook URL for Jibri finalize script notifications |
