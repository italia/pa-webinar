# multitrack-recorder

Servizio "multitrack recorder" di pa-webinar — **ADR-013, Fase 3**.

Un bot headless entra nella stanza Jitsi come partecipante **receive-only
invisibile**, si sottoscrive a **ogni traccia audio remota** e registra
**una traccia audio separata per partecipante** (Opus/WebM). A fine evento
carica le tracce + un manifest `tracks.json` allo storage e notifica il
portale via webhook.

Il worker di post-produzione (`infra/ai/worker/multitrack.py`, già fatto)
trascrive ogni traccia indipendentemente con WhisperX **senza pyannote** e
fonde i segmenti per timestamp: il risultato ha **nomi reali** (dal JWT del
portale) e **overlap nativi**, eliminando la "blind diarization".

> Leggi prima [`docs/adr/013-multitrack-speaker-attribution.md`](../../docs/adr/013-multitrack-speaker-attribution.md).

## Architettura

```
                 ┌──────────────────────────────────────────────┐
   JWT portale → │  multitrack-recorder (questo servizio)         │
   (displayName) │                                                │
                 │  capture.ts ──► N file .opus su OUTPUT_DIR      │  ← WebRTC, Chrome headless
                 │      │            (uno per partecipante)        │     RICHIEDE JITSI REALE
                 │      ▼                                          │
                 │  manifest.ts ─► tracks.json (puro, testato)     │
                 │      │                                          │
                 │      ▼                                          │
                 │  upload.ts ───► storage + webhook al portale    │
                 └──────────────────────────────────────────────┘
                                          │
                                          ▼
              storage: recordings/multitrack/{eventId}/{recordingId}/
                         audio/{participantId}.opus
                         tracks.json
                                          │
                                          ▼
              worker: infra/ai/worker/multitrack.py  (WhisperX per-traccia + merge)
```

### Moduli

| File | Ruolo | Testabile in unit? |
|------|-------|--------------------|
| `src/paths.ts` | naming/layout storage + sanitizzazione path | **Sì** (puro) |
| `src/manifest.ts` | costruzione `tracks.json`, offset/durate | **Sì** (puro) |
| `src/upload.ts` | astrazione storage, firma HMAC, payload webhook | **Sì** (puro + provider noop/mock) |
| `src/capture.ts` | **WebRTC / Chrome headless** — cattura tracce | **No** — richiede Jitsi reale |
| `src/index.ts` | entrypoint/orchestrazione (legge env, cabla i moduli) | smoke only |

La regola di design: **tutta la logica determinabile sta fuori da
`capture.ts`** (manifest, paths, offset, naming, upload, firma) ed è coperta
da test. `capture.ts` è l'unico modulo "sporco" e contiene solo
l'orchestrazione WebRTC.

## Scelta tecnica WebRTC: Chrome headless (Puppeteer), non `node-webrtc`/`werift`

Valutati due approcci per ricevere gli stream Jitsi e catturarli per-traccia:

1. **lib-jitsi-meet in un browser headless (Chrome + Puppeteer)** — SCELTA.
   `lib-jitsi-meet` è progettato per girare **in un browser**: usa API DOM e
   l'implementazione WebRTC del browser (simulcast, data channel, statistiche,
   `MediaStreamTrack`/`MediaRecorder`). Chrome headless ci dà **lo stesso
   stack WebRTC che gira in produzione** — è esattamente l'approccio di Jibri.
   La cattura per-traccia è naturale: per ogni traccia audio remota creiamo un
   `MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })`. Robusto
   fra gli upgrade Jitsi perché non reimplementiamo nulla del protocollo.

2. **`lib-jitsi-meet` su `node-webrtc`/`werift` (WebRTC puro in Node)** —
   SCARTATO. Eviterebbe Chrome (immagine più leggera) ma queste librerie
   **non implementano tutto lo stack** che lib-jitsi-meet si aspetta
   (simulcast, alcune API DOM, comportamenti edge dei data channel) e tendono
   a rompersi a ogni upgrade Jitsi. Avremmo dovuto fare shimming fragile.

Trade-off accettato: l'immagine porta Chrome (~pesante), come Jibri. In cambio
abbiamo affidabilità e parità col path di produzione.

> NB: `package.json` dichiara `puppeteer`. **Non** è stato eseguito
> `npm install` (vincolo del task): la connessione end-to-end va validata su
> un cluster con Jitsi reale.

## Variabili d'ambiente

Modello **claim**: l'operator passa solo gli id + come raggiungere il portale.
JWT bot e nome stanza arrivano dal `recorder-claim`; l'upload presigna ogni
traccia just-in-time via `recorder-upload-url`. Le credenziali non vivono
nell'operator né nello spec del Job/container.

