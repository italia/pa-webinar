# Configurazione

Questo documento è il riferimento per **sviluppatori** e **system administrator** che devono configurare **eventi-dtd** (portal Next.js, database PostgreSQL, stack Jitsi Meet, SMTP, storage Azure per le registrazioni).

## Variabili d'ambiente

Tutte le variabili sono dichiarate in `.env.example` nella root del progetto pubblicabile (`eventi-dtd/`). Per lo sviluppo locale con **Docker Compose**, molti valori sono anche preimpostati o referenziati in `docker-compose.yml` (in particolare per Jitsi e per il servizio `app`).

Copiare `.env.example` in `.env` e adattare i valori all'ambiente (sviluppo, staging, produzione). In **Kubernetes**, le variabili sensibili vanno fornite tramite **Secrets** (ad es. Sealed Secrets, External Secrets) e mappate come `env` / `envFrom` nel Deployment dell'applicazione.

### Database

| Variabile | Obbligatoria | Descrizione | Esempio |
|-----------|--------------|-------------|---------|
| `DATABASE_URL` | Sì | **Connection string** PostgreSQL nel formato supportato da Prisma (`postgresql://…`). Deve puntare a un'istanza raggiungibile dal processo Next.js (host, porta, database, utente, password). | `postgresql://eventi:secret@localhost:5432/eventi_dtd` |

In **Docker Compose**, l'app usa l'hostname del servizio `postgres` (es. `postgres:5432`), mentre sul host in esecuzione locale senza container si usa in genere `localhost:5432`.

### Jitsi

