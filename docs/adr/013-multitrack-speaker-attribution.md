# ADR-013 — Speaker attribution accurato via registrazione multi-traccia per-partecipante

**Stato**: Proposto (2026-06-01)
**Decisori**: team eventi-dtd / DTD
**Contesto abilitante**: la trascrizione post-evento attribuisce i parlanti con pyannote in "blind diarization" sull'audio misto Jibri; mislabel frequenti, mapping manuale e gestione debole delle sovrapposizioni. Jitsi conosce la sorgente reale di ogni voce, ma oggi la buttiamo via.

## Contesto

Stato attuale della pipeline (vedi [`docs/POSTPROD.md`](../POSTPROD.md), `infra/ai/worker/transcribe.py`):

1. **Jibri** registra la conferenza come **un singolo MP4 composito** (`startRecording({mode:'file'})`), con **una sola traccia audio mista**.
2. Il worker esegue **WhisperX + pyannote.audio 3.1** sull'audio misto: pyannote raggruppa le voci in cluster acustici `SPEAKER_00/01/…` **senza alcuna informazione di identità**.
3. L'admin **mappa a mano** ogni `SPEAKER_xx` a un nome reale (editor post-evento, ADR feature waveform/editor).

Limiti strutturali:
- **Mislabel**: pyannote sbaglia il numero di speaker (outlier, voci simili, audio VoIP) → l'`expected_speakers` aiuta ma non risolve.
- **Sovrapposizioni**: la diarization assegna **un solo speaker per segmento**; quando due persone parlano insieme, una viene persa o attribuita male.
- **Lavoro manuale**: il mapping `SPEAKER_xx → nome` è sempre necessario.

Eppure Jitsi/JVB **conosce la verità di base**: ogni endpoint ha uno stream audio separato (SSRC) con identità (displayName dal JWT del portale), più eventi `dominantSpeakerChanged` e livelli audio per-partecipante. L'informazione esiste in diretta e viene **distrutta** dal mixing di Jibri.

Obiettivo: attribuzione **certa** (nome reale, non cluster acustico) e **gestione naturale degli overlap**.

## Opzioni valutate

### Opzione A — Recorder multi-traccia custom (bot lib-jitsi-meet headless) — SCELTA

Un nuovo servizio "multitrack recorder": un bot headless che entra nella stanza col JWT (come un partecipante invisibile), si sottoscrive a **ogni traccia audio remota**, e registra **N file audio separati** (uno per partecipante), ciascuno etichettato con l'identità del partecipante (displayName dal JWT / endpoint id). A fine evento carica le N tracce + un manifest `track → partecipante`.

Il worker poi trascrive **ogni traccia indipendentemente** con WhisperX (una traccia = un parlante → **niente diarization**), e fonde i segmenti per timestamp: il risultato ha **nomi reali** e **overlap nativi** (segmenti di tracce diverse possono sovrapporsi nel tempo, perché sono registrazioni separate).

**Pro**
- Attribuzione **esatta** (identità dal JWT, non inferenza acustica) → **zero mapping manuale**.
- **Overlap risolti per costruzione**: tracce indipendenti, due parlanti contemporanei = due segmenti concorrenti.
- WhisperX **senza pyannote**: più semplice, più veloce, niente modello gated HF, niente `expected_speakers`.
- Audio per-traccia è **mono pulito** del singolo parlante → ASR più accurato (no cross-talk).
- Si innesta sulla pipeline esistente (artifact storage, worker, editor) cambiando solo l'ingest.

**Contro**
- **Nuovo servizio media** (WebRTC receive-only) da scrivere e mantenere: Node + lib-jitsi-meet + cattura tracce (`node-webrtc`/`werift` o Chrome headless con `MediaRecorder` per-track). È il pezzo a maggior rischio/sforzo.
- Scala con gli eventi come Jibri (CPU + banda per ricevere N stream) → deployment dedicato + scale-with-events.
- **PII più granulare**: la voce isolata di una persona è dato personale (vicino al biometrico) → vincoli GDPR forti (consenso, retention, cifratura, minimizzazione).
- Più storage (N tracce vs 1) — mitigato: audio-only Opus ~16-32 kbps/parlante.

### Opzione B — Jigasi (gateway transcription Jitsi)

Jigasi entra in conferenza e riceve gli stream per-partecipante; è il path "nativo" Jitsi per la trascrizione live. Potrebbe fornirci il **per-speaker** già separato.

