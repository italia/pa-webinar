# Piano di rename: `eventi-dtd` → **PA Webinar**

> Stato: **PIANIFICATO** — esecuzione gated su merge `dev → main`.
> Decisioni prese (2026-06-04):
> 1. Mappatura nomi: kebab `pa-webinar`, snake `pa_webinar`, display **PA Webinar**.
> 2. Repo GitHub + immagini GHCR: **rinominati** a `italia/pa-webinar`.
> 3. Infra viva (chart Helm, release, DB, namespace, JWT app id): **rinominata con migrazione** (downtime pianificato).

## Mappatura canonica dei nomi

| Contesto | Da | A |
|---|---|---|
| Brand / display | `Eventi DTD` | `PA Webinar` |
| Slug kebab (npm, chart, immagini, k8s, dir) | `eventi-dtd` | `pa-webinar` |
| Snake (DB name, `JITSI_JWT_APP_ID`) | `eventi_dtd` | `pa_webinar` |
| Compatto (eventuali `eventidtd`) | `eventidtd` | `pawebinar` |
| Org/repo GitHub | `italia/eventi-dtd` | `italia/pa-webinar` |
| Namespace GHCR | `ghcr.io/italia/eventi-dtd*` | `ghcr.io/italia/pa-webinar*` |
| npm packages | `eventi-dtd`, `@eventi-dtd/app`, `@eventi-dtd/multitrack-recorder`, `eventi-dtd-recorder-controller` | `pa-webinar`, `@pa-webinar/app`, `@pa-webinar/multitrack-recorder`, `pa-webinar-recorder-controller` |
| Helper Helm | `eventi-dtd.name/.fullname/.chart/.labels/...` | `pa-webinar.*` |

**Regola d'oro:** mai un singolo find-replace globale. Ogni forma ha il suo target. Eseguire i replace **per forma**, nell'ordine snake → kebab → display, per evitare collisioni (es. `eventi_dtd` dentro `eventi-dtd`).

## Ampiezza (ricognizione 2026-06-04)
- 123 file con `eventi-dtd`, 13 con `eventi_dtd`, 7 con `eventidtd`, 26 con `eventi dtd`.
- Aree principali: `infra/helm` (40), `app/src` (20), `scripts/load-test` (8), `infra/ai` (6), `.github/workflows` (4), `infra/recorder*` (7), docs vari.
- 40+ file dentro la directory `infra/helm/eventi-dtd/` → **directory da rinominare**.
- File con il nome nel path: `infra/grafana/eventi-dtd-dashboard.json`, tutto `infra/helm/eventi-dtd/`.
- Brand non centralizzato: "Eventi DTD" ripetuto in ogni `app/src/i18n/messages/*.json` (≈3×24).

---

