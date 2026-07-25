# Guida allo sviluppo

## Prerequisiti

| Software | Versione minima | Verifica |
|---|---|---|
| Node.js | ≥ 20.x | `node --version` |
| npm | ≥ 10.x | `npm --version` |
| Docker | ≥ 24.x | `docker --version` |
| Docker Compose | ≥ 2.20 | `docker compose version` |
| Git | ≥ 2.40 | `git --version` |

## Quick start

```bash
# 1. Clona il repository
git clone https://github.com/italia/pa-webinar.git
cd pa-webinar

# 2. Avvia lo stack completo (build + start)
docker compose up --build -d

# 3. Esegui migrazione database e seed
docker compose --profile setup run --rm db-migrate

# 4. Apri nel browser
#    App:     http://localhost:3000
#    Mailpit: http://localhost:8025
#    Jitsi:   https://localhost:8443
```

L'admin panel è accessibile con l'API key configurata nella variabile d'ambiente `ADMIN_API_KEY` (valore di default per sviluppo: `dev_admin_key_2026`).

## Struttura del progetto

```
pa-webinar/
├── app/                          # Workspace npm "app"
│   ├── src/
│   │   ├── app/                  # Next.js App Router
│   │   │   ├── [locale]/         # Route group i18n (24 lingue UE, IT default)
│   │   │   │   ├── layout.tsx    # Layout radice con tema Bootstrap Italia
│   │   │   │   ├── page.tsx      # Landing / elenco eventi
│   │   │   │   ├── eventi/       # Pagine eventi pubbliche
│   │   │   │   └── admin/        # Pannello amministrazione
│   │   │   ├── api/              # API routes (REST)
│   │   │   └── middleware.ts     # Auth + locale detection
│   │   ├── components/
│   │   │   ├── layout/           # Header, Footer, Navigation
│   │   │   ├── events/           # Card, dettaglio, listing eventi
│   │   │   ├── jitsi/            # JitsiRoom, JitsiControls
│   │   │   ├── qa/               # Lista domande, form, upvote
│   │   │   ├── registration/     # Form registrazione, consenso GDPR
│   │   │   └── ui/               # Wrapper su design-react-kit
│   │   ├── lib/
│   │   │   ├── jitsi/            # Wrapper IFrame API, config, tipi
│   │   │   ├── auth/             # JWT, generazione link moderatore
│   │   │   ├── email/            # Template Nodemailer
│   │   │   ├── ical/             # Generazione allegati iCal
│   │   │   ├── db.ts             # Prisma client singleton
│   │   │   └── validation/       # Schemi Zod
│   │   ├── i18n/
│   │   │   ├── messages/         # 24 file JSON: it.json (default) + 23 lingue UE
│   │   │   ├── request.ts
│   │   │   └── config.ts
│   │   └── types/                # Interfacce TypeScript
│   ├── prisma/
│   │   ├── migrations/           # File SQL di migrazione (versionati)
│   │   └── schema.prisma         # Schema database
│   ├── public/
│   │   └── fonts/                # Font self-hosted (Titillium Web, Roboto Mono, Lora)
│   ├── package.json
│   ├── tsconfig.json
│   └── next.config.ts
├── infra/                        # Helm chart, configurazione AKS
├── .github/
│   └── workflows/
│       └── ci.yml                # Pipeline CI GitHub Actions
├── docker-compose.yml            # Stack completo (produzione locale)
├── docker-compose.dev.yml        # Override per sviluppo (hot reload)
├── Dockerfile                    # Build multi-stage produzione
├── package.json                  # Root monorepo (workspaces)
└── docs/                         # Documentazione
```

## Servizi locali

Tutti i servizi vengono avviati tramite Docker Compose:

