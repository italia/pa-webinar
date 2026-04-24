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
  (`npm run license:report` + `THIRD-PARTY-LICENSES.md`)
- **OpenSSF Scorecard**: analisi settimanale (`.github/workflows/scorecard.yml`)
  pubblicata su GitHub Security — badge in README
- **Secret detection**: pre-commit hooks con detect-secrets
- **Security policy**: SECURITY.md con processo di disclosure responsabile
- **Container sicuri**: non-root, read-only filesystem, seccomp, drop ALL capabilities

## Qualità del codice

- **TypeScript strict mode**: nessun `any`, tutte le API tipizzate. Il check
  `tsc --noEmit` è un gate CI bloccante (`npx tsc --noEmit --project app/tsconfig.json`).
- **568 test unitari** (Vitest, 27 file di test), soglia copertura 70%.
  `npm run test --workspace=app` in locale replica esattamente la pipeline CI.
- **Lint bloccante**: ESLint + Prettier (`npm run lint --workspace=app`) su ogni PR;
  nessuna warning tollerata su codice modificato.
- **Error handling centralizzato**: tutte le API route passano per
  `withErrorHandling` (`app/src/lib/api-handler.ts`) con gestione errori consistente
  e mappatura `AppError → HTTP status`.
- **Migrazioni formali**: Prisma migrate (no `db push` in produzione). La CI verifica
  che lo schema sia sincronizzato con le migrazioni via `prisma migrate diff --exit-code`.
- **SBOM CycloneDX 1.6**: artefatto per-tenant generato in `/service-inventory`
  (code DEV: npm + OCI digest; ops OPS: servizi cloud). Vedi `docs/SERVICE-INVENTORY-GENERATION.md`.

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