## Fase 0 — Prerequisiti (prima di toccare qualsiasi cosa)
- [ ] `dev → main` mergiato e CI verde (gate esplicito dell'utente).
- [ ] Tag/release dell'ultima versione `eventi-dtd` (es. `v0.3.x`) come punto di rollback.
- [ ] Freeze dei merge su `main`/`dev` durante l'esecuzione (annuncio al team).
- [ ] Branch dedicato `chore/rename-pa-webinar` da `main`.
- [ ] Backup DB di `videocall-test` (e prod) prima della migrazione.
- [ ] Finestra di downtime concordata per la migrazione cluster.

## Fase 1 — Repo GitHub + GHCR (operazione "umana", fuori dal codice)
> Da fare per primo perché i path immagine nel codice devono puntare al nuovo namespace.
- [ ] Rinominare il repo su GitHub: `italia/eventi-dtd` → `italia/pa-webinar` (Settings → Rename). GitHub crea redirect automatici da URL/clone vecchi.
- [ ] Aggiornare il remote locale: `git remote set-url origin git@github.com:italia/pa-webinar.git`.
- [ ] GHCR: i package immagine (`eventi-dtd`, `eventi-dtd-postprod-worker`, `eventi-dtd-recorder`, `eventi-dtd-recorder-controller`) **non** si rinominano: si pubblicano nuovi package `pa-webinar*` al primo build post-rename. Mantenere i vecchi finché i deploy non puntano ai nuovi (vedi Fase 5).
- [ ] Verificare permessi/visibility dei nuovi package GHCR (public + linkati al repo).
- [ ] Aggiornare eventuali secret/PAT che referenziano il vecchio path.

## Fase 2 — Rename contenuto del codice (per forma, ordine snake→kebab→display)
Eseguire su `chore/rename-pa-webinar`. Dopo ogni blocco: `tsc`, `lint`, `test`, `helm lint`, `npm run build`.

### 2a. snake_case `eventi_dtd` → `pa_webinar`
- [ ] `.env.example`: `DATABASE_URL` db `eventi_dtd`→`pa_webinar`; `JITSI_JWT_APP_ID`.
- [ ] Tutti i riferimenti a `eventi_dtd` (13 file) inclusi compose, helm values, docs.
- [ ] **Attenzione DB**: il cambio del nome DB è solo configurazione qui; la migrazione dati è in Fase 4.

### 2b. kebab `eventi-dtd` → `pa-webinar` (escludendo path immagine già su nuovo namespace)
- [ ] npm: `package.json` root + workspaces (`@eventi-dtd/app`, `@eventi-dtd/multitrack-recorder`, `eventi-dtd-recorder-controller`) → `pa-webinar`. Aggiornare `package-lock.json` con `npm install`.
- [ ] Import interni che usano lo scope `@eventi-dtd/*` (verificare con `git grep "@eventi-dtd"`).
- [ ] `JITSI_JWT_ISSUER` (`eventi-dtd`).
- [ ] `publiccode.yml`, README (it/en), docs, scripts, `.github/workflows`.
- [ ] Path immagine GHCR: `ghcr.io/italia/eventi-dtd*` → `ghcr.io/italia/pa-webinar*` (workflows + helm values).
- [ ] Grafana dashboard: contenuto + (Fase 3) nome file.

### 2c. compatto `eventidtd` → `pawebinar` (7 file) — verificare contesto caso per caso.

### 2d. display `Eventi DTD` → `PA Webinar` (26 file)
- [ ] `app/src/i18n/messages/*.json` (24 lingue) — sostituire le occorrenze di branding mantenendo le altre stringhe.
- [ ] `SMTP_FROM_NAME` in `.env.example` e `docker-compose.yml`.
- [ ] `app/public/tenants/videocall-test/service-inventory.json`.
- [ ] (Opzionale, consigliato follow-up) centralizzare il brand in una costante / `SiteSetting` per evitare ripetizioni future.

## Fase 3 — Chart Helm (directory + helper + render)
- [ ] `git mv infra/helm/eventi-dtd infra/helm/pa-webinar` (preserva history).
- [ ] `Chart.yaml`: `name: pa-webinar`.
- [ ] `_helpers.tpl`: rinominare tutte le `define "eventi-dtd.*"` → `"pa-webinar.*"`.
- [ ] Aggiornare **tutte** le `include "eventi-dtd.*"` nei template (≈40 file) → `"pa-webinar.*"`.
- [ ] `git mv infra/grafana/eventi-dtd-dashboard.json infra/grafana/pa-webinar-dashboard.json` + riferimenti (configmap grafana).
- [ ] `values-dev.yaml`, `values-prod.yaml`, `examples/values-*.yaml`: image repo, nomi, eventuali `fullnameOverride`.
- [ ] **Verifica:** `helm lint`, `helm template` diff vs render precedente — confermare che cambiano solo i nomi attesi.

## Fase 4 — Migrazione infra viva (RISCHIO ALTO — downtime)
> Il rename del chart/release cambia i nomi di tutte le risorse k8s (`<release>-pa-webinar-*`). Su Helm questo **non** è un upgrade in-place: è un nuovo release. Strategia consigliata: **install affiancato + cutover**, non `helm upgrade` sul nome cambiato.

### 4a. Database
- [ ] Snapshot/backup DB.
- [ ] Creare DB `pa_webinar` e ruolo, oppure `ALTER DATABASE eventi_dtd RENAME TO pa_webinar` (richiede nessuna connessione attiva → stop app).
- [ ] Aggiornare `DATABASE_URL` nei secret del cluster (test e prod).
- [ ] `JITSI_JWT_APP_ID`/`ISSUER`: aggiornare **in modo coordinato** secret Prosody/Jitsi e app — mismatch = join falliti. Valutare finestra in cui non ci sono eventi live.

### 4b. Release Helm (per ambiente: prima `videocall-test`, poi prod)
- [ ] Stop traffico / annuncio downtime.
- [ ] `helm install pa-webinar infra/helm/pa-webinar -n videocall-test -f values-dev.yaml` (nuovo release) **oppure** decisione: mantenere lo stesso `--release-name` e accettare il rename solo del chart. → Da confermare release name desiderato.
- [ ] Verificare nuove risorse up, poi spostare ingress/DNS sul nuovo service.
- [ ] `helm uninstall eventi-dtd` (vecchio release) dopo verifica.
- [ ] **Attenzione cluster condiviso prod/test** (pool jvb/jibri/aigpu unici): eseguire test→prod in sequenza, mai contemporaneamente; tenere i scaler sotto controllo durante la finestra.
- [ ] Controllare PVC/recordings: assicurarsi che i volumi persistenti non vengano ricreati vuoti (riusare PV esistenti o migrare dati).

## Fase 5 — CI/CD e pipeline dev-deploy
- [ ] `.github/workflows/*`: nomi immagine, tag, eventuali `ghcr.io/italia/eventi-dtd` → `pa-webinar`.
- [ ] Pipeline dev-deploy (dev branch → `:dev` su GHCR → `kubectl rollout restart` su `videocall-test`): aggiornare nome immagine e target release/deployment.
- [ ] OpenSSF Scorecard / badge → nuovo repo path.
- [ ] Init-container `db-migrate`: confermare che punti al nuovo DB.
- [ ] Primo build post-rename: verificare che i nuovi package GHCR `pa-webinar*` vengano pubblicati correttamente.

## Fase 6 — Verifica finale & cleanup
- [ ] `git grep -i "eventi.dtd"` → 0 risultati attesi (salvo CHANGELOG storico / ADR che documentano il vecchio nome: decidere se preservarli).
- [ ] `tsc`, `lint`, `test`, `npm run build`, `helm lint` tutti verdi.
- [ ] `license:report` rigenerato (nomi package cambiati).
- [ ] Smoke test su `videocall-test`: registrazione, join (JWT!), Q&A, recording/postprod, email (SMTP_FROM_NAME).
- [ ] Aggiornare `CLAUDE.md` (titolo, path, comandi `--workspace=app` se lo scope cambia) e memoria del progetto.
- [ ] Rimuovere vecchi package GHCR `eventi-dtd*` quando nessun deploy li referenzia.
- [ ] PR `chore/rename-pa-webinar` → `main`, poi riallineare `dev`.

## Punti aperti da confermare in esecuzione
1. **Release name Helm** desiderato (mantenere `videocall-test` o passare a `pa-webinar`-based?). La memoria indica deploy su namespace/release `videocall*`: probabilmente il *chart* si rinomina ma il *release name* resta `videocall-test`/prod → in tal caso la Fase 4b è molto meno invasiva (solo `helm upgrade` con chart rinominato, niente cutover). **Da chiarire prima della Fase 4.**
2. ADR/CHANGELOG: preservare il nome storico `eventi-dtd` per tracciabilità o rinominare anche lì?
3. Dominio pubblico (`eventi.dominio.gov.it` negli esempi) — solo placeholder, confermare che non vada cambiato.
