# Roadmap — pa-webinar

Allineata al 2026-07-11. In produzione: **v0.7.1** (v0.8.0 in corso). Le versioni spedite sono riassunte in forma compatta; le voci pianificate sono ri-organizzate in bucket realistici (v0.8 / v0.9 / v1.0 / backlog) rispetto allo stato attuale del codice.

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
- **Trasparenza `/service-inventory`** — CycloneDX 1.6 per-tenant (DEV: npm+OCI; OPS: servizi Azure/AKS/Postgres/Blob/GHCR/Mailgun/coturn/…); `components[]` + `services[]` + `declarations[]` + `compositions[]` + `vulnerabilities[]` (VEX-ready) + `formulation[]` + `annotations[]`; stack diagram "Architettura in breve" data-driven da property `pa-webinar:layer`/`stack-label`; artefatto per-tenant servito via `SERVICE_INVENTORY_URL` (file locale su test, Blob pubblico su prod). Reference implementation per OPS half: CronJob AKS + Azure Resource Graph + Workload Identity → upload Blob (`infra/service-inventory/azure/`)
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

## v0.5.0 – v0.7.x — Spedite ✅

Rilasciate in produzione tra v0.5 e v0.7.1. Voci che le versioni precedenti di questa roadmap elencavano ancora come "pianificate/in corso" ma che sono **live**:

