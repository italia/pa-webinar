# Standard di qualità — eventi-dtd

Questo progetto segue gli standard di qualità ispirati al programma badge di
[OpenCoDE](https://opencode.de/en/knowledge/software-index/badges-en) e
[OpenSSF Scorecard](https://scorecard.dev/).

## Manutenzione attiva

- **Commit regolari**: almeno 5 commit negli ultimi 6 mesi
- **Risposta alle issue**: tempo medio di risposta < 7 giorni
- **CI/CD**: pipeline automatizzata per ogni PR e merge su main
- **Release regolari**: versioning semantico (semver)

## Sicurezza

- **Scansione dipendenze**: Trivy su ogni build e immagine Docker
- **Scansione licenze**: verifica automatica compatibilità EUPL-1.2
- **OpenSSF Scorecard**: analisi settimanale pubblicata su GitHub Security
- **Secret detection**: pre-commit hooks con detect-secrets
- **Security policy**: SECURITY.md con processo di disclosure responsabile
- **Container sicuri**: non-root, read-only filesystem, seccomp, drop ALL capabilities

## Qualità del codice

- **TypeScript strict mode**: nessun `any`, tutte le API tipizzate
- **205 test unitari**: Vitest con soglia copertura 70%
- **Error handling centralizzato**: tutte le API route con gestione errori consistente
- **Linting**: ESLint + Prettier su ogni PR
- **Migrazioni formali**: Prisma migrate (no db push in produzione)

## Riuso

- **publiccode.yml**: conforme allo standard per il catalogo Developers Italia
- **Licenza EUPL-1.2**: compatibile con MIT, Apache-2.0, BSD, MPL-2.0
- **THIRD-PARTY-LICENSES.md**: audit completo di tutte le dipendenze
- **3 modalità di deploy**: semplice, standard, completa — cloud-agnostic
- **Documentazione bilingue**: italiano + inglese
- **Nessun vendor lock-in**: funziona su AKS, GKE, EKS, k3s

## Come contribuire al mantenimento di questi standard

Ogni PR deve:
1. Passare la CI (lint, typecheck, test, security scan)
2. Non introdurre dipendenze con licenze incompatibili
3. Includere test per la nuova logica
4. Aggiornare la documentazione se necessario
5. Non contenere segreti o dati personali (pre-commit check)
