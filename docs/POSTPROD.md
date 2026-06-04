# Postprod AI pipeline — pa-webinar

Pipeline di post-produzione che trasforma le registrazioni Jibri in
trascrizioni, sintesi e traduzioni. Tutto gira **in-cluster** (vincolo
di sovranità del dato — nessuna chiamata ad API esterne).

Ultimo aggiornamento: 2026-05-27.

---

## Indice

- [Cosa fa](#cosa-fa)
- [Architettura](#architettura)
- [Modello dati](#modello-dati)
- [Storage layout](#storage-layout)
- [Componenti runtime](#componenti-runtime)
- [Configurazione (Helm / SiteSetting / env)](#configurazione)
- [Deploy on AKS Italy North](#deploy-on-aks-italy-north)
- [Flusso end-to-end](#flusso-end-to-end)
- [Admin UI](#admin-ui)
- [Public UI (player + transcript)](#public-ui)
- [GDPR + AI Act](#gdpr--ai-act)
- [Test e dev locale](#test-e-dev-locale)
- [Troubleshooting](#troubleshooting)
- [Cosa manca / follow-up](#cosa-manca--follow-up)

---

## Status page integration

La pipeline AI è esposta sulla status page pubblica (`/api/status` +
`/admin/status`) come servizio opzionale: appare nel diagramma
infrastruttura **solo** quando `SiteSetting.aiPipelineEnabled=true`.
Operatori che adottano il chart senza attivare la pipeline non vedono
mai il nodo. Endpoint dedicati:

- `GET /api/status/postprod` — JSON con queue stats, recordings per
  stato, ultimi successi/fallimenti, configurazione provider, conteggio
  eventi AI-enabled. Status macro: `disabled` | `idle` | `running` |
  `degraded` (≥1 FAILED nelle ultime 24h).
- `GET /api/status/infrastructure` — include il service node `postprod`
  (con porte, replicas, metadata) **se** la pipeline è abilitata.

Metriche Prometheus emesse da `prom-client`:

| Metric | Tipo | Label | Cosa |
|---|---|---|---|
| `eventi_postprod_pipeline_enabled` | Gauge | – | 0/1 (kill-switch globale) |
| `eventi_postprod_jobs_by_status` | Gauge | `status` | Counts per PENDING/CLAIMED/RUNNING/DONE/FAILED |
| `eventi_postprod_jobs_completed_total` | Counter | `kind`, `status` (DONE/FAILED) | Per SLO ratio |
| `eventi_postprod_job_duration_seconds` | Histogram | `kind` | Durata claim→terminal (buckets 5s-7200s) |
| `eventi_postprod_job_attempts_total` | Counter | `kind` | Claim attempts cumulativi |
| `eventi_postprod_artifacts_total` | Counter | `type`, `language` | Artifact prodotti |
| `eventi_postprod_artifact_bytes_total` | Counter | `type` | Bytes scritti su storage |

I gauge sono refreshati dal cron `postprod-reclaim` (1 min) chiamando
`refreshPostprodGauges()` — Prometheus vede valori freschi anche
durante periodi idle. Quando `aiPipelineEnabled=false`, tutti i gauge
vanno a 0 (graceful: niente scrape gap, status "off" leggibile).

## Modelli scelti

Scelta editoriale DTD: **niente artefatti pubblicati a bassa qualità**.
La pipeline gira su 1× A100 80GB con i seguenti modelli, tutti
**open-weights** scaricabili da HuggingFace e licenza
commercial-friendly:

| Stage | Modello | Licenza | VRAM | Perché |
|---|---|---|---|---|
| ASR | `Systran/faster-whisper-large-v3` (via WhisperX) | MIT | ~6GB | SOTA su italiano, robusto a VoIP audio Jibri (mono ~16-44kHz), allineamento word-level via wav2vec2 |
| Diarization | `pyannote/speaker-diarization-3.1` | MIT (codice) + TOS modello | ~2GB | Standard de-facto per separazione speaker, integrato direttamente da WhisperX |
| LLM (sintesi + traduzione) | `Qwen/Qwen3-32B-Instruct` | Apache 2.0 | ~64GB fp16 | Top-tier su IT/EN/FR (e altre lingue UE), tone control eccellente per registro formale PA, instruction-following affidabile con Pydantic-style output |

Modelli **valutati e scartati** per il default (rimangono opzioni
configurabili via `AI_VLLM_MODEL_ID`):

| Modello | Perché non default |
|---|---|
| Llama 3.3 70B | Migliore in alcuni benchmark ma non entra in 80GB fp16 (140GB) — servirebbe quantizzazione o 2× A100 |
| Mistral-Small-3.2 (24B) | Buon trade-off, ma Qwen3-32B vince su task IT formale nei nostri micro-benchmark interni |
| Qwen2.5-72B-AWQ | Quality leggermente superiore, ma latenza per call doppia → preferiamo Qwen3-32B fp16 |
| Gemma 2 27B | Apache 2.0 ok ma copertura IT più debole del Qwen |
| CosyVoice 2 / XTTS-v2 (voice clone) | Out of scope MVP (Art. 9 GDPR + AI Act Art. 50); licenze NC sui pesi pre-trained |

## Cosa fa

Quando un evento è configurato con `aiTranscriptEnabled=true` e Jibri
completa una registrazione, la pipeline produce:

| Artefatto | Tipo | Lingua | Note |
|---|---|---|---|
| Transcript raw | `TRANSCRIPT_JSON` | – | Output completo WhisperX + diarization pyannote |
| Sottotitoli sorgente | `TRANSCRIPT_VTT` | sorgente (default `it`) | WebVTT con `<v SPEAKER_00>` per speaker |
| Testo piatto | `TRANSCRIPT_TXT` | sorgente | Per export / ricerca |
| Sintesi "verbale PA" | `SUMMARY_MD` | sorgente | Markdown strutturato: argomenti, decisioni, action items |
| Sottotitoli tradotti | `TRANSLATION_VTT` | target (EN/FR/…) | Una per lingua configurata |
| Sintesi tradotta | `TRANSLATION_MD` | target | Una per lingua configurata |

**Out of scope** (rimandati a versioni successive):
- Voice cloning / dubbing (Art. 9 GDPR — richiede DPIA dedicata).
- Live captioning (richiede Jigasi + worker sempre on, vedi
  `docs/ROADMAP.md` v1.0.0).
- Editor trascrizione (`docs/ROADMAP.md` v0.6.0).

---

## Architettura

```
                ┌─────────────────────────────────────────────────────┐
                │  Jitsi cluster (esistente)                          │
                │   Jibri → finalize.sh (upload MP4 + webhook)        │
                └────────────────┬────────────────────────────────────┘
                                 │ HMAC POST
                                 ▼
                ┌─────────────────────────────────────────────────────┐
                │  Next.js app  (existing pod)                        │
                │   /api/webhooks/recording  → enqueue Postprod jobs  │
                │   /api/internal/postprod-{pending,claim,            │
                │                            progress,artifact}       │
                │   /api/cron/postprod-{reclaim,retention}            │
                │   /api/events/:slug/postprod/{subtitle,transcript}  │
                │   /admin/postprod        (dashboard)                │
                └──────┬─────────────────────────────────┬────────────┘
                       │                                 │
                       ▼                                 ▼
            ┌─────────────────────┐         ┌──────────────────────┐
            │  PostgreSQL          │         │  Object storage      │
            │   recordings         │         │   recordings/*.mp4   │
            │   postprod_jobs      │         │   postprod/<event>/  │
            │   postprod_artifacts │         │     <rec>/<run>/...  │
            │   speakers           │         └──────────────────────┘
            └─────────────────────┘
                       ▲
                       │
   ┌───────────────────┴──────────────────┐
   │  CronJob: postprod-orchestrator      │   every minute
   │   queries /postprod-pending          │
   │   creates k8s Jobs from worker tpl   │
   └─────────────────────┬────────────────┘
                         │ kubectl create job
                         ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  AI GPU nodepool (taint workload=ai-gpu)                     │
   │                                                              │
   │   Worker Job (one-shot, Python)                              │
   │     1. POST /postprod-claim     → ClaimResponse              │
   │     2. GET  presigned download  → /work/source.mp4           │
   │     3. WhisperX + pyannote      (TRANSCRIBE)  or             │
   │        OpenAI-compat /chat      → in-cluster vLLM Service    │
   │                                  (SUMMARIZE / TRANSLATE)     │
   │     4. PUT  presigned upload    × N artifacts                │
   │     5. POST /postprod-artifact  (register)                   │
   │     6. exit 0                                                │
   │                                                              │
   │   Co-located:                                                │
   │     - vLLM Service (Qwen3-32B by default)                    │
   │     - HF cache PVC mounted /models (offline mode)            │
   └──────────────────────────────────────────────────────────────┘
```

Nessuna API esterna. Nessun Argo Workflows / KEDA / Redis stream:
riusiamo il pattern Postgres-outbox di `EmailOutbox` e il pattern
"CronJob + API interna + kubectl" dello scaler JVB.

---

## Modello dati

Quattro nuove tabelle in `app/prisma/schema.prisma` + estensioni a
`Event` (feature flags), `Registration` (consensi AI) e `SiteSetting`
(provider routing, retention).

```
Recording  1───1  CallSession   (Recording è il "lifecycle postprod")
   │
   ├──┬─ PostprodJob  (TRANSCRIBE / SUMMARIZE / TRANSLATE / SUBTITLE)
   │  │     │
   │  │     └── depends_on (SUMMARIZE → TRANSCRIBE, TRANSLATE → …)
   │  │
   │  └─ PostprodArtifact  (TRANSCRIPT_VTT/JSON/TXT, SUMMARY_MD, TRANSLATION_*)
   │      uniqueness on (recordingId, type, language)
   │
   └── Speaker  (diarLabel → Person | free-text displayName)
                NB: voice embeddings NON salvati (Art. 9 GDPR)
```

Key invariants:

- **`PostprodJob.idempotencyKey`** è `sha256(recordingId|kind|runCount|canonical(payload))`.
  Garantisce che webhook re-deliveries o doppi enqueue non creano
  duplicati. Re-run manuali da `/admin/postprod` bumpano `Recording.runCount`,
  cambiando la key e producendo job distinti.
- **`PostprodArtifact` unique `(recordingId, type, language)`**: un
  re-run sovrascrive l'artefatto della stessa coppia mantenendo lo
  storico solo via `runCount` nel blob path.
- **`Recording.consentSnapshot`**: snapshot dei flag `Event.ai*Enabled`
  al momento dell'enqueue. Se un admin disabilita la feature dopo, gli
  artefatti già prodotti restano governati dallo snapshot fino a
  retention.

---

## Storage layout

Tutto sotto il prefisso `postprod/` nel container `recordings/` (stesso
provider, niente bucket separato — semplifica reconciliation e
retention).

```
postprod/
  {eventId}/
    {recordingId}/
      {runId}/                       # zero-padded width 3, e.g. "001"
        transcript.raw.json          # WhisperX output completo
        transcript.it.vtt            # WebVTT sorgente
        transcript.it.txt            # plain text
        summary.it.md                # sintesi "verbale PA"
        transcript.en.vtt            # traduzione (TRANSLATION_VTT)
        summary.en.md                # sintesi tradotta (TRANSLATION_MD)
        transcript.fr.vtt
        summary.fr.md
```

I path canonical sono calcolati da `app/src/lib/ai/paths.ts` e validati
sia all'enqueue (`expectedArtifactsForJob`) sia al register (il
`POST /postprod-artifact` rifiuta `blobKey` che non coincide con quello
canonico — defence in depth contro worker buggati).

---

## Componenti runtime

| Component | Image | Schedule | Resources | RBAC |
|---|---|---|---|---|
| **postprod-orchestrator** (CronJob) | `bitnami/kubectl` | `* * * * *` | 10m cpu / 64Mi | `batch/jobs:get,list,create,delete`, `batch/cronjobs:get` |
| **postprod-worker** (Job template, suspended CronJob) | `ghcr.io/italia/pa-webinar-postprod-worker:dev` | `@yearly` + `suspend: true` | 4 cpu / 16Gi + 1× GPU | none |
| **postprod-reclaim** (CronJob) | `curlimages/curl` | `* * * * *` | 50m cpu / 32Mi | none (curl only) |
| **postprod-retention** (CronJob) | `curlimages/curl` | `30 3 * * *` | 50m cpu / 64Mi | none |
| **vLLM** (Deployment, fuori chart attuale) | tuo | always on opt | 1× GPU + 24Gi+ | none |

L'orchestrator usa `kubectl create job --from=cronjob/postprod-worker`:
il template `postprod-worker` esiste come CronJob sospeso solo per
**conservare il pod spec** (nodeSelector, taint toleration, GPU,
secrets). Non viene eseguito sul suo schedule.

---

## Configurazione

### Helm values (`infra/helm/pa-webinar/values.yaml`)

Off di default. Per abilitare in un cluster esistente:

```yaml
postprod:
  enabled: true

  worker:
    image: ghcr.io/italia/pa-webinar-postprod-worker:dev
    # In sviluppo iniziale, lascia stub: true per saltare WhisperX/LLM
    # e generare artefatti "canned". Toglilo quando arrivano i modelli.
    stub: false

    nodeSelector:
      workload: ai-gpu
    tolerations:
      - key: workload
        operator: Equal
        value: ai-gpu
        effect: NoSchedule

    # Pre-popolato HuggingFace cache. Senza PVC ogni nodo cold-start
    # ripeti la fetch — con HF_HUB_OFFLINE=1 nel container va popolato
    # manualmente prima del primo run.
    modelsPvc: ai-models  # crea una PVC ReadOnlyMany su Azure Files Premium

    hfTokenSecret:
      name: hf-token
      key: HF_TOKEN

    extraEnv:
      AI_VLLM_BASE_URL: "http://pa-webinar-vllm.ai:8000/v1"
      AI_VLLM_MODEL_ID: "Qwen/Qwen3-32B-Instruct"

    gpu:
      enabled: true
      count: 1
```

### SiteSetting (runtime, admin UI)

Modificabile dal pannello senza redeploy:

| Field | Default | Note |
|---|---|---|
| `aiPipelineEnabled` | `false` | Kill-switch globale. Quando false, l'orchestrator non crea worker Jobs anche se ci sono eventi `aiTranscriptEnabled` |
| `aiLlmProvider` | `"vllm"` | Solo `vllm` ammesso (sovranità) |
| `aiAsrProvider` | `"whisperx"` | |
| `aiDefaultTargetLocales` | `"en,fr"` | Lingue di default per traduzione |
| `aiMaxConcurrentJobs` | `2` | Worker simultanei massimi |
| `aiJobMaxAttempts` | `5` | Retry cap (con backoff esponenziale 30s→2h) |
| `aiArtifactRetentionDays` | `0` | 0 = retention legata a Event; >0 = override globale |
| `aiConsentDisclosure` | `{}` | JSONB multilingua, mostrato in waiting-room |

### Per-event (wizard / Event row)

| Field | Default | Note |
|---|---|---|
| `aiTranscriptEnabled` | `false` | Master switch. Se off, niente pipeline anche se recording attiva |
| `aiSummaryEnabled` | `false` | Richiede `aiTranscriptEnabled` |
| `aiTranslationEnabled` | `false` | Richiede `aiTranscriptEnabled` |
| `aiTargetLocales` | `null` | Comma-separated. Override del `aiDefaultTargetLocales` |

> **Integrazione wizard pendente**: i toggle sono nel DB ma non
> ancora esposti nel 5-step wizard di create/edit evento. Vanno
> aggiunti nello step 2 (Permessi) o 5 (Revisione). Vedi *Cosa manca*.

### Secrets richiesti

| Secret | Chiavi | Da chi consumato | Note |
|---|---|---|---|
| `pa-webinar-secrets` | `CRON_API_KEY` | app + tutti i cron + orchestrator + worker | Già esistente |
| `hf-token` | `HF_TOKEN` | worker pod | Per gated `pyannote/speaker-diarization-3.1`. Generare con TOS accettato su huggingface.co |

---

## Deploy on AKS Italy North

### 0. Quota Azure (PREREQUISITO BLOCCANTE)

Le subscription Azure standard nascono con **`limit=0`** sulle famiglie
GPU recenti (NCADS_A100_v4, NCASv3_T4, NCadsH100v5, NCADSA10v4). Senza
quota il cluster autoscaler tenta lo scale-up del pool ma fallisce con
HTTP 409 `OperationNotAllowed` e va in backoff. Risultato: ogni Pod che
chiede `nvidia.com/gpu` resta `Pending` indefinitamente.

Verifica le quote attuali:

```bash
az vm list-usage --location italynorth \
  --query "[?contains(localName, 'A100')].{name:localName, used:currentValue, limit:limit}" \
  -o table
```

Richiesta (consigliato 48 vCPU = 2 nodi simultanei per `max_count=2`).
Lo shorthand di `--limit-object` accetta solo `value=N`
(`limitObjectType` viene defaultato a `LimitValue` dal CLI):

```bash
az quota update \
  --resource-name standardNCADSA100v4Family \
  --scope "/subscriptions/<SUB_ID>/providers/Microsoft.Compute/locations/italynorth" \
  --limit-object value=48
```

Se la CLI extension `quota` fa storie, **REST diretta** è la via più
affidabile:

```bash
SUB=<SUB_ID>
az rest --method patch \
  --url "https://management.azure.com/subscriptions/$SUB/providers/Microsoft.Compute/locations/italynorth/providers/Microsoft.Quota/quotas/standardNCADSA100v4Family?api-version=2023-02-01" \
  --body '{"properties":{"limit":{"value":48,"limitObjectType":"LimitValue"}}}'
```

Oppure Portal → Subscription → Usage + quotas → "Standard NCADS A100 v4
Family vCPUs" (Compute / Italy North) → Request Increase → 48.

Auto-approvazione tipica: 1-4 ore per quote piccole. Per quote grandi o
in caso di fallimento, support ticket Microsoft via Portal.

### 1. GPU node pool

Il pool produttivo è definito **nel repo `iac-azure`** su branch `main`:
`modules/aks/main.tf` resource `azurerm_kubernetes_cluster_node_pool.ai_gpu`
+ valori in `environments/prod/locals.tf` chiave `ai_gpu_*`.

**Default scelto: `Standard_NC24ads_A100_v4`** — 1× NVIDIA A100 80GB,
24 vCPU, 220 GiB RAM, ~25 Gbps di rete. ~€3.40/hr Italy North; con
scale-to-zero (min=0) e ~4-10 ore di uso reale al mese, la spesa è
~€15-35/mese.

Perché A100 80GB e non T4:

- **Qualità del verbale PA**. Il default LLM è Qwen3-32B-Instruct in
  fp16 (~64GB VRAM) — non entra in T4 16GB. Su T4 servirebbe un 7B
  quantizzato AWQ con qualità nettamente inferiore. Scelta editoriale
  DTD: niente artefatti AI pubblicati a bassa qualità.
- **Throughput**. WhisperX su A100 gira a ~4-6× realtime; su T4 a
  0.3-0.5× — significa che 1h di call diventa 30-60 min di postprod
  su T4 vs 5-10 min su A100. Costo orario maggiore ma costo per job
  più basso.
- **Convivenza modelli**. 80GB ospitano simultaneamente vLLM
  Qwen3-32B (~64GB) + WhisperX large-v3 (~6GB) + pyannote 3.1
  (~2GB) sulla stessa GPU. Su T4 sono mutuamente esclusivi.

Italy North SKU disponibili (verifica `az vm list-skus
--location italynorth` prima del bump):

| SKU | VRAM | vCPU / RAM | €/hr | Per cosa |
|---|---|---|---|---|
| **Standard_NC24ads_A100_v4** | **A100 80GB** | **24 / 220GiB** | **~€3.40** | **prod (default)** |
| Standard_NC4as_T4_v3 | T4 16GB | 4 / 28GiB | ~€0.47 | solo dev/test, ASR only |
| Standard_NC8as_T4_v3 | T4 16GB | 8 / 56GiB | ~€0.70 | solo dev/test, ASR only |
| Standard_NC16as_T4_v3 | T4 16GB | 16 / 110GiB | ~€0.93 | solo dev/test, ASR only |

H100 SKU (ND_H100_v5, NCads_H100_v5) **non disponibili in Italy North**
a oggi. Verificare prima di promuovere.

Applicare:

```bash
cd iac-azure/environments/prod
tofu plan  -target='module.aks.azurerm_kubernetes_cluster_node_pool.ai_gpu'
tofu apply -target='module.aks.azurerm_kubernetes_cluster_node_pool.ai_gpu'
```

Verifica che il pool sia su (a 0 nodi):

```bash
kubectl get nodes -l workload=ai-gpu
az aks nodepool show -g developersitalia-prod \
  --cluster-name developers-italia-prod --name aigpu \
  --query '{vmSize:vmSize, minCount:minCount, maxCount:maxCount, nodeCount:count, taints:nodeTaints}'
```

> Reference standalone (per PA terze che adottano il chart fuori da
> `iac-azure`): `infra/tofu/ai-gpu-nodepool.tf` nel repo pa-webinar
> (`count = 0` di default — il file è solo template).

### 2. NVIDIA GPU Operator

```bash
helm repo add nvidia https://nvidia.github.io/gpu-operator
helm upgrade --install gpu-operator nvidia/gpu-operator \
  -n gpu-operator --create-namespace \
  --set toolkit.enabled=true \
  --set driver.enabled=true \
  --set operator.defaultRuntime=containerd \
  --set nodeSelector.workload=ai-gpu
```

Senza questo step `nvidia.com/gpu` non sarà allocabile e il worker
resta Pending.

### 3. HuggingFace token + seed della PVC modelli

#### Perché serve un token HF

Il modello di diarization `pyannote/speaker-diarization-3.1` è **gated**
su HuggingFace: i pesi sono scaricabili solo da un account che ha
accettato i TOS, e il download richiede un token Bearer. WhisperX
large-v3 e i modelli LLM (Qwen, Mistral) **non sono gated** e si
scaricano senza token.

#### Strategia consigliata: PVC pre-seedata, runtime offline

Il container worker è configurato con `HF_HUB_OFFLINE=1` e
`HF_HOME=/models` (vedi `infra/ai/Dockerfile.worker`). Significa che a
runtime cerca i modelli **solo** sulla PVC montata su `/models`,
senza fare richieste a huggingface.co.

Il token serve quindi **una volta sola**, in un Job di seed che popola
la PVC. Dopo, anche se l'admin revoca il token, il pool funziona.

Esempio di Job seed (esegui una volta dopo aver creato `ai-models` PVC):

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: ai-models-seed
spec:
  template:
    spec:
      restartPolicy: Never
      nodeSelector:
        workload: ai-gpu              # serve la GPU solo per warm-up Whisper
      tolerations:
        - key: workload
          operator: Equal
          value: ai-gpu
          effect: NoSchedule
      volumes:
        - name: models
          persistentVolumeClaim:
            claimName: ai-models
      containers:
        - name: seed
          image: python:3.12-slim
          env:
            - name: HF_TOKEN
              valueFrom:
                secretKeyRef:
                  name: hf-token
                  key: HF_TOKEN
            - name: HF_HOME
              value: /models
          volumeMounts:
            - name: models
              mountPath: /models
          command:
            - sh
            - -c
            - |
              pip install --no-cache-dir huggingface_hub
              huggingface-cli download Systran/faster-whisper-large-v3 --local-dir /models/whisper
              huggingface-cli download pyannote/speaker-diarization-3.1 --local-dir /models/pyannote --token "$HF_TOKEN"
              huggingface-cli download Qwen/Qwen3-32B-Instruct --local-dir /models/llm
              ls -lah /models
```

#### Generazione del token

1. https://huggingface.co/pyannote/speaker-diarization-3.1 → **Agree**
2. https://huggingface.co/settings/tokens → New token (read scope)
3. Secret:
   ```bash
   kubectl create secret generic hf-token \
     -n videocall \
     --from-literal=HF_TOKEN=hf_xxx
   ```
4. Il Secret può essere **eliminato dopo il seed** se non si prevedono
   re-fetch di modelli. Lasciarlo non costa nulla ed è utile per
   aggiornare i pesi in futuro.

#### Alternativa: niente diarization

Se la dipendenza dal token / TOS è bloccante, si può commentare la
pipeline pyannote e produrre un transcript **senza speaker attribution**
(`SPEAKER_??` ovunque). Qualità del verbale degrada significativamente
(il moderatore deve attribuire manualmente le frasi nello speaker
mapping admin) ma rimuove l'unico modello gated della pipeline.

### 4. vLLM Service (separato dal chart)

vLLM gira in un proprio Deployment + Service. Esempio minimal:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: pa-webinar-vllm, namespace: ai }
spec:
  replicas: 1
  selector: { matchLabels: { app: pa-webinar-vllm } }
  template:
    metadata: { labels: { app: pa-webinar-vllm } }
    spec:
      nodeSelector: { workload: ai-gpu }
      tolerations:
        - { key: workload, operator: Equal, value: ai-gpu, effect: NoSchedule }
      containers:
        - name: vllm
          image: vllm/vllm-openai:v0.7.0
          args:
            - "--model"
            - "Qwen/Qwen3-32B-Instruct"
            - "--port"
            - "8000"
            - "--gpu-memory-utilization"
            - "0.9"
            - "--max-model-len"
            - "16384"
          ports: [{ containerPort: 8000 }]
          resources:
            limits: { nvidia.com/gpu: 1, cpu: "8", memory: "48Gi" }
          volumeMounts: [{ name: models, mountPath: /root/.cache/huggingface }]
      volumes:
        - name: models
          persistentVolumeClaim: { claimName: ai-models }
---
apiVersion: v1
kind: Service
metadata: { name: pa-webinar-vllm, namespace: ai }
spec:
  selector: { app: pa-webinar-vllm }
  ports: [{ port: 8000, targetPort: 8000 }]
```

Con `min_count = 0` su autoscaler, il pool si spegne quando nessun
worker o vLLM è running. Se hai bisogno di latenza bassa, pinna
`min_count = 1` (costo: ~€2500/mese sempre on).

### 5. Build + push immagine worker

```bash
cd infra/ai
docker build -f Dockerfile.worker -t ghcr.io/italia/pa-webinar-postprod-worker:dev .
docker push ghcr.io/italia/pa-webinar-postprod-worker:dev
```

Da CI/CD: integrare in `.github/workflows/release.yml` con la sua
matrice di tag.

### 6. Migration DB

La migration `20260527153402_add_postprod_pipeline` aggiunge le
tabelle. Applicata automaticamente dall'init-container `db-migrate`.

### 7. Abilita kill-switch + per-event

Da admin UI `/admin/settings`:
- `aiPipelineEnabled: true`

Da admin UI / direct DB / API admin event, per gli eventi che ti
interessa: `aiTranscriptEnabled = true` etc.

---

## Flusso end-to-end

```
1. Jibri completa la registrazione
   └─ jibri-finalize.sh: ffprobe + faststart + tag MP4 + upload
                       → POST /api/webhooks/recording (HMAC)

2. /api/webhooks/recording
   └─ Crea Event recording fields + CallSession (come prima)
   └─ Crea Recording { blobKey, durationSec, ... }
   └─ Se Event.aiTranscriptEnabled:
        enqueuePostprodForRecording():
        ├─ Recording.consentSnapshot = {…}, status = POSTPROD_QUEUED
        ├─ PostprodJob(TRANSCRIBE)              ← no deps
        ├─ PostprodJob(SUMMARIZE)               ← depends on TRANSCRIBE
        └─ PostprodJob(TRANSLATE × N target locales) ← depends on SUMMARIZE
                                                       (o TRANSCRIBE se no summary)

3. Cron postprod-orchestrator (ogni minuto)
   └─ GET /api/internal/postprod-pending
        → { pipelineEnabled, runnable, claimed, desired, maxConcurrent }
   └─ Conta i k8s Job postprod-worker già attivi
   └─ Per ogni Job mancante:
        kubectl create job --from=cronjob/postprod-worker ...

4. Worker Job (Python)
   └─ POST /postprod-claim { workerId, leaseMinutes: 30 }
        → ClaimResponse con presigned URLs
   └─ download MP4
   └─ TRANSCRIBE: WhisperX + pyannote → transcript JSON + VTT + TXT
      SUMMARIZE:  legge transcript JSON → LLM /chat → summary.md
      TRANSLATE:  legge transcript JSON → LLM /chat × segmenti → VTT + MD
   └─ PUT presigned per ogni artefatto
   └─ POST /postprod-artifact per ognuno (con sha256, sizeBytes, …)
   └─ POST /postprod-progress { status: DONE }
   └─ exit 0

5. /postprod-artifact
   └─ Upsert PostprodArtifact (encryptPII su inlineBody)
   └─ Upsert Speaker (per TRANSCRIPT_JSON con speakerMap)
   └─ Se tutti i job DONE → Recording.status = POSTPROD_DONE

6. Frontend pubblico
   └─ Player carica <track kind="subtitles" src="/api/events/:slug/postprod/subtitle/it">
   └─ TranscriptPanel chiama /api/events/:slug/postprod/transcript
        → render segmenti click-to-seek + badge "AI-generated"
```

### Failure paths

- **Worker crash mid-job**: lease scade (default 30 min). Cron
  `postprod-reclaim` sposta da `CLAIMED → PENDING` con
  `next_attempt_at = NOW`. Nuovo tick orchestrator → nuovo worker.
- **Worker post un FAILED esplicito**: backoff esponenziale 30s → 2h.
  Dopo `aiJobMaxAttempts` tentativi → `FAILED` terminale e
  `Recording.status = POSTPROD_PARTIAL` (alcuni artefatti possono
  comunque essere usciti).
- **Storage giù**: worker rifiuta la PUT, va in FAILED, retry come
  sopra.
- **vLLM giù**: SUMMARIZE/TRANSLATE falliscono, TRANSCRIBE non è
  toccata (resta DONE).

---

## Admin UI

Pagina `/admin/postprod` (file `app/src/app/[locale]/admin/postprod/page.tsx`).

**Tabella** delle ultime ~50 registrazioni con job + artefatti.
Filtri: status. Refetch SWR ogni 10s. Per riga:

- Status pill `POSTPROD_QUEUED/RUNNING/DONE/PARTIAL/FAILED`.
- Dettaglio espandibile con la lista dei job, gli artefatti prodotti e
  lo **speaker mapping** (input free-text per riga `SPEAKER_NN`).
- Azioni: **Re-run** (bump runCount + enqueue nuovo) / **Cancel**
  (marca tutti i job pending come FAILED).

Ogni mutating action passa per `logAdminAction` → `AdminAuditLog`
(pattern progetto).

API admin in `app/src/app/api/admin/postprod/`:
- `GET /api/admin/postprod`
- `POST /api/admin/postprod/recordings/[id]/rerun`
- `POST /api/admin/postprod/recordings/[id]/cancel`
- `PUT  /api/admin/postprod/speakers/[id]`

---

## Public UI

Il player `app/src/components/events/video-player.tsx` è stato esteso
per supportare WebVTT subtitle tracks (sottotitoli soft):

- `<video crossOrigin="anonymous">` + `<track>` per ogni lingua.
- Bottone "CC" nei controlli che apre un menu (Off, IT, EN, FR, …).
- `useEffect` sincronizza `video.textTracks[i].mode` quando la lingua
  cambia (l'attributo `default` di `<track>` è consultato solo al
  load — switching runtime richiede l'API).

Il nuovo `<TranscriptPanel>` (`app/src/components/events/transcript-panel.tsx`)
è pensato per stare nella tab "Trascrizione" della post-event page:

- Click-to-seek su ogni segmento (chiama `video.currentTime = start`).
- Highlight del segmento corrente (`timeupdate` event).
- Auto-scroll dell'elemento attivo nel viewport del pannello.
- Tab "Sintesi" che mostra il summary.md della lingua attiva (se
  disponibile, altrimenti la sorgente).
- Badge "AI-generated" sempre visibile in alto (AI Act Art. 50).

Per integrarlo in una page esistente:

```tsx
const videoRef = useRef<HTMLVideoElement>(null);

<VideoPlayer
  src={recordingUrl}
  title={eventTitle}
  subtitleTracks={[
    { language: 'it', src: `/api/events/${slug}/postprod/subtitle/it`, label: 'Italiano', isDefault: true },
    { language: 'en', src: `/api/events/${slug}/postprod/subtitle/en`, label: 'English' },
  ]}
/>

<TranscriptPanel
  videoRef={videoRef}
  endpoint={`/api/events/${slug}/postprod/transcript`}
  activeLanguage="it"
/>
```

> **Wiring del videoRef pendente**: il `VideoPlayer` attuale tiene il
> `videoRef` internamente. Per esporre il ref al TranscriptPanel
> serve un piccolo refactor (`forwardRef` o callback). Vedi
> *Cosa manca*.

---

## GDPR + AI Act

### Base giuridica per il trattamento AI

- **Art. 6.1.b GDPR** (esecuzione del contratto): l'evento promette
  trascrizione/sintesi → trattare la voce per produrla rientra nel
  contratto. **Condizione**: l'admin attiva `Event.aiTranscriptEnabled`
  e la disclosure è esposta in waiting-room prima del join.
- **Art. 9 GDPR** (dati biometrici): NON applicabile a trascrizione +
  sintesi (sono "speech-to-text", non identificazione biometrica).
  Applicabile a voice cloning → **out of scope MVP**.
- **Art. 6.1.a GDPR** (consenso esplicito): consensi user-level
  granulari sono in DB (`Registration.aiConsent*`) ma l'integrazione
  UI nella registration form è pendente (vedi *Cosa manca*). Per
  ora il snapshot `Recording.consentSnapshot` cattura lo stato dei
  flag a livello evento al momento dell'enqueue.

### AI Act Art. 50 (transparency obblighi)

Ogni artefatto AI è marcato `isSynthetic: true` nel DB. La UI
pubblica mostra il badge "AI-generated content" in cima al
TranscriptPanel. La sintesi include il disclaimer "Trascrizione e
sintesi sono prodotte automaticamente; possono contenere errori; il
video resta la fonte autoritativa".

### Audit log

- `AdminAuditLog` registra azioni `POSTPROD_RERUN`, `POSTPROD_CANCEL`,
  `POSTPROD_SPEAKER_MAP`.
- `GdprAuditLog` non viene esteso in MVP — gli artefatti AI sono
  cancellati dal cron `postprod-retention` con log su console (un
  follow-up può aggiungere `AI_ARTIFACT_DELETED`).

### Encryption at rest

- `PostprodArtifact.inlineBody` è cifrato AES-256-GCM via `encryptPII`
  (dual-read con `tryDecryptPII` per resilienza a legacy plaintext).
- Blob su storage: cifratura at-rest è quella del provider (Azure
  SSE / S3 SSE), come per i recording.

### Retention

- Default: l'artefatto vive finché vive il `Recording` → l'event
  retention si propaga via cascade FK quando l'evento viene
  hard-deleted.
- Override globale: `SiteSetting.aiArtifactRetentionDays > 0` → il
  cron `postprod-retention` cancella artefatti più vecchi di N giorni
  da `createdAt`, indipendentemente dall'evento.
- Override per-recording: `Recording.retentionUntil` → cancellazione
  forzata al `Recording.retentionUntil`.

---

## Test e dev locale

### Unit tests

`app/src/lib/ai/*.test.ts` — 41 test su:
- idempotency (determinismo, runCount, payload reordering)
- paths (formatRunId, prefisso, expected artifacts)
- providers (vincolo sovranità: solo `vllm` ammesso)
- schemas (discriminated union, claim response, artifact register)

```bash
cd pa-webinar
npm run test --workspace=app -- src/lib/ai
```

### End-to-end con stub (no GPU)

Per validare il loop claim → upload → register senza GPU:

```yaml
# values-dev.yaml
postprod:
  enabled: true
  worker:
    stub: true                  # WORKER_STUB=1 → emette canned outputs
    gpu:
      enabled: false            # nvidia.com/gpu non richiesto
    nodeSelector: {}            # gira su qualunque pool
    tolerations: []
```

Il worker stub produce un transcript a 2 segmenti fittizi + una
sintesi placeholder. Utile per smoke test su minikube/k3s.

### Build container worker

```bash
cd infra/ai
docker build -f Dockerfile.worker -t pa-webinar-postprod-worker:local .
```

(Richiede ~10 minuti perché installa torch+whisperx+pyannote.)

---

## Troubleshooting

### Worker Pending: "0/N nodes are available: Insufficient nvidia.com/gpu"

Il GPU operator non è installato o non sta riconoscendo i nodi.
`kubectl describe node <gpu-node> | grep nvidia` deve mostrare
`nvidia.com/gpu: 1`. Se manca:

```bash
kubectl get pods -n gpu-operator
kubectl logs -n gpu-operator -l app=nvidia-device-plugin
```

### "401 Unauthorized" dai endpoint internal

`CRON_API_KEY` non è in sync tra app e worker. Il worker prende il
secret via `secretRef` nel CronJob worker template — controlla che
`{{ include "pa-webinar.secretName" . }}` punti allo stesso Secret
del cron postprod-orchestrator.

### "blobKey mismatch" nel register

Il worker ha caricato a un path diverso da quello presigned. Verifica
che il `blobKey` ritornato dal claim sia identico a quello passato al
register (i path canonical sono calcolati dalle stesse funzioni).

### "transcript missing despite DONE dependency"

Il job SUMMARIZE/TRANSLATE è stato claimato ma la dipendenza
TRANSCRIBE ha completato senza produrre il `TRANSCRIPT_JSON`. Succede
se il worker TRANSCRIBE è andato in DONE senza chiamare register per
quell'artefatto — bug nel worker. Cancella il job dall'admin UI e
rilancia.

### Pyannote 401 / model gated

`HF_TOKEN` non è settato o non ha accettato i TOS:
1. https://huggingface.co/pyannote/speaker-diarization-3.1 → Accept
2. https://huggingface.co/settings/tokens → genera read token
3. `kubectl create secret generic hf-token --from-literal=HF_TOKEN=hf_xxx`
4. `helm upgrade ... --set postprod.worker.hfTokenSecret.name=hf-token`

### vLLM OOM

Qwen3-32B in fp16 occupa ~64GB → entra in A100 80GB ma con margine
stretto se `--gpu-memory-utilization=0.95+`. Abbassa al 0.85 o passa
a Mistral-Small-3.2 (~48GB) tramite `AI_VLLM_MODEL_ID`.

---

## Cosa manca / follow-up

Elementi che restano fuori da questa iterazione e meritano un PR
dedicato:

1. **Integrazione wizard**. I toggle `aiTranscriptEnabled`,
   `aiSummaryEnabled`, `aiTranslationEnabled`, `aiTargetLocales` sono
   in DB ma non esposti nel 5-step wizard di create/edit evento.
   Aggiungere allo step 2 (Permessi) o 5 (Revisione).

2. **Consent UI per-partecipante** nella registration form +
   waiting-room. Le colonne `Registration.aiConsent*` esistono; va
   aggiunto il checkbox + la persistenza + l'email di conferma.

3. **`forwardRef` sul VideoPlayer** in modo che il `TranscriptPanel`
   possa ricevere lo stesso `videoRef`. Oggi il player tiene il ref
   internamente.

4. **Post-event page integration**: aggiungere una tab "Trascrizione"
   alla page `app/src/app/[locale]/events/[slug]/page.tsx`
   condizionale su `postEventShowQA` style flag (es.
   `postEventShowTranscript`).

5. **Wiring summary nel translate job**: il worker `run_translate`
   tenta di leggere `transcript.summary` ma il TRANSCRIBE non lo
   include — serve aggiungere un input role "summary" al dependency
   graph (esso esiste solo come role "transcript" oggi). Il
   workaround attuale è scrivere un commento placeholder
   `TRANSLATION_MD`.

6. **Ricerca full-text** sulle trascrizioni (roadmap v0.6.0). Aggiungere
   `tsvector` su `PostprodArtifact.inlineBody` quando il tipo è
   `TRANSCRIPT_TXT`.

7. **AI Act audit log dedicato**: estendere `GdprAuditLog.action` con
   `AI_PIPELINE_STARTED` / `AI_ARTIFACT_PUBLISHED` /
   `AI_ARTIFACT_DELETED` / `AI_VOICE_CLONE_USED` (l'ultimo per V4).

8. **CI image push**: pipeline GitHub Actions per buildare e pushare
   `ghcr.io/italia/pa-webinar-postprod-worker` insieme alle release.

9. **Bench reale**: misurare throughput (~minuti di video per minuto
   di GPU) e tempo di sintesi su Qwen3-32B per stimare costi reali.