- **Servizio AI post-evento** ✅ — pipeline in-cluster (vincolo sovranità, nessuna API esterna): trascrizione WhisperX + speaker attribution (pyannote 3.1), sintesi "verbale PA" (vLLM Qwen3-32B), traduzione EN/FR di transcript + sintesi, **sottotitoli WebVTT multilingua nel player**, dubbing (Piper). Coda Postgres-outbox + orchestrator CronJob + GPU nodepool A100 scale-to-zero. Vedi [`docs/POSTPROD.md`](POSTPROD.md)
- **Editor trascrizione post-evento** ✅ — correzione testo + riassegnazione speaker per segmento, **timeline + waveform** (`WAVEFORM_JSON`), export WebVTT/SRT/TXT. (Resta: rigenerazione automatica di traduzioni/dub dopo un edit → v0.9)
- **Recorder multi-traccia (ADR-013)** ✅ — cattura audio per-partecipante per speaker attribution reale; **metrica di affidabilità** dell'elaborazione AI nel pannello admin (v0.6.9)
- **Roster relatori editabile + player solo-audio** ✅ (v0.7.0) — rinomina degli speaker riconosciuti; se manca il video, player solo-audio per correggere testo/speaker
- **Ruolo Relatore (SPEAKER)** ✅ — `EventModeratorRole.SPEAKER`: mic/camera/share senza poteri di moderazione, cablato nel JWT Jitsi
- **Questionari pre/post evento** ✅ e **Rubrica/Person** ✅ — vedi v0.4 (fase A/B completate)
- **Upload materiali (FILE) + immagine cover evento** ✅ — upload diretto via `StorageProvider` (non più solo link/URL esterni)
- **Statistiche post-evento** ✅ (v0.7.1) — tab "Statistiche" per evento: andamento interazione nel tempo (picco), classifica di chi ha parlato di più, grado di attenzione, **alzate di mano**, **reazioni**, **permanenza media** (dwell/retention). Route admin + `lib/analytics` puro
- **Dashboard Grafana** ✅ — template `infra/grafana/pa-webinar-dashboard.json` deployabile via Helm, su metriche prom-client
- **Trasparenza service-inventory su prod** ✅ — pubblicata via ConfigMap + `SERVICE_INVENTORY_URL` relativo (l'automazione Azure CronJob → Blob pubblico resta opzionale)
- **Changelog pubblico** ✅ — `/changelog` allineato alle release, evidenzia la "Versione attuale"

## Da fare prima del rilascio pubblico

| Item | Stato |
|---|---|
| Smoke test su AKS reale | ✅ fatto (prod live con eventi reali) |
| Evento pilota interno DTD | ✅ fatto (Caffettino + eventi v0.6/v0.7) |
| Ritocco testi e layout | ✅ in gran parte (passaggi UX v0.6.x) |
| Test E2E Playwright (batteria flussi critici) | 🟡 parziale (solo smoke waiting-room/registrazione) → **v0.8** |
| Screenshot per README | ❌ da fare → **v0.8** |

Flussi critici Playwright ancora da coprire: login admin + creazione + pubblicazione evento, ingresso sala (moderatore + partecipante), Q&A (invio/upvote/moderazione), polling, cambio lingua senza reload, GDPR cleanup, download `.ics`, responsive mobile, chat in-app real-time multi-pod.

## v0.8.0 — In corso / prossima

| Feature | Note |
|---|---|
| **Upload completi + hardening** 🟢 in corso | Upload immagini ovunque (logo/favicon/OG/watermark/organizzatore), materiali salvati come `FILE` con `blobPath` (sblocca il cleanup dei blob), hardening sicurezza (nosniff + `Content-Disposition` sul serving, sniff magic-byte, rate-limit, pre-check `Content-Length`), fix `DELETE` recording/session sul dominio storage corretto |
| **Allegati in chat (F16)** 🟢 in corso | Upload allegati (immagini/documenti) in chat live: gating a soli utenti autenticati (no guest anonimi), allowlist MIME stretta + size + rate-limit dedicati, rotta di moderazione (`hiddenAt` + `op:'delete'` già previsti nell'envelope), serving con accesso controllato, cleanup blob in retention |
| **Chat: @menziona + rispondi/quote** 🟢 in corso | `@nome` con autocomplete dalla roster + rendering evidenziato; `replyToId` con citazione dello snippet del messaggio padre |
| **SSE/WebSocket per Q&A** | Sostituire il polling SWR 3s riusando l'infra SSE già provata per la chat (scala a 300+) |
| **Batteria E2E Playwright** + **screenshot README** | Chiudere i requisiti pre-rilascio pubblico |

## v0.9.0 — Pianificata

| Feature | Note |
|---|---|
| **Export report PDF** | Statistiche evento + Q&A + poll + partecipanti in un documento scaricabile (naturale seguito della tab Statistiche) |
| **Rate-limiting distribuito (Redis)** | Il limiter è in-memory per-pod; con HPA multi-replica serve un contatore globale |
| **Ricerca full-text trascrizioni** | `tsvector` PostgreSQL per la libreria video (oggi solo ricerca client dentro una singola trascrizione) |
| **Tagging e capitoli video (live)** | Marker del moderatore durante l'evento → capitoli nel player (i capitoli AI esistono già; mancano quelli autoriali live) |
| **API pubblica documentata** | Lo spec OpenAPI 3.1 è già servito da `/api/openapi.json`; restano docs UI (Swagger/Redoc), garanzie di stabilità e storia auth |
| **Rigenerazione AI dopo edit trascrizione** | Rigenerare automaticamente traduzioni/dub quando un segmento viene corretto |

## v1.0.0 — Visione

| Feature | Note |
|---|---|
| **Sottotitoli live** | Real-time (Jigasi + Whisper streaming). Oggi i sottotitoli sono solo post-evento (WebVTT) per scelta |
| **Multi-tenancy** | Più enti su un unico portale con branding separato (oggi: white-label singola istanza via `SiteSetting` + deploy separati per tenant) |
| **Questionario AI-assisted** | Pre-compilazione del questionario post-evento dai temi della trascrizione (prerequisiti — AI + questionari — già presenti) |
| **Runbook operativo on-call** | Guida consolidata di troubleshooting produzione (oggi frammenti in DEPLOYMENT/POSTPROD) |

## Backlog / condizionale

Voci reali ma non pianificate a breve (grandi, di nicchia, o attivate solo da un trigger):

- **SPID/CIE** — autenticazione partecipanti con identità digitale italiana
- **Microsoft Graph API** — Outlook RSVP → auto-registrazione, sync calendario Teams
- **Breakout rooms** — sottogruppi (Jitsi nativo oggi *disabilitato*, non esposto)
- **Offuscamento video** — blur volti/voci pre-pubblicazione (GDPR-by-design)
- **HLS live streaming** — audience passiva illimitata senza caricare JVB (Jibri → RTMP → HLS → Blob → player)
- **App mobile** — React Native + Jitsi SDK (oggi: web responsive)
- **Registrazione multi-camera** — speaker + slide separati (il multi-traccia attuale è audio per attribution)
- **Marketplace template eventi** — catalogo condivisibile cross-PA (oggi: template interni riusabili)
- **HA Redis / migrazione Valkey** — solo se Redis entra in un path critico (rate-limit distribuito, cache sessione)

## Contribuire

Vedi [CONTRIBUTING.md](../CONTRIBUTING.md) per come proporre nuove funzionalità o segnalare bug.
