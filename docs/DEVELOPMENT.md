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
git clone https://github.com/italia/eventi-dtd.git
cd eventi-dtd

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
eventi-dtd/
├── app/                          # Workspace npm "app"
│   ├── src/
│   │   ├── app/                  # Next.js App Router
│   │   │   ├── [locale]/         # Route group i18n (it, en)
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
│   │   │   ├── messages/
│   │   │   │   ├── it.json       # Traduzioni italiano
│   │   │   │   └── en.json       # Traduzioni inglese
│   │   │   ├── request.ts
│   │   │   └── config.ts
│   │   └── types/                # Interfacce TypeScript
│   ├── prisma/
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

# 4. Applica lo schema al database
npm run db:push --workspace=app

# 5. Seed dati di esempio
npm run db:seed --workspace=app

# 6. Avvia il dev server
npm run dev --workspace=app
```

Assicurati che le variabili d'ambiente per la connessione al database e a Jitsi siano configurate correttamente (vedi `.env.example` nel workspace `app`).

## Database

Il database è gestito tramite Prisma 6. Tutti i comandi vanno eseguiti specificando il workspace:

```bash
# Genera il client Prisma (dopo modifiche a schema.prisma)
npm run db:generate --workspace=app

# Push dello schema sul database (sviluppo, senza migration file)
npm run db:push --workspace=app

# Crea una migration (per cambi da committare)
npm run db:migrate --workspace=app

# Apri Prisma Studio (interfaccia web per esplorare i dati)
npm run db:studio --workspace=app

# Seed dati di esempio
npm run db:seed --workspace=app
```

**Attenzione:** `db:push` è pensato per lo sviluppo locale. Per ambienti di staging/produzione, usare sempre `db:migrate` che genera file di migration versionati.

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
| CSS custom | Non consentito. Usare classi utility di Bootstrap Italia |
| Stringhe UI | Mai hardcoded. Sempre tramite `next-intl` (file `i18n/messages/`) |
| Validazione | Schemi Zod per input API e form |
| Componenti server | Default. Client component (`'use client'`) solo quando necessario |

## CI/CD

La pipeline GitHub Actions (`.github/workflows/ci.yml`) esegue i seguenti step ad ogni push e pull request:

1. **Lint** — ESLint + TypeScript type check
2. **Unit test** — Vitest con coverage minima
3. **Security scan** — Audit dipendenze npm (`npm audit`)
4. **Docker build** — Build dell'immagine multi-stage di produzione
5. **Image scan** — Scansione vulnerabilità dell'immagine Docker (Trivy)

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

Se il database è stato resettato (`docker compose down -v`), riesegui migration e seed.

### Test email non ricevute

Le email in ambiente locale vengono catturate da Mailpit. Controlla l'interfaccia web:

```
http://localhost:8025
```

Se Mailpit non mostra email:
- Verifica che il servizio sia attivo: `docker compose ps mailpit`
- Verifica la configurazione SMTP nell'app (host: `mailpit`, porta: `1025`)
