# Roadmap — eventi-dtd

Allineata al 2026-04-24. Le versioni spedite sono riassunte in forma compatta; le voci pianificate mantengono nota/effort dove utile.

## v0.1.0 — MVP ✅

Core platform:

- Layout PA con design system .italia (Bootstrap Italia, design-react-kit)
- Admin panel con autenticazione API key
- CRUD eventi (con modifica e notifica cambio data)
- Registrazione partecipanti GDPR-compliant (PII cifrate AES-256-GCM)
- Sala live con Jitsi Meet (IFrame API, JWT auth)
- Ruoli Jitsi enforced server-side (plugin Prosody custom)
- Controlli AV per evento (mic/video/screen share per ruolo) + AV Moderation live
- Q&A con upvote, moderazione, persistenza post-evento
- Sala d'attesa con countdown, pre-join screen, accesso guest
- Email conferma/reminder, integrazione calendario (Google, Outlook, Yahoo, iCal)
- GDPR cleanup cron, metriche Prometheus
- Helm chart production-grade, Docker non-root/read-only, CI/CD GitHub Actions, publiccode.yml

## v0.2.0 — Feedback DTD ✅

- Profilazione partecipanti in registrazione (ente, ruolo, tipologia — configurabili per evento, export CSV, statistiche aggregate)
- Reminder configurabili (modello `EventReminder`, N offsets, email differenziate)
- Consolidamento ruoli Moderatore / Auditore (UI e permessi distinti)
- GDPR improvements: privacy policy per evento (URL o rich text), retention UI chiara, audit log cancellazioni, consensi granulari (partecipazione / registrazione video / comunicazioni), export dati Art.15
- Reaction Jitsi native riabilitate
- Polling/sondaggi (modelli `Poll`/`PollVote`, risultati real-time, export CSV)
- Gestione materiali sessione (link in v0.2; file in v0.5+)
- Audit licenze dipendenze (`license-report`, compatibilità EUPL-1.2, step CI)
- Miglioramento grafica iframe Jitsi (branding config, watermark)

## v0.3.0 — Platform ✅ (tag v0.3.7)

- Site settings (PA reuse, zero hardcoding: branding, colori, favicon, SEO, footer, home mode, privacy/accessibilità)
- Dashboard analytics
- Pannello admin infrastruttura
- 3 modalità deploy Helm (simple / standard / full)
- JVB scale-to-zero con CronJob (nodepool dedicato, autoscaler min=0)
- Jibri pipeline multi-cloud (Azure Blob / S3 / GCS / MinIO / local)
- Watermark Jitsi configurabile
- 210+ test unitari Vitest
- Error handling centralizzato, migrations formali, caching, rate limiting
- OpenSSF Scorecard, Dependabot, SBOM dipendenze (`sbomLatest`)

### v0.3.x — Incrementi post-v0.3.7 ✅

Rilasciati tra v0.3.8 e v0.3.44, a seguito del feedback post-demo 2026-04-16.

- **Hotfix 2026-04-16**
  - Lista mani alzate ordinata FIFO + mappatura `jitsi-participant-id → registration.displayName`
  - Moderatori multipli con mute-all (permessi JWT/Prosody legati al ruolo, non alla sessione)
  - Magic-link moderatore: display name non pre-popolato in pre-join
- **Breadcrumb admin + public** (componente `AdminBreadcrumb` su ogni pagina)
- **Password opzionale per call** (gating su join page, utile per instant call privata)
- **Multi-moderator magic links** (modello `EventModerator` — token individuale, nome, email, revoca granulare)
- **Chat in-app real-time** — v0.3.43 (Postgres + Redis pub/sub + SSE; sostituisce chat XMPP Jitsi; late-join, archivio, audit, rate-limit server-side; subchart Bitnami `redis` standalone)
- **Storage provider agnostico** — v0.3.44 (interfaccia `StorageProvider` + adapter `azure` e `s3`; copre AWS S3, MinIO path-style, Cloudflare R2, GCS HMAC, Wasabi, PSN on-prem)
- **Autoscaling orizzontale app multi-nodo** — HPA `autoscaling/v2` (min 2 / max 6 pod, target 70% CPU). Fan-out Redis pub/sub della chat SSE rende l'app pronta a girare su più pod/nodi senza sticky session. Lato video: cluster autoscaler AKS su nodepool JVB dedicato (ADR-007)

## v0.4.0 — Engagement & Lifecycle ✅ (corrente)

