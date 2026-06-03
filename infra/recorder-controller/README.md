# recorder-controller (ADR-013, Fase 3)

Operator riconciliante che orchestra i **Job recorder** multi-traccia. Pod
fisso (Deployment 1 replica) con RBAC namespaced minimale. Vedi il design in
[`docs/adr/013-multitrack-speaker-attribution.md`](../../docs/adr/013-multitrack-speaker-attribution.md)
(sezione "Fase 3 — Orchestrazione del recorder").

## Modello

- **level-triggered** (spina dorsale): ogni `RECONCILE_INTERVAL_MS` interroga
  `GET /api/internal/recorder-desired` e diffonde verso i Job reali nel
  namespace → crea i mancanti, deduplica i concorrenti. Self-healing.
- **edge-triggered** (latenza): `POST /dispatch` (chiamato best-effort dal
  portale appena rileva un evento LIVE) forza un reconcile immediato.

La logica decisionale è in [`src/reconcile.ts`](src/reconcile.ts) — **pura e
unit-testata** (`reconcile.test.ts`). Il resto è I/O sottile:
- [`src/k8s.ts`](src/k8s.ts): lista/crea/elimina Job via `@kubernetes/client-node`
  (solo API standard → portabile AKS/GKE/EKS/k3s). Crea il Job dal template
  CronJob sospeso `recorder`, iniettando `RECORDING_ID`/`EVENT_ID`.
- [`src/portal.ts`](src/portal.ts): client HTTP (`x-api-key`).
- [`src/index.ts`](src/index.ts): loop + HTTP server, reconcile serializzato.

L'operator **non tocca credenziali**: passa solo gli id come env. JWT bot,
riga Recording e presign upload li conia il portale al `recorder-claim`
(lato recorder), così una compromissione dell'operator non espone segreti.

## Env

| Variabile | Obbl. | Default | Descrizione |
|-----------|:---:|---------|-------------|
| `NAMESPACE` | ✅ | — | Namespace dei Job recorder. |
| `PORTAL_URL` | ✅ | — | Base URL interna del portale (`internalUrl`). |
| `CRON_API_KEY` | ✅ | — | Header `x-api-key` verso il portale. |
| `RECORDER_CRONJOB_NAME` | ✅ | — | CronJob sospeso usato come template del Job. |
| `RECONCILE_INTERVAL_MS` | — | `30000` | Cadenza del loop level-triggered. |
| `PORT` | — | `8080` | Porta HTTP (`/dispatch`, `/healthz`). |

## RBAC necessario (namespaced)

`batch/jobs`: get,list,create,delete · `batch/cronjobs`: get,list ·
`pods`,`pods/log`: get,list (osservabilità). Nessun permesso cluster-wide.

## Stato

Logica reconcile completa e testata; glue K8s/HTTP implementato ma **da
validare in-cluster** (non E2E-testabile in locale). Helm chart + endpoint
portale (`recorder-desired`/`recorder-claim`) + hook `jvb-desired-replicas`:
incrementi successivi. Default `recorder.enabled=false`.
