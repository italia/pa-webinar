# Configuration

## Branding

### Video watermark

The DTD watermark is displayed in the bottom-left corner of the Jitsi video area. To customise it:

- **Replace the static file**: swap `app/public/images/dtd-watermark.svg` with your own logo (SVG or PNG, ~120×40px recommended, white or light colour).
- **Use an environment variable**: set `NEXT_PUBLIC_WATERMARK_URL` to an absolute URL or public path. When set, this overrides the static file.

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

Edit `app/public/jitsi-branding.json` to set Jitsi's built-in branding:

```json
{
  "backgroundColor": "#002855",
  "backgroundImageUrl": "",
  "logoClickUrl": "",
  "logoImageUrl": "/images/dtd-watermark.svg",
  "inviteDomain": "eventi.dominio.gov.it"
}
```

The `dynamicBrandingUrl` in `lib/jitsi/config.ts` points to this file. In production (same-origin via Ingress), Jitsi can fetch it directly. In local dev with cross-origin Jitsi, the fetch may fail silently — this is expected.

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

## Secrets management

Tre modalita disponibili (configurabili in `secrets.mode`):

| Modalita | Uso | Note |
|---|---|---|
| `existing` | Produzione | Secret creato manualmente o da pipeline CI/CD |
| `external` | Produzione | External Secrets Operator (Azure KV, AWS SM, GCP SM) |
| `generate` | Solo dev/test | Il chart genera il Secret dai valori — MAI in produzione |

Vedi `values.yaml` sezione `secrets` per la configurazione dettagliata.

## Rete Jitsi

JVB richiede la porta **UDP 10000** aperta verso Internet sui nodi del pool dedicato:

| Cloud | Configurazione |
|---|---|
| AKS | Network Security Group del node pool `jvb` |
| GKE | Firewall rule per il node pool |
| EKS | Security Group del node group |
| On-premise | Regola firewall/iptables |

JVB usa STUN per la connettivita NAT e deve raggiungere `stun.l.google.com:19302`.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `APP_SECRET` | Yes | Secret for signing JWTs (admin sessions, Jitsi tokens) |
| `ADMIN_API_KEY` | Yes | Key for admin login |
| `PII_ENCRYPTION_KEY` | Yes | AES-256 key for PII encryption (64 hex chars) |
| `CRON_API_KEY` | Yes | API key for cron endpoints (reminders, cleanup) |
| `NEXT_PUBLIC_APP_URL` | Yes | Public base URL (e.g. `https://videocall.example.com`) |
| `NEXT_PUBLIC_JITSI_DOMAIN` | Yes | Jitsi Meet server domain (e.g. `jitsi.videocall.example.com`) |
| `JITSI_JWT_SECRET` | Yes | Shared secret for Jitsi JWT authentication |
| `JITSI_JWT_APP_ID` | Yes | App ID for Jitsi JWT (default: `eventi_dtd`) |
| `JITSI_JWT_ISSUER` | Yes | JWT issuer (default: `eventi-dtd`) |
| `JITSI_JWT_AUDIENCE` | Yes | JWT audience (default: `jitsi`) |
| `SMTP_HOST` | Yes | SMTP server host |
| `SMTP_PORT` | Yes | SMTP server port (default: 587) |
| `SMTP_SECURE` | No | Enable TLS (default: `true`) |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASSWORD` | No | SMTP password |
| `SMTP_FROM` | Yes | Sender email address |
| `SMTP_FROM_NAME` | No | Sender display name |
| `DEFAULT_DATA_RETENTION_DAYS` | No | GDPR data retention (default: 30) |
| `JVB_MAX_REPLICAS` | No | Max JVB replicas for auto-scaler (default: 4) |
| `NEXT_PUBLIC_WATERMARK_URL` | No | Custom watermark image URL (overrides static file) |