| Servizio | URL | Porta | Protocollo | Descrizione |
|---|---|---|---|---|
| App (Next.js) | http://localhost:3000 | 3000 | HTTP | Portale eventi |
| PostgreSQL | — | 5432 | TCP | Database relazionale |
| Mailpit | http://localhost:8025 | 8025 | HTTP | Client email per test (cattura tutte le email) |
| Jitsi Web | https://localhost:8443 | 8443 | HTTPS | Interfaccia Jitsi Meet |
| Jitsi JVB | — | 10000 | UDP | Video Bridge (traffico media WebRTC) |
| Prosody | — | 5222 | TCP | Server XMPP (segnalazione Jitsi interna) |
| Jicofo | — | — | — | Focus component Jitsi (gestione conferenze) |
| Cron | — | — | — | Chiama periodicamente gli endpoint `/api/cron/*` (in Kubernetes lo fanno i CronJob) |

Opt-in con profilo: `--profile recorder` avvia il **recorder controller** in
modalità Docker (registrazione multi-traccia senza Kubernetes; monta il socket
Docker, quindi va abilitato consapevolmente).

## Parità con la produzione

La piattaforma è pensata per **Kubernetes** (il chart Helm è l'unità di
installazione supportata), ma lo stack Compose non è una demo ridotta: serve a
sviluppare e a far girare tutto su una **VM singola**. Questa tabella dice cosa
è attivo in locale e cosa no, per non inseguire bug che sono in realtà assenze.

| Capacità | In locale (Compose / VM singola) | In Kubernetes |
|---|---|---|
| Portale, registrazioni, sala live, Q&A, sondaggi, word cloud, reazioni, timer | ✅ | ✅ |
| Email (conferme, promemoria, iCal) | ✅ catturate da Mailpit; il servizio `cron` drena la coda `EmailOutbox` | ✅ CronJob |
| Promemoria e pulizia GDPR | ✅ via servizio `cron` | ✅ CronJob |
| Chat in tempo reale, mani alzate, piazza | ✅ con Redis, lo stesso pub/sub della produzione | ✅ Redis pub/sub multi-pod |
| Registrazione multi-traccia (recorder) | ✅ con `--profile recorder` (spawn via socket Docker) | ✅ Job per evento |
| Scale-to-zero dei JVB | ➖ non replicabile né utile: serve un autoscaler di cluster che spenga i nodi. In locale il bridge resta acceso | ✅ CronJob `jvb-scaler` + node pool |
| Pipeline AI post-evento (trascrizione, sottotitoli, doppiaggio) | ❌ richiede GPU e ~10 GB di modelli | ✅ node pool GPU |
| Scalabilità orizzontale, HPA, TLS automatico, segreti gestiti | ➖ una VM singola non scala orizzontalmente; TLS e segreti si gestiscono col reverse proxy e l'ambiente della VM | ✅ HPA, cert-manager, External Secrets |

Legenda: ✅ disponibile · ➖ non applicabile a una VM singola (è una capacità
del cluster, non una funzionalità mancante) · ❌ limite tecnico.

**Limiti invalicabili senza cluster/GPU** — da conoscere, non da aggirare:

- **Pipeline AI** (trascrizione WhisperX, diarizzazione pyannote, doppiaggio):
  richiede GPU CUDA e alcuni GB di modelli. Su CPU girerebbe in linea teorica,
  ma con tempi tali da non essere utilizzabile: resta una capacità del deploy
  con node pool GPU. In locale il resto della piattaforma funziona senza.
- **Scale-to-zero dei JVB**: ha senso solo dove si pagano nodi a consumo e un
  autoscaler può spegnerli. Su una VM il bridge è già lì.
- **Jibri (registrazione video classica)**: richiede moduli audio del kernel
  (loopback ALSA) e container privilegiati; sulla VM si usa il recorder
  multi-traccia (`--profile recorder`), che non ne ha bisogno.

> Se in locale un'email non arriva, la prima cosa da controllare è il servizio
> `cron` (`docker compose logs cron`): senza di lui le email vengono accodate e
> mai inviate, e la registrazione sembra riuscita a metà.

