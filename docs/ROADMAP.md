# Roadmap — pa-webinar

Questo documento guarda avanti: cosa manca, in che ordine, e con quali limiti noti convive ciò che è già spedito. Le versioni rilasciate non sono elencate qui — stanno in [`CHANGELOG.md`](../CHANGELOG.md) e sulla pagina pubblica `/changelog`.

Dove una funzionalità è completa ma ha un confine che conviene conoscere prima di appoggiarcisi, il limite è scritto accanto.

## Cosa c'è già

Il changelog resta l'unica fonte di verità su cosa è stato rilasciato e quando (è **generato** dai dati di release, non riscritto a mano, e la pagina `/changelog` lo mostra tradotto in tutte le lingue del sito). Qui serve solo il perimetro attuale, per capire da dove parte quello che segue:

- registrazione partecipanti GDPR-compliant: PII cifrate, consensi granulari, retention e cleanup automatico (vedi [`GDPR.md`](GDPR.md))
- sala live con Jitsi Meet embeddato: JWT, ruoli enforced server-side, permessi audio/video per ruolo
- sala d'attesa con countdown, device check e accesso guest
- Q&A con upvote e moderazione, con archivio post-evento
- sondaggi live con risultati in tempo reale, e word cloud live
- chat in-app real-time (Postgres + Redis pub/sub + SSE) con allegati, menzioni e citazioni
- reazioni e coda delle mani alzate ordinata
- questionari pre/post evento e rubrica dei contatti con opt-in esplicito
- registrazione video (Jibri) su storage object-storage agnostico e libreria video pubblica
- post-produzione AI in-cluster: trascrizione con attribuzione degli speaker, sottotitoli multilingua, sintesi, doppiaggio (vedi [`POSTPROD.md`](POSTPROD.md))
- statistiche per evento: interazione nel tempo, chi ha parlato di più, attenzione, permanenza
- pannello admin: wizard di creazione, template di evento, site settings white-label, monitoraggio infrastruttura
- interfaccia in 24 lingue, italiano come default (ADR-008)
- trasparenza: pagina `/service-inventory` con inventario CycloneDX di componenti e servizi

## Da fare prima del rilascio pubblico

| Item | Stato |
|---|---|
| Smoke test su cluster Kubernetes reale | ✅ fatto (istanza in produzione con eventi reali) |
| Evento pilota interno | ✅ fatto |
| Ritocco testi e layout | ✅ in gran parte |
| Test E2E Playwright (batteria flussi critici) | 🟡 parziale (un solo file, `continue-on-error`) — vedi "Prossimo" |
| Screenshot per README | ✅ fatto — schermate reali dell'istanza in produzione in `docs/screenshots/`, referenziate da README, README.en e `publiccode.yml` |

Flussi critici Playwright ancora da coprire: login admin + creazione + pubblicazione evento, ingresso sala (moderatore + partecipante), Q&A (invio/upvote/moderazione), polling, cambio lingua senza reload, GDPR cleanup, download `.ics`, responsive mobile, chat in-app real-time multi-pod.

## Limiti noti dietro un ✅

Voci spedite e funzionanti, ognuna con un confine che vale la pena conoscere prima di appoggiarcisi.

| Sottosistema | Il limite |
|---|---|
| **Allegati in chat** | Capability-URL: la protezione è l'UUID non indovinabile + cancellazione del blob alla moderazione/retention, non un controllo d'accesso valutato a ogni richiesta. Un ACL vero — che rilegga lo stato vivo dell'evento — richiede un **cookie con ambito sulla rotta** (un `<img>` non manda header): è pianificato, vedi sotto |
| **Recorder multitraccia (ADR-013)** | Nessuna riconnessione dopo `CONFERENCE_FAILED`: una caduta a metà evento chiude la registrazione con quello che ha già catturato. L'errore finisce nei log del Job, non nel pannello admin |
| **Scale-to-zero JVB (ADR-007)** | `/colibri/stats` è aggregato per pod: due eventi LIVE sullo stesso bridge tengono acceso il nodepool anche se uno si è svuotato |
| **i18n a 24 lingue (ADR-008)** | Il fallback delle chiavi mancanti ricade sull'**italiano**, non sull'inglese |
| **Piazza della sala d'attesa** | Posizioni ed emote viaggiano sul ping di presenza, non su un canale push dedicato: gli altri le vedono con il tick successivo (l'animazione locale parte subito) |
| **Copertura dei test** | Concentrata su `lib/`: solo pochi handler API hanno test, la maggior parte delle route e dei componenti no (vedi la sezione seguente) |

## Copertura dei test — stato reale

La copertura per riga è misurata, non stimata (`npm run test:coverage --workspace=app`), ed è bassa perché il denominatore è tutto `src/**`: centinaia di route API e decine di migliaia di righe di componenti senza un test, contro una `lib/` coperta bene.

Le soglie vive stanno in `app/vitest.config.ts` e sono un **cricchetto sul pavimento misurato** — impediscono che la copertura scenda, non dichiarano che vada bene. In CI i test girano con `--coverage`, quindi una regressione di copertura fa fallire la build.

Si sale dai punti in cui vivono le guardie, non dai più facili: route di registrazione, webhook di registrazione video, rotte admin.

## Prossimo