**Pro**: componente Jitsi ufficiale; riceve già stream separati; integra l'identità.
**Contro**: orientato a **STT live** (Vosk/Google), non alla **cattura audio post-evento ad alta qualità**; ripiegarlo a "registratore di tracce" è innaturale; qualità STT inferiore a WhisperX large-v3; aggiunge comunque un servizio. Utile semmai per la **timeline parlante** (vedi Opzione D), non per il nostro post-processing di qualità.

### Opzione C — Dump RTP a livello JVB

Estendere/patchare il JVB per dumpare l'RTP per-endpoint.

**Contro**: invasivo sul core SFU, fragile fra gli upgrade Jitsi, fuori dal nostro perimetro di manutenzione. Scartato.

### Opzione D — Audio misto + timeline dominant-speaker (fallback leggero)

Tenere la registrazione mista Jibri + catturare in diretta `dominantSpeakerChanged` (timestamp + partecipante) → allineare i segmenti pyannote alla timeline per **dare i nomi reali** e correggere i mislabel.

**Pro**: piccolo (listener frontend + ingest + allineamento), nessun servizio nuovo, nessuna PII audio aggiuntiva.
**Contro**: **non risolve gli overlap** (dominant speaker = uno alla volta); resta dipendente dalla qualità di pyannote per la segmentazione.

> D **non è alternativa** a C ma **complemento a basso costo**: la timeline dominant-speaker è un'ottima fonte di verità anche per A (validazione/etichettatura) e va catturata comunque. La implementiamo come **Fase 0** perché dà valore subito e indipendentemente.

## Decisione

Adottare **Opzione A** (recorder multi-traccia custom) come traguardo, con **Opzione D come Fase 0** (valore immediato + base dati riusabile). pyannote resta come **fallback** per registrazioni miste/legacy o eventi senza recorder multi-traccia.

## Architettura & modello dati (bozza)

- **Recorder**: nuovo deployable `multitrack-recorder` (namespace, scale-with-events come Jibri). Riceve-only WebRTC, una `MediaRecorder`/encoder per traccia remota → file `audio/{participantId}.opus`. Identità presa dal JWT del portale (già emesso, vedi `app/src/app/api/events/[param]/jitsi/token`).
- **Storage/manifest**: alla fine, upload tracce sotto `recordings/multitrack/{eventId}/{recordingId}/` + manifest `tracks.json` (`[{participantId, displayName(enc), trackKey, startOffsetMs, durationMs}]`). Webhook al portale (riusa `/api/webhooks/recording`).
- **Prisma**: nuovo `RecordingTrack` (recordingId, participantId, displayName cifrato, blobKey, startOffsetMs, durationMs) **oppure** estendere `Speaker` perché diventi "identità reale" (diarLabel → participantId). Lo `Speaker.displayName` arriva dal JWT, non più mapping manuale.
- **Worker** — nuovo flusso `TRANSCRIBE_MULTITRACK`: per ogni traccia, WhisperX **senza diarization** → segmenti `{start, end, text}` con `speaker = participantId`; poi **merge** di tutte le tracce ordinate per `start`, allineate sull'`startOffsetMs` comune. Output `TRANSCRIPT_JSON` con segmenti **eventualmente sovrapposti** + `speakers[]` con nomi reali. Il resto (SUMMARIZE/TRANSLATE/SUBTITLE/DUB/WAVEFORM) invariato; la waveform può restare quella del mix Jibri (se ancora prodotto) o una somma delle tracce.
- **UI**: l'editor/transcript panel deve gestire **segmenti sovrapposti** (oggi assume sequenzialità) — render interlacciato per speaker, niente più "Partecipante N" anonimi.

## Implicazioni GDPR (bloccante)

L'audio isolato del singolo parlante è **dato personale ad alta sensibilità** (prossimo al biometrico vocale, art. 9 se usato per identificazione). Richiede:
- **Consenso esplicito** al momento della registrazione (estendere il consenso evento/partecipante; la registrazione mista è già consentita, ma la traccia individuale è un trattamento nuovo da dichiarare).
- **Minimizzazione**: le tracce per-partecipante sono **intermedie** — si possono **cancellare subito dopo** la trascrizione (non serve conservarle come gli artifact). Retention molto più breve del transcript.
- **Cifratura at-rest** + chiavi separate; mai esposte al pubblico (solo input worker).
- Aggiornare `docs/GDPR.md`, l'informativa privacy e il service inventory (CycloneDX) — coerente con il lavoro AI Act già fatto.
- Coerenza con la linea "niente voice cloning": qui **non** si clona la voce, si usa per attribuire il testo; va però documentato il trattamento.

## Piano a fasi