| Variabile | Obbligatoria | Descrizione | Esempio |
|-----------|--------------|-------------|---------|
| `JITSI_JWT_SECRET` | Sì | **Shared secret** per la firma dei JWT verso Jitsi. Deve coincidere con `JWT_APP_SECRET` (o equivalente) nella configurazione **Prosody** / **Jitsi Web** del proprio deployment. | Valore generato (vedi [Generazione chiavi](#generazione-chiavi)) |
| `JITSI_JWT_APP_ID` | Sì | Identificatore dell'applicazione JWT (`app_id` / `JWT_APP_ID` lato Jitsi). | `eventi_dtd` |
| `JITSI_JWT_ISSUER` | Sì | Claim **`iss`** (issuer) incluso nel JWT emesso dal portal. Deve essere tra gli issuer accettati da Jitsi (`JWT_ACCEPTED_ISSUERS` / `acceptedIssuers`). | `eventi-dtd` |
| `JITSI_JWT_AUDIENCE` | Sì | Claim **`aud`** (audience). Deve essere tra le audience accettate da Jitsi (`JWT_ACCEPTED_AUDIENCES` / `acceptedAudiences`). | `jitsi` |
| `NEXT_PUBLIC_JITSI_DOMAIN` | Sì | **Hostname e porta** (se necessaria) dell'istanza **Jitsi Web** così come la vede il browser, senza schema URL. Usato per costruire l'URL dell'**IFrame API**. In locale con TLS self-signed su 8443 tipicamente `localhost:8443`; in produzione il dominio pubblico del reverse proxy. | `localhost:8443` oppure `jitsi.example.com` |

**Allineamento JWT tra portal e Jitsi:** se anche un solo parametro non combacia (secret, `app_id`, issuer o audience), Jitsi rifiuterà il token e l'utente non potrà entrare nella room. La sezione [Configurazione Jitsi JWT](#configurazione-jitsi-jwt) riassume la mappatura con i nomi usati nei container Jitsi e negli Helm values.

### Applicazione

| Variabile | Obbligatoria | Descrizione | Esempio |
|-----------|--------------|-------------|---------|
| `NEXT_PUBLIC_APP_URL` | Sì | **URL pubblico** base del portal (schema + host + eventuale porta). Usato per link nelle email, redirect e risorse esposte al client. Deve riflettere l'URL reale visto dagli utenti (HTTPS in produzione). | `https://eventi.example.gov.it` |
| `APP_SECRET` | Sì | Secret per firmare **JWT interni** (es. token moderatore, sessioni amministrative). Deve essere lungo, casuale e non versionato in chiaro. | Valore generato (vedi [Generazione chiavi](#generazione-chiavi)) |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | Sì | **Locale** predefinita dell'interfaccia (`it` o `en`). Il prefisso di route e next-intl dipendono dalla configurazione dell'app. | `it` |
| `ADMIN_API_KEY` | Sì | **API key** o token statico per accedere al pannello amministrativo (creazione/gestione eventi secondo le regole implementate nell'applicazione). Trattarla come credenziale segreta. | Valore generato (vedi [Generazione chiavi](#generazione-chiavi)) |

Le variabili con prefisso `NEXT_PUBLIC_` sono incorporate nel **client bundle** Next.js: non devono contenere segreti.

### Email (SMTP)

| Variabile | Obbligatoria | Descrizione | Esempio |
|-----------|--------------|-------------|---------|
| `SMTP_HOST` | Sì | Hostname del server **SMTP**. | `smtp.example.com` oppure `mailpit` (Compose) |
| `SMTP_PORT` | Sì | Porta TCP del server (spesso `587` STARTTLS, `465` implicit TLS, o `1025` per Mailpit in dev). | `587` |
| `SMTP_SECURE` | Sì | Se `true`, Nodemailer usa TLS implicito sulla connessione (tipico porta 465). Se `false`, si usa in genere STARTTLS sulla porta 587 secondo la logica dell'app. Valori tipici: stringa `"true"` / `"false"` come da `.env.example`. | `false` |
| `SMTP_USER` | Dipende dall'SMTP | Utente per **SMTP AUTH**, se richiesto dal provider. Può essere vuoto in ambienti di test senza autenticazione. | `user@example.com` |
| `SMTP_PASSWORD` | Dipende dall'SMTP | Password o secret per SMTP AUTH. | *(segreto)* |
| `SMTP_FROM` | Sì | Indirizzo **From** (RFC 5322) per le email transazionali. | `eventi@dominio.gov.it` |
| `SMTP_FROM_NAME` | Consigliata | Nome visualizzato del mittente. | `Eventi DTD` |

### GDPR e privacy

| Variabile | Obbligatoria | Descrizione | Esempio |
|-----------|--------------|-------------|---------|
| `PII_ENCRYPTION_KEY` | Sì | Chiave per **cifratura AES-256-GCM** dei dati personali a riposo (PII). Formato: **32 byte** rappresentati come stringa **esadecimale** (64 caratteri hex). Non usare la chiave di esempio in produzione. | Vedi sotto |
| `DEFAULT_PRIVACY_POLICY_URL` | Sì | **URL** della privacy policy mostrato nel flusso di registrazione (link obbligatorio prima del consenso). | `https://eventi.dominio.gov.it/it/privacy` |
| `DEFAULT_DATA_RETENTION_DAYS` | Sì | Giorni di conservazione dei **PII** dopo la fine dell'evento (cleanup automatico secondo le policy implementate). | `30` |

**Formato di `PII_ENCRYPTION_KEY`:** esattamente **64 caratteri** nell'insieme `[0-9a-f]` (minuscolo consigliato per coerenza); corrisponde a 256 bit di materiale di chiave. La chiave è un segreto crittografico: ruotarla richiede una strategia di re-encrypt o migrazione dati pianificata a livello applicativo.

**Generazione:** vedere [PII_ENCRYPTION_KEY](#pii_encryption_key).

### Azure Blob Storage

| Variabile | Obbligatoria | Descrizione | Esempio |
|-----------|--------------|-------------|---------|
| `AZURE_STORAGE_CONNECTION_STRING` | Per upload registrazioni | **Connection string** dell'account Azure Storage usato per salvare i file di registrazione (Jibri / pipeline di export verso blob). Opzionale se la funzionalità non è abilitata o non deployata. | *(fornita dal portale Azure)* |
| `AZURE_STORAGE_CONTAINER` | Con Azure attivo | Nome del **container** blob (es. `recordings`). | `recordings` |

### Cron

| Variabile | Obbligatoria | Descrizione | Esempio |
|-----------|--------------|-------------|---------|
| `CRON_API_KEY` | Sì | **API key** per chiamare in modo autenticato gli endpoint HTTP dedicati ai job schedulati (promemoria email, pulizia dati, ecc.). Deve essere inviata secondo il meccanismo previsto dall'implementazione (header o query, come da codice/API). | Valore casuale lungo |

### Docker (solo ambiente container locale)

| Variabile | Obbligatoria | Descrizione | Esempio |
|-----------|--------------|-------------|---------|
| `DOCKER_HOST_ADDRESS` | Consigliata per JVB | Indirizzo IP raggiungibile dal container **JVB** verso l'host (NAT / ICE). In Docker Desktop è spesso `host.docker.internal`; su Linux può essere necessario impostare l'IP della rete bridge o del gateway. Usata da `docker-compose.yml` per `JVB`. | `host.docker.internal` o IP dell'host |

---

## Configurazione Docker Compose

Il file `docker-compose.yml` nella root del progetto definisce lo **stack completo** locale: portal, PostgreSQL, componenti Jitsi, Mailpit.

### Servizi

| Servizio | Immagine / build | Porte (host) | Descrizione |
|----------|------------------|--------------|-------------|
| `app` | Build da `Dockerfile` (context `.`) | `3000` → `3000` | Applicazione **Next.js** (portal). Healthcheck su `/api/health`. |
| `db-migrate` | Build `Dockerfile`, target `builder` | — | Job **one-shot**: `prisma db push` e seed. Profilo `setup`. |
| `postgres` | `postgres:16-alpine` | `5432` → `5432` | **PostgreSQL** con volume persistente. |
| `jitsi-web` | `jitsi/web:stable` | `8443` → `443` | **Jitsi Web** con TLS (certificato self-signed in tipica installazione locale). |
| `prosody` | `jitsi/prosody:stable` | Nessuna esposta | Server **XMPP**; autenticazione JWT. |
| `jicofo` | `jitsi/jicofo:stable` | Nessuna esposta | **Jitsi Conference Focus** (orchestrazione conference). |
| `jvb` | `jitsi/jvb:stable` | `10000/udp` | **Jitsi Videobridge** (media RTP/SRTP). |
| `mailpit` | `axllent/mailpit:latest` | `1025` (SMTP), `8025` (UI web) | **Mailpit**: cattura email in sviluppo; UI su porta 8025. |

### Volumi

| Volume | Scopo |
|--------|--------|
| `postgres_data` | Persistenza dati PostgreSQL (`/var/lib/postgresql/data`). |
| `jitsi_web_config` | Configurazione e stato **Jitsi Web**. |
| `jitsi_web_crontabs` | Crontab lato container web. |
| `jitsi_transcripts` | Directory transcripts (se usata). |
| `jitsi_prosody_config` | Configurazione **Prosody**. |
| `jitsi_prosody_plugins` | Plugin Prosody custom. |
| `jitsi_jicofo_config` | Configurazione **Jicofo**. |
| `jitsi_jvb_config` | Configurazione **JVB**. |

### Profili

Il servizio **`db-migrate`** è associato al profilo Compose **`setup`**: non parte con un semplice `docker compose up` senza profilo, così le migrazioni/seed restano un'operazione esplicita.

Esempio (dalla root del repo pubblicabile):

```bash
docker compose --profile setup run --rm db-migrate
```

Questo esegue push dello schema Prisma e lo script di seed sul database già healthy.

---

## Configurazione Jitsi JWT

Il portal emette **JWT** firmati con `JITSI_JWT_SECRET` e li passa a Jitsi tramite l'**IFrame API**. Jitsi (Prosody / configurazione `jwt`) valida firma, `app_id`, issuer e audience.

### Variabili lato Jitsi (riferimento)

Nei deployment ufficiali Jitsi via Docker si usano tipicamente:

- `JWT_APP_ID` — deve uguagliare `JITSI_JWT_APP_ID` del portal.
- `JWT_APP_SECRET` — deve uguagliare `JITSI_JWT_SECRET`.
- `JWT_ACCEPTED_ISSUERS` — elenco (spesso separato da virgole) che deve includere `JITSI_JWT_ISSUER`.
- `JWT_ACCEPTED_AUDIENCES` — elenco che deve includere `JITSI_JWT_AUDIENCE`.

In **Helm** (chart community `jitsi-meet`), i corrispondenti valori compaiono sotto `prosody.auth.jwt` (es. `appId`, `appSecret`, `acceptedIssuers`, `acceptedAudiences`) nel file `infra/helm/jitsi/values-jitsi.yaml`.

### Mappatura portal → Jitsi

| Variabile portal | Ruolo nel JWT / uso | Impostazione Jitsi tipica |
|------------------|---------------------|---------------------------|
| `JITSI_JWT_APP_ID` | Claim JWT **`sub`** (subject), impostato nel codice del portal | `JWT_APP_ID` / `appId` |
| `JITSI_JWT_SECRET` | Firma HMAC (o algoritmo configurato) | `JWT_APP_SECRET` / `appSecret` |
| `JITSI_JWT_ISSUER` | Claim `iss` | `JWT_ACCEPTED_ISSUERS` / `acceptedIssuers` |
| `JITSI_JWT_AUDIENCE` | Claim `aud` | `JWT_ACCEPTED_AUDIENCES` / `acceptedAudiences` |
| `NEXT_PUBLIC_JITSI_DOMAIN` | Non è nel JWT; definisce dove il browser carica Jitsi | `PUBLIC_URL` / `publicURL` coerenti con TLS e DNS |

```mermaid
flowchart LR
  subgraph portal["Portal Next.js"]
    E["Env: JITSI_JWT_*"]
    API["API emissione JWT"]
    E --> API
  end
  subgraph browser["Browser"]
    IF["IFrame API\nNEXT_PUBLIC_JITSI_DOMAIN"]
  end
  subgraph jitsi["Jitsi Meet"]
    W["jitsi-web"]
    P["prosody"]
    W --> P
  end
  API --> IF
  IF --> W
```

---

## Configurazione Kubernetes

In produzione su **AKS** (o altro cluster) il portal è in genere deployato con **Helm**. Nel repository sono presenti bozza/valori in `infra/helm/eventi-dtd/values.yaml` e per Jitsi in `infra/helm/jitsi/values-jitsi.yaml` (chart di riferimento: community **jitsi-helm**).

**Override tipici da pianificare:**

- **`image.repository`** / **`image.tag`** — registry container (es. Azure Container Registry) e versione immagine dell'app.
- **`ingress.hosts`** (e TLS) — hostname pubblico del portal e secret certificato (es. **cert-manager** + Let's Encrypt).
- **`postgresql.*`** — spesso disabilitato nel chart app se si usa **Azure Database for PostgreSQL Flexible Server**; in ogni caso `DATABASE_URL` va nel Secret del workload.
- **Segreti Jitsi / portal** — allineare `JITSI_JWT_*` del Deployment del portal con `prosody.auth.jwt` (o equivalente) del release Jitsi.
- **`jvb`** — replica count, **nodeSelector** / **tolerations** per pool dedicato (es. scale-to-zero dei JVB), risorse CPU/RAM.

Per job schedulati sul cluster, vedere anche `infra/aks/cronjobs.yaml` (autenticazione verso gli endpoint cron con `CRON_API_KEY` coerente con il Secret dell'app).

---

## Generazione chiavi

Usare valori casuali crittograficamente sicuri. Esempi con **OpenSSL**:

### `PII_ENCRYPTION_KEY`

```bash
openssl rand -hex 32
```

Output: 64 caratteri esadecimali. Impostare in `.env` senza spazi o virgolette non necessarie (se il parser lo consente, seguire lo stile di `.env.example`).

### `APP_SECRET`

```bash
openssl rand -base64 32
```

### `ADMIN_API_KEY`

```bash
openssl rand -base64 24
```

### `JITSI_JWT_SECRET`

```bash
openssl rand -hex 32
```

**Nota:** il formato di `JITSI_JWT_SECRET` deve essere accettato dalla configurazione Jitsi in uso (le immagini Docker ufficiali si aspettano tipicamente una stringa secret compatibile con la documentazione Jitsi per JWT). Dopo la rotazione, aggiornare **sia** il portal **sia** Prosody/Web in modo sincrono per evitare interruzioni di accesso alle room.