> Lo stack è stato verificato anche con **Podman** (`podman compose`): i
> servizi, la risoluzione dei nomi e gli healthcheck si comportano allo stesso
> modo.

## Ambiente di sviluppo

### Full stack (container)

Avvia tutti i servizi come container Docker con build di produzione:

```bash
# Build e avvio
docker compose up --build -d

# Verifica stato servizi
docker compose ps

# Logs di un servizio specifico
docker compose logs -f app
docker compose logs -f jitsi-web

# Stop
docker compose down

# Stop con rimozione volumi (reset database)
docker compose down -v
```

### Dev mode (hot reload)

Per sviluppo attivo con hot reload del codice Next.js, usa l'override file che monta `app/src` nel container:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Le modifiche ai file in `app/src/` vengono riflesse immediatamente senza rebuild del container.

### Next.js su host (alternativa)

Se preferisci eseguire Next.js direttamente sulla macchina host (per debugging avanzato, breakpoint, ecc.):

```bash
# 1. Avvia solo l'infrastruttura (DB, Jitsi, Mailpit)
docker compose up -d postgres prosody jicofo jvb jitsi-web mailpit

# 2. Installa dipendenze
npm install

# 3. Genera il client Prisma
npm run db:generate --workspace=app

# 4. Applica le migrazioni al database
npm run db:migrate:dev --workspace=app

# 5. Seed dati di esempio
npm run db:seed --workspace=app

# 6. Avvia il dev server
npm run dev --workspace=app
```

Assicurati che le variabili d'ambiente per la connessione al database e a Jitsi siano configurate correttamente (vedi `.env.example` nella radice del repository).

## Database

Il database è gestito tramite Prisma 6 con **migrazioni formali**. Tutti i comandi vanno eseguiti specificando il workspace.

### Workflow migrazioni

```bash
# Applica tutte le migrazioni pendenti (produzione e CI)
npm run db:migrate --workspace=app

# Crea una nuova migrazione durante lo sviluppo
npm run db:migrate:dev --workspace=app

# Crea il file SQL senza applicarlo (per revisione manuale)
npm run db:migrate:create --workspace=app

# Verifica lo stato delle migrazioni
npm run db:migrate:status --workspace=app

# Reset completo del database (ATTENZIONE: distruttivo!)
npm run db:migrate:reset --workspace=app
```

### Workflow tipico per modifiche allo schema

1. Modifica `app/prisma/schema.prisma`
2. Genera la migrazione: `npm run db:migrate:dev --workspace=app`
3. Rivedi il file SQL generato in `app/prisma/migrations/`
4. Committa sia lo schema che la migrazione

### Ambienti

| Ambiente | Comando | Note |
|---|---|---|
| Sviluppo locale | `npm run db:migrate:dev` | Crea e applica migrazioni, genera il client |
| Docker Compose | `docker compose --profile setup run --rm db-migrate` | Esegue `prisma migrate deploy` + seed |
| Kubernetes | Automatico via initContainer `db-migrate` | Esegue `prisma migrate deploy` prima dell'avvio app |
| CI | `prisma migrate deploy` + `prisma migrate diff --exit-code` | Verifica integrità migrazioni |

> **Importante:** `db:push` bypassa le migrazioni ed è **distruttivo** su database con dati. Non usarlo su staging o produzione. Usare sempre `db:migrate` o `db:migrate:dev`.

### Altri comandi

```bash
# Genera il client Prisma (dopo modifiche a schema.prisma)
npm run db:generate --workspace=app

# Push rapido dello schema (solo prototipazione, nessun file migration)
npm run db:push --workspace=app

# Apri Prisma Studio (interfaccia web per esplorare i dati)
npm run db:studio --workspace=app

# Seed dati di esempio
npm run db:seed --workspace=app
```

## Test

### Unit test (Vitest)

```bash
# Esegui tutti i test unitari
npm run test --workspace=app

# Watch mode (riesegue al cambio file)
npm run test:watch --workspace=app

# Coverage report
npm run test:coverage --workspace=app
```