- **Fase 0 — Dominant-speaker timeline** (1–2 gg, nessun servizio nuovo): listener `dominantSpeakerChanged` in `jitsi-room.tsx` → ingest `/api/events/[param]/speaker-events` → campo su `CallSession`. Allineamento opzionale in fase di transcript per auto-nominare i cluster pyannote. **Valore immediato anche senza C.**
- **Fase 1 — Merge multi-traccia nel worker** (testabile da solo, **nessuna GPU/infra**): funzione `transcribe_tracks([...]) → merge` + WhisperX single-speaker. Mockabile e unit-testabile subito.
- **Fase 2 — Modello dati + ingest** (`RecordingTrack`, manifest, webhook, storage layout).
- **Fase 3 — Recorder bot** (il pezzo grosso): PoC lib-jitsi-meet headless receive-only → file per traccia → upload. Deployment scale-with-events.
- **Fase 4 — UI overlap** + nomi reali nell'editor/transcript/VTT.
- **Fase 5 — GDPR**: consenso, retention breve tracce, informativa, service inventory.

## Fase 3 — Orchestrazione del recorder (operator a pod fisso)

> Amendment (giugno 2026). Risolve "come si avvia il recorder quando un evento è LIVE?" tenendo conto dei requisiti: **reattivo**, **efficiente** (niente Job speculativi), **portabile** (AKS/GKE/EKS/k3s), **sicuro**, **affidabile**.

### Perché NON un CronJob (come il postprod-orchestrator)
Il `cronjob-postprod-orchestrator` va bene per la coda postprod (lavoro batch, claim da una coda), ma è il modello sbagliato per il recorder:
- **Latenza**: un tick al minuto può perdere i primi ~60s dell'evento (l'apertura).
- **Spreco**: l'orchestrator postprod spawna worker *generici* fino a `desired`; un pattern analogo per il recorder creerebbe Job anche quando non servono.
- L'utente vuole esplicitamente **un pod fisso con RBAC** (operator).

### Modello scelto: operator riconciliante (edge-triggered + level-triggered)
Un **Deployment fisso a 1 replica** (`recorder-controller`, immagine leggera Node, **senza** Chrome/puppeteer) con RBAC namespaced minimale. È il pattern classico degli operator K8s:

- **Edge-triggered (reattività)**: il portale, nel punto in cui *rileva* la transizione → `LIVE` (oggi `POST /api/internal/jvb-desired-replicas`, chiamato dallo scaler JVB), fa un best-effort `POST` al controller (`/dispatch {eventId}`). Il controller crea **subito** il Job recorder. Niente attesa del prossimo tick.
- **Level-triggered (affidabilità)**: il controller ha un **reconcile loop** a bassa frequenza (es. 30s) che interroga il portale (`GET /api/internal/recorder-desired`) per la lista degli eventi che *dovrebbero* avere un recorder attivo (LIVE + `aiTranscriptEnabled` + consenso multi-traccia) e **diffonde** verso lo stato reale dei Job nel namespace. Ripara i push persi, ricrea Job falliti, e fa **GC** dei Job per eventi non più LIVE. È la spina dorsale: il push è solo un'ottimizzazione di latenza.
- **Idempotenza/efficienza**: **un solo** Job per `recordingId`, nome deterministico + label `recordingId=<uuid>`. Push duplicati o reconcile concorrenti non raddoppiano. Job creati **solo** per eventi che servono davvero → zero spreco.

```
  ┌────────── portale (Next.js, K8s-agnostico) ──────────┐
  │  jvb-desired-replicas: rileva LIVE                    │
  │     └─(best-effort) POST controller /dispatch         │  edge
  │  GET /api/internal/recorder-desired  ← reconcile      │  level
  │  POST /api/internal/recorder-claim   ← work-order      │
  │  POST /api/internal/multitrack-manifest ← ingest (✓Fase2)│
  └───────────────────────────────────────────────────────┘
            ▲ (HTTP, x-api-key)        │ crea Job (K8s API, RBAC)
            │                          ▼
     recorder-controller (pod fisso) ──► Job recorder (per recordingId)
                                              └─ claim → cattura → upload → ingest
```