| Feature | Note |
|---|---|
| **SSE per Q&A e pannelli live** | Oggi il polling è `useSWR(refreshInterval: 3000)` in tre punti: `qa/question-list.tsx`, `polls/poll-panel.tsx`, `live/agenda-panel.tsx`. Da sostituire riusando l'infra SSE già provata per la chat (scala a 300+) |
| **Eventi ricorrenti — chiudere il quick win** | `EventTemplate` non porta ancora `multitrackRecordingEnabled`, `retainParticipantTracks`, `aiTargetLocales`, `aiDubbingEnabled`, `wordCloudEnabled`; `duplicate` copia gli scalari e i reminder ma **non le relazioni** (tag, organizzatori, co-moderatori, agenda, questionari) |
| **Batteria E2E Playwright** | Oggi è un solo file (`app/e2e/live-flow.spec.ts`) con `continue-on-error` per i rate-limit del registry sul runner condiviso: non protegge da regressioni. Scoperti: Q&A, sondaggi, cambio lingua, cleanup GDPR, download `.ics`, chat SSE multi-pod, e il click reale su "Entra ora" (oggi l'ingresso è coperto solo via API) |

## Dopo

| Feature | Note |
|---|---|
| **ACL allegati chat (via cookie)** | Oggi gli allegati sono capability-URL (vedi "Limiti noti"). Il gate vero: la pagina live imposta un cookie httpOnly con ambito su `/api/assets/chat/<eventId>/`, rinnovato; la rotta lo rilegge e ri-autorizza con `authorizeChatRead` a OGNI richiesta, così una password aggiunta o un evento chiuso hanno effetto subito. Niente token nell'URL |
| **Export report PDF** | Statistiche evento + Q&A + poll + partecipanti in un documento scaricabile (naturale seguito della tab Statistiche) |
| **Rate-limiting distribuito (Redis)** | Il limiter è in-memory per-pod; con HPA multi-replica serve un contatore globale |
| **Ricerca full-text trascrizioni** | `tsvector` PostgreSQL per la libreria video (oggi solo ricerca client dentro una singola trascrizione) |
| **Tagging e capitoli video (live)** | Marker del moderatore durante l'evento → capitoli nel player (i capitoli AI esistono già; mancano quelli autoriali live) |
| **API pubblica documentata** | Lo spec OpenAPI 3.1 è già servito da `/api/openapi.json`; restano docs UI (Swagger/Redoc), garanzie di stabilità e storia auth |
| **Rigenerazione AI dopo edit trascrizione** | Rigenerare automaticamente traduzioni/dub quando un segmento viene corretto |

## Eventi ricorrenti / serie

Due casi tipici, con cadenze diverse: una **serie a cadenza fissa** (es. una call settimanale, giorno stabile ma data da confermare volta per volta) e una **serie a data mobile** (periodica, con l'occorrenza spesso riprogrammata di qualche giorno). Oggi ogni occorrenza si crea partendo dalla precedente (duplica → rimetti la data): il clone eredita la configurazione, ma la serie in sé non esiste come entità e la cadenza indicata nel wizard non viene consumata da nulla.

Cosa resta davvero aperto sul quick win: `EventTemplate` non porta ancora i flag di cattura/AI mancanti (`multitrackRecordingEnabled`, `retainParticipantTracks`, `aiTargetLocales`, `aiDubbingEnabled`, `wordCloudEnabled`) e `duplicate` copia gli scalari e i reminder ma non le relazioni (tag, organizzatori, co-moderatori, agenda, questionari).

**Idea portante** — una **Serie** possiede la configurazione canonica (flag di cattura/AI, retention, lingue, speaker attesi, permessi, descrizione, immagine) e **ogni occorrenza la eredita**: così i flag non possono più essere persi per dimenticanza. La cadenza è un *suggerimento*, non una schedulazione rigida: **occorrenze provvisorie** (bozza con data proiettata) che l'operatore **conferma / sposta / salta** — esattamente ciò che serve quando "le date non sono sempre confermate". Riprogrammare = spostare la data della singola occorrenza senza toccare la serie.

**Fasi:**

- **Quick win — bassa spesa, alto valore** — togliere i footgun senza ancora introdurre la Serie:
  - `EventTemplate` porta anche i flag mancanti (multitraccia, retain-tracks, lingue, dubbing, wordcloud).
  - `duplicate` copia anche le relazioni (tag, organizzatori, co-moderatori, agenda, questionari), non solo gli scalari e i reminder.
- **Serie vera e propria**:
  - Entità `EventSeries` (attiva `recurrenceSeriesId` + relazione): la serie è la source-of-truth della config; le occorrenze ereditano con override puntuale possibile.
  - **"Programma prossima occorrenza"**: materializza la prossima occorrenza in **bozza** con data proiettata dalla RRULE; l'operatore conferma (→ PUBLISHED) / sposta (occorrenza rimandata) / salta.
  - Reminder consapevoli della serie (per-occorrenza, non una tantum sul parent).
- **Post-prod e libreria per serie**:
  - Rollup: registrazioni/trascrizioni/recap di tutte le occorrenze di una serie in un'unica vista admin + una card "serie" in libreria (oggi ogni evento è una card isolata; `Recording` non ha chiave cross-evento).
  - **Auto-materializzazione** per le serie a cadenza fissa via CronJob che crea la prossima occorrenza provvisoria N giorni prima — sempre **confermabile prima di andare pubblica**, così un'occorrenza saltata non pubblica nulla per sbaglio.

Registrazione e post-prod restano **per-occorrenza** (ogni call è la sua `Recording` + pipeline AI): corretto e già funzionante. La serie aggiunge *ereditarietà della config* (i flag giusti sempre accesi) e *aggregazione della vista*, non cambia il modello di cattura.

## Visione

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