### E2E test (Playwright)

```bash
# Assicurati che lo stack sia in esecuzione
docker compose up -d

# Esegui i test E2E
npm run test:e2e --workspace=app

# Esegui con UI mode (debug interattivo)
npm run test:e2e:ui --workspace=app
```

I test E2E richiedono lo stack completo in esecuzione (app + database + Jitsi + Mailpit).

## Stile del codice

| Regola | Convenzione |
|---|---|
| TypeScript | `strict: true`, nessun `any` |
| Naming file | `kebab-case.ts` / `kebab-case.tsx` |
| Naming componenti | `PascalCase` (un componente per file) |
| Naming hook | `use-kebab-case.ts` → `export function useNomeHook` |
| Naming API routes | `route.ts` con export nominati (`GET`, `POST`, `PUT`, `DELETE`) |
| UI framework | Solo `design-react-kit` + `bootstrap-italia` |
| CSS custom | Solo in `app/src/styles/globals.scss` (override tematici centralizzati). Nei componenti usare le utility di Bootstrap Italia |
| Stringhe UI | Mai hardcoded. Sempre tramite `next-intl` (file `i18n/messages/`) |
| Validazione | Schemi Zod per input API e form |
| Componenti server | Default. Client component (`'use client'`) solo quando necessario |

## CI/CD

La pipeline GitHub Actions (`.github/workflows/ci.yml`) esegue i seguenti step ad ogni push e pull request:

1. **Lint** — ESLint + TypeScript type check
2. **Unit test** — Vitest con coverage minima
3. **Migration check** — Applica le migrazioni su un DB vuoto e verifica che lo schema Prisma sia sincronizzato con i file di migrazione
4. **Security scan** — Audit dipendenze npm (`npm audit`)
5. **Docker build** — Build dell'immagine multi-stage di produzione
6. **Image scan** — Scansione vulnerabilità dell'immagine Docker (Trivy)

La pipeline blocca il merge se uno qualsiasi degli step fallisce.

## Troubleshooting

### Certificato self-signed di Jitsi

Jitsi locale utilizza un certificato autofirmato. Il browser mostrerà un avviso di sicurezza su `https://localhost:8443`.

**Soluzione:** accetta manualmente il certificato nel browser visitando `https://localhost:8443` prima di testare l'integrazione iframe nell'app.

### Conflitti di porta

Se una porta è già in uso:

```bash
# Identifica il processo sulla porta
lsof -i :3000
# oppure
ss -tlnp | grep 3000
```

Modifica le porte nel `docker-compose.yml` se necessario.

### Errori di chunk loading (Next.js)

Se nel browser compaiono errori `ChunkLoadError` dopo un rebuild:

**Soluzione:** svuota la cache del browser (hard refresh: `Ctrl+Shift+R`) oppure cancella `.next/`:

```bash
rm -rf app/.next
npm run dev --workspace=app
```

### Font non caricati

I font (Titillium Web, Roboto Mono, Lora) sono self-hosted in `app/public/fonts/`. Se non vengono caricati:

- Verifica che i file siano presenti nella directory
- Verifica la configurazione del `FontLoader` component
- Controlla la console del browser per errori 404 sui font

### Connessione al database fallita

```bash
# Verifica che PostgreSQL sia in esecuzione
docker compose ps postgres

# Verifica i log
docker compose logs postgres

# Testa la connessione
docker compose exec postgres pg_isready
```

Se il database è stato resettato (`docker compose down -v`), riesegui le migrazioni:

```bash
docker compose --profile setup run --rm db-migrate
```

### Test email non ricevute

Le email in ambiente locale vengono catturate da Mailpit. Controlla l'interfaccia web:

```
http://localhost:8025
```

Se Mailpit non mostra email:
- Verifica che il servizio sia attivo: `docker compose ps mailpit`
- Verifica la configurazione SMTP nell'app (host: `mailpit`, porta: `1025`)