### Chi conia cosa (sicurezza: credenziali fuori dall'operator)
Il controller **non** tocca credenziali Jitsi/storage: passa solo `recordingId`/`eventId` come env del Job. Il recorder, all'avvio, fa **`POST /api/internal/recorder-claim`** (x-api-key) e riceve il work-order:
- **JWT bot** coniato da `generateJitsiJwt` (identità `rec-bot-<recordingId>`, `affiliation: member`, receive-only, TTL = durata max evento).
- **Recording row** creata *al claim* (oggi nasce dal webhook Jibri, troppo tardi per il multitrack): si crea `CallSession`+`Recording` con `consentSnapshot`/`pipelineSnapshot` al dispatch.
- **Upload**: per-traccia, a fine evento, il recorder chiede un **PUT firmato per singolo blob** (riusa `presignArtifactUpload`, scope minimo per-blob — preferito a una SAS di container per sicurezza) sotto il prefisso `recordings/multitrack/{eventId}/{recordingId}/`. In alternativa, una SAS prefissata se si vuole evitare il round-trip per traccia (documentato, ma scope più ampio).
- L'**ingest** finale (`multitrack-manifest`, già esistente) è path-confinato: anche un recorder compromesso non può scrivere RecordingTrack fuori dal prefisso.

### Portabilità — NON K8s-native only (riuso open-source su VM/compose)
Vincolo di riuso: l'applicativo va rilasciato anche **open-source su VM con docker-compose** (eventualmente "full mode" in meno). L'orchestrazione **non deve dipendere da Kubernetes**. Per questo il controller è strutturato così:
- la **logica di riconciliazione è pura e platform-agnostica** (`reconcile.ts`);
- l'unica parte ambiente-specifica è dietro l'astrazione **`RecorderRunner`** (`list`/`start`/`stop` su un'unità di lavoro con handle opaco), con due implementazioni intercambiabili via env `RUNNER`:
  - **`KubernetesRunner`** (full mode): crea un **Job** dal template CronJob sospeso `recorder`, via `@kubernetes/client-node` (solo API standard → AKS/GKE/EKS/k3s identico). RBAC = `Role`/`RoleBinding`/`ServiceAccount` namespaced (clone del SA dell'orchestrator postprod): `batch/jobs` CRUD, `batch/cronjobs` get/list, `pods`/`pods/log` get/list. Niente cluster-wide.
  - **`DockerRunner`** (VM/compose): crea un **container** recorder via socket Docker (`dockerode`, `/var/run/docker.sock`), elenca/ferma per label. Pattern noto e portabile su qualsiasi VM con Docker — nessun cluster. L'env del recorder è composta da un allowlist passthrough `RECORDER_ENV_*` (no CronJob template in compose).

Lo stesso operator, lo stesso loop, gli stessi label/naming deterministici: cambia solo il runner. In K8s lo spec del recorder (nodeSelector/tolerations/resources del pool **normale**, non GPU) viene da `values.yaml` (`recorder.*`) come CronJob sospeso; in compose viene dall'immagine + env. **Modalità ridotta**: chi non vuole il recorder lascia `recorder.enabled=false` (Helm) o non avvia il servizio controller (compose) — il resto della piattaforma funziona identico.

### Affidabilità
- Reconcile periodico = self-healing (push persi, pod riavviato, Job crashati).
- `activeDeadlineSeconds` = durata max evento; `ttlSecondsAfterFinished` per GC automatica.
- Il recorder ha già idle/max-duration timeout interni (esce da solo a fine evento → Job `Completed`).
- 1 replica + `leaderElection` non necessario a questa scala (Deployment con `Recreate`); la riconciliazione è idempotente quindi anche un doppio pod transitorio è sicuro.

### Stato implementazione
- ✅ Recorder bot: core cattura WebRTC, upload signed-URL, ingest allineato a `multitrack-manifest`, immagine CI. Unit-test verdi.
- ☐ `recorder-controller`: pacchetto + logica reconcile (diff desired/actual, **pura e unit-testabile**) → poi il glue K8s (`@kubernetes/client-node`) e l'HTTP server `/dispatch`.
- ☐ Portale: `recorder-desired`, `recorder-claim` (+ creazione Recording al claim + JWT bot + presign per-traccia), hook best-effort in `jvb-desired-replicas`.
- ☐ Helm: Deployment controller + RBAC + CronJob `recorder` sospeso (template) + sezione `recorder.*` in `values.yaml`.
- ⚠️ La cattura WebRTC e l'intera catena vanno validate **in-cluster contro Jitsi reale**: non sono E2E-testabili in locale. Procedere a incrementi, con `recorder.enabled=false` di default.

## Conseguenze

- Elimina il mapping manuale degli speaker e la dipendenza da pyannote per gli eventi con recorder multi-traccia; pyannote resta fallback per il mix.
- Overlap gestiti per costruzione.
- Nuovo servizio media da mantenere + superficie PII maggiore (mitigata da retention breve sulle tracce).
- Compatibilità: il transcript con segmenti sovrapposti richiede adeguamento di editor/VTT/summary-prompt.
- La **Fase 0** e la **Fase 1** danno valore e sono realizzabili/testabili senza l'infra del recorder: partire da lì.