- Feedback post-evento
- Word cloud live
- Presentation timer
- Reaction counter
- Video player con speed controls
- Diagramma configurazione evento (topology SVG)
- Sala d'attesa ridisegnata (3 scenari: early / countdown / started)
- Catch-up ritardatari
- Recording lifecycle (temporanea → pubblicata, retention differenziata)
- Admin recording management (preview, pubblica, elimina)
- Post-event page con tabs (recording, Q&A archive, poll results, feedback, materiali)
- Post-event config per admin (cosa esporre e quando)
- GDPR cleanup 3 fasi (immediate PII / retention content / hard delete)
- **Two-phase JVB autoscaling** (Redis snapshot per status page; skip LIVE→IDLE quando replicas > 1 per evitare race su `/colibri/stats` multi-pod)
- **Libreria video pubblica** `/video-library` — filtri per data/argomento/tipo, import YouTube per legacy, nuove registrazioni Jibri pubblicate automaticamente
- **Trasparenza `/service-inventory`** — CycloneDX 1.6 per-tenant (DEV: npm+OCI; OPS: servizi Azure/AKS/Postgres/Blob/GHCR/Mailgun/coturn/…); `components[]` + `services[]` + `declarations[]` + `compositions[]` + `vulnerabilities[]` (VEX-ready) + `formulation[]` + `annotations[]`; stack diagram "Architettura in breve" data-driven da property `eventi-dtd:layer`/`stack-label`; artefatto per-tenant servito via `SERVICE_INVENTORY_URL` (file locale su test, Blob pubblico su prod). Reference implementation per OPS half: CronJob AKS + Azure Resource Graph + Workload Identity → upload Blob (`infra/service-inventory/azure/`)
- Footer build-date con HH:MM UTC
- **5-step event wizard** ✅ — creazione/edit evento in 5 step (Base, Permessi, Inviti, Contenuti, Revisione) con stato condiviso `WizardForm`; sostituisce il form monolitico precedente (`app/src/components/admin/event-wizard/`)
- **Title-kicker (pipe split)** ✅ — `SiteSetting.parseTitleKicker` + override per-evento `Event.parseTitleKicker`; rendering editoriale di titoli tipo `Serie | Episodio` con kicker + titolo principale
- **Tag taxonomy** ✅ — modelli `Tag` + `EventTagLink`, CRUD admin in `/admin/settings/tags`, filtri pubblici `/eventi?tag=<slug>`, tag chips su lista/detail/admin
- **Rubrica (Person)** ✅ — modello `Person` (emailHash, opt-in esplicito separato, retention inactivity-based), RubricaPicker multi-select nel wizard (step Inviti), pagina admin `/admin/rubrica`, opt-out via signed HMAC token in `src/lib/persons/opt-out-token.ts` (vedi ADR-011)
- **Auto-start recording** ✅ — flag `autoStartRecording` per-evento (+ template), Jibri viene avviato automaticamente all'ingresso del primo moderatore
- **Waiting-room unificata** ✅ — front-door unica per guest / partecipante / moderatore (`app/src/components/live/waiting-room.tsx`): email opzionale, name gate, device check (cam/mic toggle + chime test altoparlante), chat preview, netiquette, countdown, catch-up recording
- **Guest Q&A** ✅ — `Question.registrationId` nullable; i guest (senza Registration) possono porre domande durante eventi open-attendance
- **Meet-style live controls** ✅ — floating bar sopra il video (desktop), bottom tab strip (<992px mobile), drawer per Q&A/Chat/Polls/Materials/Participants (`app/src/components/live/live-event-client.tsx`)
- **RaisedHandsPanel read-only** ✅ — coda mani alzate ordinata FIFO visibile a tutti; i moderatori mantengono i controlli approve-mic/video
- **Screenshare banner** ✅ — banner arancione quando un partecipante remoto inizia a condividere lo schermo
- **CallSession always-on** ✅ — ogni evento live produce una `CallSession` anche senza recording, aperta al primo `videoConferenceJoined` via `POST /api/events/:slug/sessions` e chiusa dallo scaler su `LIVE→IDLE` / `*→ENDED`

## Da fare prima del rilascio pubblico

| Item | Effort |
|---|---|
| Ritocco testi e layout | 1 giorno |
| Test E2E Playwright (flussi critici) | 2-3 giorni |
| Smoke test su AKS reale | 1 giorno |
| Screenshot per README | 0.5 giorni |
| Evento pilota interno DTD | 1 giorno |

Flussi critici Playwright: registrazione con campi ente, login admin + creazione + pubblicazione evento, ingresso sala (moderatore + partecipante), Q&A (invio/upvote/moderazione), polling (creazione/voto/risultati), cambio lingua senza reload, GDPR cleanup, download `.ics`, responsive mobile, chat in-app real-time multi-pod.

## v0.5.0 — Pianificata

