# Postprod cluster run — report metriche & timeline (2026-06-01)

Validazione end-to-end della feature **waveform/timeline** sul cluster
`videocall-test`, registrazione `caffettino-del-dtd-24-aprile`
(`696e0be6…`, durata 593s). Sessione autonoma.

## ✅ ESITO FINALE: waveform validata end-to-end nel cluster (run #8, 16:07Z)

Dopo **6 fix** (sotto), il worker ha completato: claim → tempdir `/work` → download MP4 → (stub) transcribe 2.4s → upload Azure (`x-ms-blob-type`) → register artifact (NULL language) → **`WAVEFORM_JSON` prodotto** (13829 B, 2374 bucket = ~4/s su 593.57s, peaks 0–1). L'editor admin lo serve (`waveform` non-null + `mediaUrl`). Nodo GPU `vmss00000a` vissuto ~22min (< 1h). **6 bug pre-esistenti** (catena "mai girato in-cluster") corretti lungo il percorso.

## Esito sintetico

- ✅ Feature **waveform/timeline** + **editor trascrizione**: codice completo, typecheck/lint/build/test verdi (667 test), `compute_waveform` provato su audio reale.
- ✅ **6 bug infra pre-esistenti** trovati e corretti+deployati (vedi tabella).
- ✅ App live su `videocall-test` (editor, timeline, route admin, migration `WAVEFORM_JSON`).
- ✅ **Waveform prodotta end-to-end nel cluster** (run #8): `WAVEFORM_JSON` 13829 B, 2374 bucket su 593.57s, servito dall'editor admin (`waveform` non-null).
- ✅ **GPU sotto controllo**: 7 nodi A100 nella sessione, max singolo nodo **~42m**, **nessuno > 1h** (vincolo rispettato). Spreco da crash-loop sui tentativi intermedi (vedi note).

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

## Diagnosi crash worker — RISOLTA

Catturato lo stderr live (run diagnostico): il primo crash era `tempfile`
su `/tmp` read-only (bug #4, `TMPDIR=/work`); poi PUT Azure 400 (bug #5,
`x-ms-blob-type`); poi register 500 su NULL language (bug #6). Risolti
tutti e tre → run #8 completa e produce `WAVEFORM_JSON`.

Il worker gira in **`WORKER_STUB=1`** (trascrizione finta): il transcript
è canned ma la **waveform è reale** (calcolata da `waveform.py` sull'MP4).
Per una trascrizione reale servirà `WORKER_STUB=0` + models PVC + `HF_TOKEN`.

## Stato finale & raccomandazioni

- **GPU**: 0 nodi aigpu, 0 worker pod (verificato post-run). Vincolo ≤1h/nodo sempre rispettato.
- Tutti i 6 fix committati+deployati su `dev`→`videocall-test` (app + worker images + helm).
- Recording resta in `POSTPROD_PARTIAL/FAILED` cosmetico (downstream cancellato di proposito per fermare la GPU dopo la waveform).
- **Prossimi passi (opzionali, richiedono OK GPU)**:
  1. `WORKER_STUB=0` + models PVC + `HF_TOKEN` per validare la trascrizione reale (oltre la waveform).
  2. Aggiungere al watchdog/orchestrator il taglio del run dopo N fallimenti worker per evitare crash-loop.
  3. Aprire PR `dev`→`main` con i 6 fix (sbloccano la pipeline postprod in-cluster, mai funzionante prima).
