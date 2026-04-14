# eventi-dtd

[![CI](https://github.com/italia/eventi-dtd/actions/workflows/ci.yml/badge.svg)](https://github.com/italia/eventi-dtd/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/italia/eventi-dtd/badge)](https://scorecard.dev/viewer/?uri=github.com/italia/eventi-dtd)
[![License: EUPL-1.2](https://img.shields.io/badge/License-EUPL--1.2-blue.svg)](https://joinup.ec.europa.eu/collection/eupl/eupl-text-eupl-12)
[![publiccode.yml](https://img.shields.io/badge/publiccode-available-brightgreen.svg)](publiccode.yml)
[![Tests](https://img.shields.io/badge/tests-205%20passing-brightgreen.svg)](#test)

Piattaforma open-source per eventi pubblici digitali della Pubblica Amministrazione italiana, basata su [Jitsi Meet](https://jitsi.org/) e il [design system .italia](https://designers.italia.it/).

> **English**: Open-source platform for public digital events, built on Jitsi Meet and the Italian .italia design system. [Read more →](#cosè--what-is-this)

## Cos'è / What is this

**eventi-dtd** è una piattaforma web per organizzare eventi pubblici digitali — webinar, presentazioni, meeting pubblici. Sviluppata dal [Dipartimento per la Trasformazione Digitale](https://innovazione.gov.it/).

Architettura scalabile orizzontalmente su Kubernetes: capacità per singolo evento ~300 partecipanti con un bridge JVB standard (estendibile tramite bridge cascading); capacità totale della piattaforma limitata solo dalle risorse del cluster, con auto-scaling dei bridge JVB (scale-to-zero quando inattivo). Per numeri misurati sulla propria infrastruttura vedere [`docs/LOAD-TESTING.md`](docs/LOAD-TESTING.md).

Funzionalità principali:

- 🎥 Video conferenza con Jitsi Meet (scalabile orizzontalmente su Kubernetes)
- ❓ Q&A con sistema di upvote
- 📝 Registrazione partecipanti GDPR-compliant
- 🔴 Registrazione video con consenso esplicito
- 🔧 Moderazione avanzata
- 📧 Email con allegato iCal
- 🇮🇹🇬🇧 Interfaccia bilingue italiano/inglese
- 🎨 Design system .italia (Bootstrap Italia)
- ☁️ Cloud-native (Kubernetes, Helm)

## Screenshot

> Le screenshot verranno aggiunte con la prima release stabile.
> *Screenshots will be added with the first stable release.*

## Quick Start

```bash
# Clone
git clone https://github.com/italia/eventi-dtd.git
cd eventi-dtd

# Start full stack
docker compose up --build -d

# Seed database
docker compose --profile setup run --rm db-migrate

# Open
open http://localhost:3000/it
```

Servizi disponibili:

| Servizio | URL | Descrizione |
|---|---|---|
| App | http://localhost:3000 | Portale eventi |
| Mailpit | http://localhost:8025 | Email testing |
| Jitsi | https://localhost:8443 | Video engine |

## Come organizzare un evento

1. Accedi all'area amministratore su `/it/admin` con la chiave di accesso
2. Crea un nuovo evento compilando il form
3. Riceverai un **link moderatore** via email — è il tuo accesso per gestire l'evento
4. Condividi la pagina pubblica dell'evento con i partecipanti
5. Al momento dell'evento, accedi dal link moderatore per avviare e gestire la sessione

I partecipanti si registrano con nome e email, ricevono un link personale con allegato iCal, e accedono all'evento dal link senza necessità di account.

## Sviluppo / Development

Consulta [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) per la guida completa.

```bash
# Dev mode with hot reload
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

## Architettura / Architecture

Consulta [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) per i dettagli architetturali.

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript (strict) |
| UI | design-react-kit + Bootstrap Italia |
| Video | Jitsi Meet (IFrame API) |
| Database | PostgreSQL 16 + Prisma |
| i18n | next-intl |
| Container | Docker (multi-stage) |
| Orchestration | Kubernetes (AKS) + Helm |

## Riuso / Reuse

Questo software è conforme alle [Linee guida per il riuso](https://docs.italia.it/italia/developers-italia/lg-acquisizione-e-riuso-software-per-pa-docs/) ed è presente nel [catalogo di Developers Italia](https://developers.italia.it/).

- [publiccode.yml](publiccode.yml) — Metadati per il catalogo software PA
- Licenza: [EUPL-1.2](LICENSE)

## GDPR

Consulta [docs/GDPR.md](docs/GDPR.md) per i dettagli sulla conformità GDPR.

## Qualità e sicurezza

| Indicatore | Stato |
|---|---|
| CI/CD | [![CI](https://github.com/italia/eventi-dtd/actions/workflows/ci.yml/badge.svg)](https://github.com/italia/eventi-dtd/actions/workflows/ci.yml) |
| Security | [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/italia/eventi-dtd/badge)](https://scorecard.dev/viewer/?uri=github.com/italia/eventi-dtd) |
| Licenza | [![EUPL-1.2](https://img.shields.io/badge/License-EUPL--1.2-blue.svg)](https://joinup.ec.europa.eu/collection/eupl/eupl-text-eupl-12) |
| Test | 205 test unitari |
| Dipendenze | Audit EUPL-compatibile, SBOM per release |
| Container | Non-root, read-only, seccomp |
| GDPR | Encryption PII, consenso granulare, retention automatica |

Per dettagli sugli standard di qualità adottati, consulta [docs/CONTRIBUTING-QUALITY.md](docs/CONTRIBUTING-QUALITY.md).

## Licenza / License

Distribuito con licenza [European Union Public License 1.2](LICENSE).

© 2026 Dipartimento per la Trasformazione Digitale — Presidenza del Consiglio dei Ministri