| Feature | Note |
|---|---|
| **HLS live streaming** | Audience passiva illimitata senza caricare JVB. Jibri → RTMP → ffmpeg HLS → Blob → player |
| **Ruolo Relatore (speaker)** | Mic/video/share senza poteri admin. Intermedio tra moderatore e partecipante |
| **Breakout rooms** | Sottogruppi durante l'evento — Jitsi nativo, da esporre nella UI |
| **Servizio AI — trascrizioni, sottotitoli, sintesi** 🟡 in corso | Modulo `lib/ai/` con provider in-cluster (vincolo sovranità: niente API esterne). MVP+V1 spediti: trascrizione post-evento (WhisperX + pyannote 3.1) con speaker attribution, sintesi "verbale PA" via vLLM Qwen3-32B in-cluster, traduzione EN/FR per transcript + summary, sottotitoli WebVTT multilingua nel player. Coda Postgres-outbox; orchestrator CronJob + GPU node pool (Italy North NC24ads_A100_v4) scale-to-zero. Vedi [`docs/POSTPROD.md`](POSTPROD.md). Pendenti: sottotitoli live (v1.0.0), wizard integration, post-event tab |
| **Questionari pre e post evento — fase A** ✅ (spedita) | Modelli `QuestionTemplate`, `QuestionItem` (single/multi/yes_no/likert/open_text), `EventQuestionnaire` con placement `pre_registration` o `post_event`, `QuestionnaireResponse` + `QuestionnaireAnswer`. Admin: `/admin/questionnaires` per gestire template riusabili + sezione nel wizard (step 4 Contenuti) per collegare template e aggiungere domande ad hoc. Dashboard risposte in `/admin/questionnaires` con filtri. Nessuna identità cross-evento: risposte legate alla registrazione, scadono con retention evento |
| **Rubrica + identità Persona — fase B** ✅ (spedita) | ADR-011 (`docs/adr/011-person-rubrica.md`). Modello `Person` distinto da `Registration`: identità minima (emailHash, displayName, organization, role) con opt-in esplicito separato. Admin: `/admin/rubrica` (lista persone, dettaglio, export), RubricaPicker nel wizard (step Inviti) per inviti multi-select. Opt-out via signed HMAC token (`src/lib/persons/opt-out-token.ts`), cron retention per inattività (`/api/cron/rubrica-retention`, default 24 mesi) |
| **Upload file nei materiali** | Attualmente solo link — upload diretto via `StorageProvider` (Azure Blob / S3 / …) |
| **Upload immagine evento** | Cover image tramite storage provider invece di URL esterno |
| **Automazione OPS service-inventory su prod** | Applicare CronJob `infra/service-inventory/azure/` su tenant produttivo, flippare `SERVICE_INVENTORY_URL` al Blob pubblico; runbook in `docs/SERVICE-INVENTORY-GENERATION.md` |
| **HA Redis / migrazione Valkey** | Solo se si introduce una feature con Redis in path critico (rate-limit distribuito, cache sessione). `architecture: replication` 1+2+3-sentinel. Cost ~3× |

## v0.6.0 — Futura

| Feature | Note |
|---|---|
| **SPID/CIE** | Autenticazione partecipanti con identità digitale italiana |
| **Microsoft Graph API** | Outlook RSVP → auto-registrazione, Teams calendar sync |
| **Export report PDF** | Statistiche evento, Q&A, poll, partecipanti — documento scaricabile |
| **Tagging e capitoli video** | Moderatore aggiunge marker durante evento → capitoli nel player |
| **Offuscamento video** | Volti/voci offuscati prima della pubblicazione (GDPR-by-design) |
| **SSE/WebSocket per Q&A** | Sostituire polling 3s per scalare a 300+ utenti |
| **Redis per rate-limiting distribuito** | Necessario se HPA multi-replica attivo |
| **Editor trascrizione post-evento** | Timeline + waveform + speaker reassignment + export WebVTT/SRT; si appoggia al servizio AI di v0.5.0 |
| **Ricerca full-text trascrizioni** | PostgreSQL `tsvector` sufficiente per volumi previsti |
| **Questionario AI-assisted** | Pre-compilazione automatica del questionario post-evento dai temi emersi nella trascrizione (richiede servizio AI + modello `EventQuestionnaire` di v0.5.0) |

## v1.0.0 — Visione

| Feature | Note |
|---|---|
| **Multi-tenancy** | Più enti sullo stesso portale con branding separato |
| **App mobile** | React Native con Jitsi SDK |
| **Registrazione multi-camera** | Speaker + slide separati |
| **Live subtitles** | Sottotitoli in tempo reale (Jigasi + Whisper streaming) |
| **Marketplace template eventi** | Webinar, workshop, conferenza, Q&A session |
| **API pubblica documentata** | OpenAPI spec per integrazioni di terze parti |
| **Dashboard Grafana** | Template dashboard per monitoring operativo |
| **Runbook operativo** | Guida on-call per troubleshooting produzione |

## Contribuire

Vedi [CONTRIBUTING.md](../CONTRIBUTING.md) per come proporre nuove funzionalità o segnalare bug.