| Variabile | Obbligatoria | Default | Descrizione |
|-----------|:---:|---------|-------------|
| `JITSI_DOMAIN` | ✅ | — | Dominio Jitsi (origin per lib-jitsi-meet). |
| `RECORDING_ID` | ✅ | — | Id registrazione (iniettato dall'operator; chiave del claim). |
| `EVENT_ID` | ✅ | — | Id evento (path storage). |
| `PORTAL_URL` | ✅ | — | Base URL interna del portale (claim, upload-url, ingest). |
| `CRON_API_KEY` | ✅ | — | Header `x-api-key` verso il portale. |
| `OUTPUT_DIR` | — | `/recordings` | Dir locale per le tracce prima dell'upload. |
| `JITSI_XMPP_USER` | — | — | Utente del bot sul dominio nascosto (o JID completo). Vedi sotto. |
| `JITSI_XMPP_DOMAIN` | — | — | Dominio nascosto di Prosody, es. `hidden.meet.jitsi`. |
| `JITSI_XMPP_PASSWORD` | — | — | Password del bot. |

### Perché il bot è invisibile (e come si rompe)

L'invisibilità non è un trucco lato interfaccia: è il meccanismo nativo di
Jitsi per i bot, lo stesso che usa Jibri.

Prosody ha un VirtualHost «nascosto» (`hidden.meet.jitsi` nell'immagine
standard). Ogni client jitsi-meet confronta il **dominio del JID reale** che
vede in presenza con `config.hiddenDomain`: se coincide, `lib-jitsi-meet`
marca il partecipante come *hidden* e l'applicazione lo scarta **a monte** —
non entra nello store, quindi niente riquadro, niente riga nell'elenco, niente
notifica di ingresso, e `membersCount` non lo conta. Nemmeno le statistiche di
chi parla lo vedono.

Con le tre variabili sopra il recorder si autentica lì (login SASL) invece che
col JWT del portale. **Senza**, entra col JWT sul dominio principale ed è un
partecipante come tutti gli altri: nasconderlo tocca poi a ogni client, ed è
esattamente il tipo di rattoppo che si rompe al primo aggiornamento di Jitsi.

Due condizioni sul lato Prosody, entrambe già previste dall'immagine standard:

1. l'account esiste (`ENABLE_RECORDING` lo crea, con `JIBRI_RECORDER_USER` /
   `JIBRI_RECORDER_PASSWORD`);
2. con l'autenticazione a token, il componente MUC deve avere una deroga per
   quell'account — altrimenti chi non presenta un token viene rifiutato:

   ```
   XMPP_MUC_CONFIGURATION: 'token_verification_allowlist = { "recorder@hidden.meet.jitsi" }'
   ```

   È la deroga che `mod_token_verification` prevede apposta («allowlist for
   participants, jigasi (sip & transcriber), jibri (recorder & sip)»). Va
   tenuta sul **singolo account**, non sull'intero dominio: chi ha quella
   password entra in qualunque stanza senza token.

Nel chart: `recorder.hiddenDomain` + `recorder.xmppSecretName`.

## Layout storage e manifest

```
recordings/multitrack/{eventId}/{recordingId}/
  audio/{participantId}.opus     # una traccia per partecipante
  tracks.json
```

`tracks.json` (shape concordato nell'ADR, prodotto da `manifest.ts`):

```jsonc
{
  "version": 1,
  "eventId": "...",
  "recordingId": "...",
  "roomName": "...",
  "recordingStartedAtMs": 1717250000000,
  "tracks": [
    {
      "participantId": "reg-<id>-ab12",  // endpoint id Jitsi
      "displayName": "Mario Rossi",        // PII IN CHIARO (vedi GDPR sotto)
      "trackKey": "recordings/multitrack/.../audio/reg-<id>-ab12.opus",
      "startOffsetMs": 0,
      "durationMs": 5000
    }
  ]
}
```

### GDPR — `displayName` in chiaro nel manifest

L'audio isolato del singolo parlante è dato personale ad alta sensibilità
(ADR-013, "Implicazioni GDPR"). Nel manifest il `displayName` è **in chiaro**
di proposito: il recorder **non possiede le chiavi PII** (minimizzazione). È
il **portale**, all'ingest, a cifrarlo at-rest — esattamente come fa già per
i partecipanti della `CallSession` (`encryptJSON` in
`app/src/app/api/webhooks/recording/route.ts`). Le tracce audio sono
**intermedie**: vanno cancellate subito dopo la trascrizione (retention breve,
volume `OUTPUT_DIR` effimero).

## Integrazione / deploy

Scale-with-events come Jibri: il portale/scaler avvia **un pod recorder per
evento attivo**, passando le env sopra (con un `JWT` emesso per il bot). A
fine evento il recorder fa upload + webhook ed esce (Job che termina, non
Deployment perenne). Non c'è UI: è un servizio media headless.

Punti d'innesto già esistenti riusati:
- formato JWT e `displayName`: `app/src/app/api/events/[param]/jitsi/token/route.ts`;
- pattern upload + webhook firmato: `infra/jitsi/jibri-finalize.sh`;
- ingest webhook + cifratura PII: `app/src/app/api/webhooks/recording/route.ts`.

## Sviluppo

```bash
cd infra/recorder/

# NB: npm install NON è stato eseguito (vincolo). Esegui localmente:
npm install

npm run typecheck     # tsc --noEmit
npm run test          # vitest run  (paths/manifest/upload — logica pura)
npm run build         # tsc → dist/
npm run dev           # tsx src/index.ts (richiede env + Jitsi reale)
```

## Cosa NON è testabile in locale

- **`src/capture.ts`** e l'intero flusso WebRTC end-to-end: richiedono un
  **Jitsi reale** (web + Prosody + Jicofo + JVB) a cui collegarsi con un JWT
  valido. `captureRoom()` oggi è scaffolding commentato che **lancia** se
  invocato senza l'implementazione Puppeteer collegata. La validazione va
  fatta su un cluster con Jitsi vero (come per Jibri).
- L'**upload reale** ai provider cloud (`azure-blob`/`s3`/`gcs`/`minio`) è un
  **TODO documentato** in `upload.ts`: oggi la factory ritorna un
  `NoopStorageProvider` (con warning) per non bloccare la Fase 3. Vanno
  implementati riusando le stesse env/bucket di `jibri-finalize.sh`.

Tutto il resto (manifest, paths, offset/durate, firma HMAC, payload webhook,
provider noop) è **unit-testato** e gira senza alcuna infrastruttura.
```
