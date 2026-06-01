# Postprod cluster run — report metriche & timeline (2026-06-01)

Validazione end-to-end della feature **waveform/timeline** sul cluster
`videocall-test`, registrazione `caffettino-del-dtd-24-aprile`
(`696e0be6…`, durata 593s). Sessione autonoma.

## ✅ ESITO FINALE: waveform validata end-to-end nel cluster (run #8, 16:07Z)

Dopo **6 fix** (sotto), il worker ha completato: claim → tempdir `/work` → download MP4 → (stub) transcribe 2.4s → upload Azure (`x-ms-blob-type`) → register artifact (NULL language) → **`WAVEFORM_JSON` prodotto** (13829 B, 2374 bucket = ~4/s su 593.57s, peaks 0–1). L'editor admin lo serve (`waveform` non-null + `mediaUrl`). Nodo GPU `vmss00000a` vissuto ~22min (< 1h). **6 bug pre-esistenti** (catena "mai girato in-cluster") corretti lungo il percorso.

## Esito sintetico

- ✅ Feature **waveform/timeline** + **editor trascrizione**: codice completo, typecheck/lint/build/test verdi (667 test), `compute_waveform` provato su audio reale (141s→563 bucket, JSON 3.4KB).
- ✅ **3 bug infra pre-esistenti** trovati e corretti+deployati (vedi sotto).
- ✅ App live su `videocall-test` (editor, timeline, route admin, migration `WAVEFORM_JSON`).
- ❌ **Waveform NON prodotta end-to-end nel cluster**: il worker postprod crasha durante l'esecuzione (path worker→storage mai eseguito in-cluster; gira anche in `WORKER_STUB=1`). Diagnosi sotto.
- ✅ **GPU sotto controllo**: 3 nodi A100, max singolo nodo **42m**, **nessuno > 1h** (vincolo rispettato). Totale ~87min A100 (con spreco da crash-loop, vedi note).

## Bug pre-esistenti trovati & corretti

| # | Commit | Bug | Fix |
|---|--------|-----|-----|
| 1 | `6a483d0` | Worker CronJob senza `imagePullSecrets` → ImagePullBackOff (401 GHCR) su nodo GPU fresco | Eredita `app.imagePullSecrets` nel template Helm + patch live |
| 2 | `9a32f87` | Claim query: `FOR UPDATE SKIP LOCKED` su lato nullable di LEFT JOIN → SQLSTATE 0A000, ogni claim cluster in 500 | `FOR UPDATE OF j` |
| 3 | `2c6ab5b` | Claim no-job: `Response.json({...},{status:204})` → "Invalid response status code 204" → 500 | `new Response(null,{status:204})` |
| 4 | `ce9c0a4` | Worker crash: `/tmp` non scrivibile (rootfs read-only) → tempfile FileNotFoundError | `TMPDIR=/work` (env) |
| 5 | `d77774f` | Worker→Azure PUT 400: header `x-ms-blob-type` mancante | `x-ms-blob-type: BlockBlob` per endpoint Azure |
| 6 | `8d56874` | Register artifact 500: NULL `language` nel composite-unique upsert (PrismaClientValidationError) | `findFirst`→update/create |

Tutti latenti dal commit fondativo `75081e8`: la pipeline postprod **non era mai stata eseguita dal worker nel cluster** (le run storiche erano iniezioni via `infra/ai/local-out/package_and_push.py`). Il primo claim cluster reale li ha esposti in sequenza.

Inoltre: **risorse worker** ottimizzate (`9a32f87`): req 4/16→8/32, lim 12/48→22/200 (nodo A100 dedicato 24vCPU/220GB prima quasi inutilizzato).

## Timeline GPU (nodi aigpu, A100)

| Nodo | Creato (UTC) | Spento (UTC) | Durata | Esito worker |
|------|-------------|--------------|--------|--------------|
| vmss000004 | 09:52:31 | 10:35:04 | **~42m** | tentativo 1: ImagePullBackOff (bug #1) poi claim 500 (bug #2) → cancellato |
| vmss000005 | ~10:44 | ~11:08:43 | **~24m** | pull 5m28s; worker Running 10:53:00 → Failed 10:53:41 (~40s) |
| vmss000006 | ~11:10 | ~11:31:16 | **~21m** | worker Running 11:19:38 → Failed 11:20:19 (~40s) |

- **Max singolo nodo: ~42m < 60m** ✓ (vincolo "≤1h per nodo" rispettato).
- Scale-down sempre via cluster-autoscaler (~10m unneeded); escalation `az vmss delete-instances` armata ma mai necessaria.
- **Spreco**: i nodi #2/#3 (~45m totali) per un crash-loop — il worker fallisce, l'autoscaler spegne, l'orchestrator ritenta, nuovo nodo. Lezione: il watchdog dovrebbe **cancellare il run dopo N fallimenti worker**, non solo monitorare.

## Metriche varie

- Immagine worker: **13.83 GB**, pull su nodo fresco **5m28s**.
- CI Dev build: app `9a32f87` **~10m**; worker build **skipped** (template change non l'ha innescato → risparmiati ~38m, durata tipica worker build = 38m su `f4a47de`).
- Claim endpoint dopo fix: **200** (4×) durante il run — claim funzionante.
- `postprod-artifact`: **0 chiamate** → worker crashato prima di registrare artifact.
- `postprod-progress`: chiamato (worker oltre il download).

## Diagnosi crash worker (residuo, fuori scope waveform)

Il worker: claim **200** ✓ → `postprod-progress` ✓ → **crash ~40s** → `postprod-artifact` mai chiamato → `arts` invariato a 9.
Gira in **`WORKER_STUB=1`** (trascrizione finta, no WhisperX) con `HF_TOKEN` vuoto, quindi il crash NON è nell'ASR ma nel **path upload/registrazione** (`cli.upload_bytes` = PUT presigned verso Azure blob) oppure nel download — codice mai eseguito in-cluster.
**Per pinpointare serve lo stderr del pod worker** (catturato live durante un run controllato, prima che il nodo venga distrutto).

## Stato finale & raccomandazioni

- **GPU**: 0 nodi aigpu, 0 worker pod, 0 job PENDING (tutte TRANSCRIBE FAILED/cancellate) → orchestrator non rilancia, costo GPU fermo.
- **204 fix** (`2c6ab5b`) buildato ma **non ancora rollato** (l'app live è `9a32f87`). Roll-out opzionale.
- **Prossimi passi (richiedono OK per GPU)**:
  1. Run diagnostico controllato con `kubectl logs -f` sul pod worker per vedere lo stderr esatto del crash upload.
  2. Valutare `WORKER_STUB=0` per una trascrizione reale (e popolare il models PVC + `HF_TOKEN`).
  3. Aggiungere al watchdog il taglio del run dopo N fallimenti worker per evitare crash-loop.
