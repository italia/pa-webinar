# Roadmap — eventi-dtd

## v0.1.0 — MVP ✅ (rilasciato)

- [x] Layout PA con design system .italia (Bootstrap Italia, design-react-kit)
- [x] Admin panel con autenticazione API key
- [x] CRUD eventi con modifica e notifica cambio data
- [x] Registrazione partecipanti GDPR-compliant (PII cifrati AES-256-GCM)
- [x] Sala live con Jitsi Meet (IFrame API, JWT auth)
- [x] Ruoli Jitsi enforced server-side (plugin Prosody custom)
- [x] Controlli AV per evento (mic/video/screen share per ruolo)
- [x] AV Moderation live (moderatore approva unmute)
- [x] Q&A con upvote, moderazione, persistenza post-evento
- [x] Chat Jitsi nativa
- [x] Sala d'attesa con countdown e musica
- [x] Pre-join screen con override nome
- [x] Accesso guest senza registrazione
- [x] Email conferma, reminder, notifica cambio data
- [x] Integrazione calendario (Google, Outlook, Yahoo, iCal)
- [x] Landing page
- [x] GDPR cleanup cron automatico
- [x] Metriche Prometheus
- [x] Helm chart production-grade
- [x] Docker production-ready (non-root, read-only)
- [x] CI/CD GitHub Actions
- [x] publiccode.yml

## v0.2.0 — Feedback DTD (in sviluppo)

### 2.1 — Profilazione partecipanti in fase di registrazione
**Priorità**: Alta
**Effort**: 1-2 giorni

Il form di registrazione deve raccogliere informazioni aggiuntive per categorizzare i partecipanti. Campi aggiuntivi:

- **Ente di appartenenza** (obbligatorio per eventi PA): testo libero con autocomplete dalle risposte precedenti (es. "AGID", "Ministero dell'Economia", "Comune di Roma"). Salva come campo `organization` nella registrazione.
- **Ruolo nell'ente** (opzionale): testo libero (es. "Responsabile Transizione Digitale", "Sviluppatore", "Dirigente").
- **Tipologia ente** (opzionale): select con opzioni predefinite: Ministero, Agenzia, Regione, Provincia, Comune, ASL, Università, Ente pubblico non economico, Società in-house, Altro.

Questi campi sono **configurabili per evento** dall'admin: il moderatore sceglie quali campi richiedere (obbligatori, opzionali, nascosti).

**Backoffice**: nella pagina gestione evento, le registrazioni mostrano i nuovi campi. Aggiungere:
- Filtro/raggruppamento per ente e tipologia
- Export CSV con tutti i campi
- Statistiche aggregate: "42% Comuni, 25% Ministeri, 15% Regioni..."

**GDPR**: i nuovi campi seguono la stessa retention dell'evento. Aggiungere al consenso: "I dati relativi all'ente di appartenenza saranno trattati ai fini statistici."

### 2.2 — Reminder configurabili
**Priorità**: Alta
**Effort**: 1 giorno

Attualmente il reminder è fisso a 1 ora prima. Renderlo configurabile:

- Nella creazione evento, sezione "Notifiche":
  - **Primo reminder**: X giorni/ore prima (default: 1 giorno)
  - **Secondo reminder**: X ore/minuti prima (default: 1 ora)
  - **Terzo reminder**: X minuti prima (opzionale, es. 15 minuti)
- Ogni reminder è un record nel DB con `scheduledAt` calcolato da `event.startsAt - offset`
- Il cron job controlla i reminder non ancora inviati con `scheduledAt <= NOW()`
- Email differenziate: "L'evento inizia domani" / "L'evento inizia tra 1 ora" / "L'evento inizia tra 15 minuti"
- Possibilità di aggiungere reminder personalizzati dall'admin

Schema DB: nuovo modello `EventReminder`:

```
EventReminder
├── id: UUID
├── eventId: FK → Event
├── offsetMinutes: Int (es. 1440 = 1 giorno, 60 = 1 ora, 15 = 15 min)
├── subject: String (template email)
├── sentAt: DateTime? (null se non ancora inviato)
├── createdAt: DateTime
```

### 2.3 — Gestione ruoli: Moderatore e Auditore
**Priorità**: Alta
**Effort**: 1-2 giorni

Due ruoli confermati per la v0.2.0:

**Moderatore** (già implementato):
- Gestisce l'evento (crea, modifica, pubblica)
- Controlla la sala (mute all, AV moderation, registrazione, termina)
- Gestisce Q&A (evidenzia, risponde, scarta)
- Può condividere schermo e attivare mic/video sempre
- Accesso tramite magic link con `moderatorToken`

**Auditore** (partecipante, già parzialmente implementato):
- Si registra all'evento
- Può vedere il video e ascoltare l'audio
- Può scrivere in chat e Q&A
- Mic/video/screen share controllati dalle impostazioni evento
- Alza la mano per chiedere la parola → moderatore approva
- Accesso tramite link di registrazione (`accessToken`)

Per la v0.2.0, il focus è consolidare questi due ruoli assicurando che:
- L'interfaccia sia chiaramente diversa per i due ruoli
- Il pannello moderatore sia visibile solo ai moderatori
- Le azioni disponibili nel pannello partecipante siano limitate e chiare
- La lista partecipanti mostri i ruoli (badge "Moderatore" / "Partecipante")

> **Possibile evoluzione v0.3.0**: Relatore (speaker) — un ruolo intermedio tra moderatore e auditore. Il relatore può attivare mic/video/screen share ma non gestire l'evento. Utile per eventi con panel di speaker esterni.

### 2.4 — Privacy policy e GDPR: retention e dati sensibili
**Priorità**: Alta
**Effort**: 1 giorno

Miglioramenti GDPR richiesti:

- **Privacy policy per evento**: ogni evento può avere la propria informativa privacy (già c'è il campo URL). Aggiungere la possibilità di scrivere il testo direttamente nell'admin (campo rich text) come alternativa all'URL esterno.
- **Retention configurabile con UI chiara**: nella creazione evento, mostrare chiaramente cosa viene cancellato e quando:

  ```
  Dopo 30 giorni dalla fine dell'evento verranno eliminati:
  ☑ Dati dei partecipanti (nome, email, ente)
  ☑ Domande Q&A e upvote
  ☑ Registrazioni video
  ☐ Statistiche aggregate (mantenute indefinitamente)
  ```

- **Audit log GDPR**: registrare tutte le operazioni di cancellazione dati in un log separato (quando, quanti record, quale evento). Non contiene PII — solo conteggi e ID evento.
- **Consensi granulari**: separare il consenso per:
  1. Trattamento dati per partecipazione (obbligatorio)
  2. Registrazione video (se abilitata)
  3. Comunicazioni post-evento (opzionale — es. "Vuoi ricevere informazioni su eventi futuri?")
- **Data export**: endpoint API per export dati personali di un partecipante (Art. 15 GDPR — diritto di accesso). L'utente fornisce la propria email, il sistema restituisce tutti i dati associati.

### 2.5 — Reaction nella videocall
**Priorità**: Media
**Effort**: 0.5 giorni

Jitsi ha le reaction native (emoji) — le avevamo disabilitate con `disableReactions: true`.

- Riabilitare le reaction in configOverwrite: `disableReactions: false`
- Aggiungere `'reactions'` ai toolbar buttons (sia base che moderatore)
- Le reaction Jitsi mostrano emoji fluttuanti sullo schermo (👏 😂 ❤️ 🎉 😮 👍)
- Non richiedono codice custom — sono completamente native

Opzionale: aggiungere un pulsante di reaction anche nella nostra barra top (fuori dall'iframe) che chiama `api.executeCommand('sendEndpointTextMessage', ...)` — ma le reaction native sono sufficienti.

### 2.6 — Polling/sondaggi
**Priorità**: Alta
**Effort**: 2-3 giorni

Sistema di sondaggi integrato (simile al Q&A ma con risposte predefinite):

**Durante l'evento:**
- Il moderatore crea un poll dal pannello moderatore: domanda + 2-6 opzioni di risposta
- Il poll appare a tutti i partecipanti nella sidebar (sotto o sopra il Q&A)
- I partecipanti votano (una sola volta per poll)
- Risultati in tempo reale visibili al moderatore (grafico a barre)
- Il moderatore può: mostrare i risultati a tutti, chiudere il voto, eliminare il poll

**Dopo l'evento:**
- I risultati dei poll sono persistiti nel DB
- Visibili nella pagina post-evento insieme alle Q&A risposte
- Esportabili in CSV dall'admin (domanda, opzioni, conteggi, percentuali)

Schema DB:

```
Poll
├── id: UUID
├── eventId: FK → Event
├── question: String (max 300 chars)
├── options: JSON (array di stringhe)
├── status: OPEN | CLOSED | PUBLISHED (risultati visibili a tutti)
├── createdAt: DateTime
├── closedAt: DateTime?

PollVote
├── id: UUID
├── pollId: FK → Poll
├── registrationId: FK → Registration (null per guest)
├── guestId: String? (per guest senza registrazione)
├── optionIndex: Int (0-based index dell'opzione scelta)
├── createdAt: DateTime
    UNIQUE(pollId, registrationId) — un voto per partecipante
    UNIQUE(pollId, guestId) — un voto per guest
```

API:
- `POST /api/events/[slug]/polls` — crea poll (moderatore)
- `GET /api/events/[slug]/polls` — lista poll (tutti)
- `POST /api/events/[slug]/polls/[id]/vote` — vota (partecipante/guest)
- `PATCH /api/events/[slug]/polls/[id]` — chiudi/pubblica risultati (moderatore)
- `DELETE /api/events/[slug]/polls/[id]` — elimina poll (moderatore)

### 2.7 — Gestione documenti sessione
**Priorità**: Alta
**Effort**: 1-2 giorni

Sidebar o sezione per condividere materiali durante l'evento:

- Il moderatore può aggiungere link e descrizioni durante l'evento
- I partecipanti vedono la lista dei materiali condivisi
- Tipi supportati:
  - **Link**: URL + titolo + descrizione breve
  - **File (v0.3.0)**: upload diretto su Azure Blob (slide PDF, documenti)
- I materiali restano visibili nella pagina post-evento
- Esportabili dall'admin

Schema DB:

```
EventMaterial
├── id: UUID
├── eventId: FK → Event
├── type: LINK | FILE
├── title: String
├── url: String
├── description: String?
├── addedBy: String (nome del moderatore)
├── createdAt: DateTime
```

UI:
- Tab "Materiali" nella sidebar live (accanto a Q&A)
- Moderatore: form per aggiungere link (titolo + URL + descrizione)
- Partecipante: lista read-only dei materiali
- Icone per tipo (link esterno, PDF, documento)

### 2.8 — Audit licenze dipendenze
**Priorità**: Alta
**Effort**: 0.5 giorni

Creare trasparenza sulle licenze di tutte le librerie utilizzate:

- Generare un file `THIRD-PARTY-LICENSES.md` con tutte le dipendenze, le loro licenze e gli URL
- Usare `license-checker` o `license-report` per generare automaticamente la lista
- Verificare compatibilità con EUPL-1.2 (la nostra licenza)
- Aggiungere una sezione nel README che riferisce al file licenze
- Aggiungere uno step nella CI che verifica che nessuna dipendenza nuova abbia una licenza incompatibile

Licenze compatibili con EUPL-1.2: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, CC0-1.0
Licenze da verificare caso per caso: LGPL-2.1, LGPL-3.0, MPL-2.0
Licenze NON compatibili: GPL-2.0-only, GPL-3.0-only (senza linking exception), AGPL-3.0, SSPL

### 2.9 — Miglioramento grafica iframe Jitsi
**Priorità**: Media
**Effort**: 1 giorno

La barra nera dei pulsanti Jitsi non si integra bene con il tema DTD.

Approcci:
1. **Produzione (same-origin)**: quando Jitsi è servito dallo stesso dominio via Ingress, si può iniettare un CSS custom tramite `interfaceConfigOverwrite.CUSTOM_CSS_URL`. Questo permetterebbe di cambiare colori, font e sfondo della toolbar Jitsi.
2. **Development**: la toolbar Jitsi è dentro un iframe cross-origin, quindi non è stilizzabile da fuori. L'approccio è mitigare con il wrapper gradient e assicurarsi che la transizione visiva sia fluida.
3. **Jitsi branding config**: alcune versioni supportano `dynamicBrandingUrl` che permette di passare un JSON con colori, logo, e testo custom.

Creare `app/public/jitsi-branding.json`:
```json
{
  "backgroundColor": "#002855",
  "backgroundImageUrl": "",
  "logoClickUrl": "https://eventi.dominio.gov.it",
  "logoImageUrl": "/images/dtd-watermark.svg",
  "premeetingBackground": "url('/images/dtd-background.svg')",
  "virtualBackgrounds": [],
  "inviteDomain": "eventi.dominio.gov.it"
}
```

E passarlo via `dynamicBrandingUrl: '/jitsi-branding.json'` nel `configOverwrite`.

### 2.10 — Test E2E con Playwright
**Priorità**: Alta
**Effort**: 2-3 giorni

Test automatizzati per i flussi critici:
- Registrazione partecipante (con campi ente)
- Login admin + creazione evento + pubblicazione
- Ingresso in sala live (moderatore + partecipante)
- Q&A: invio domanda, upvote, moderazione
- Polling: creazione, voto, risultati
- Cambio lingua senza reload
- GDPR: verifica cleanup dopo retention
- Calendario: download .ics, link Google/Outlook
- Responsive: test su mobile viewport

## Feedback post-demo (2026-04-16)

Note raccolte durante la prima demo live con stakeholder interni. Alcune
voci sono bug da sistemare rapidamente (hotfix v0.2.x), altre sono
miglioramenti UX e feature nuove che vanno pianificate.

### Hotfix (candidate v0.2.x)

- **Mani alzate — lista non affidabile**
  Cliccando "Mani alzate" non sempre compare chi ha alzato la mano;
  quando io stesso alzo la mano mi vedo come "Partecipante" e non col
  mio nome vero. Aggiungere ordinamento FIFO (prima l'ha alzata → prima
  in lista) con timestamp visibile, e risolvere la mappatura
  `jitsi-participant-id → registration.displayName` che evidentemente
  non sta incrociando le registrazioni in tutti i casi (guest vs
  registrati, nomi da prejoin).
  **Effort**: S (0.5–1 giorno). Fix lato `raised-hands-panel` +
  cross-check con `participants` list.

- **Moderatore aggiuntivo non riesce a muteare tutti**
  Una collega entrata con il link moderatore (stesso token) non
  riusciva a silenziare gli altri. Il pulsante "Mute all" probabilmente
  è rilegato al primo moderatore che entra (session-based) anziché al
  ruolo. Verificare JWT + permessi Jitsi (affiliation=owner) e bottone
  `moderator-controls` in presenza di più moderatori.
  **Effort**: S (mezza giornata di indagine + fix).

- **Magic-link moderatore con nome preconfigurato**
  Condividendo il link moderatore al collega, lui trovava il mio nome
  già impostato nella sala d'attesa. Va separato: il display-name in
  pre-join deve essere vuoto di default per chiunque apra il link, non
  pre-populato con `event.moderatorName`. Oppure usare
  `moderatorName` solo come fallback se l'utente non scrive nulla.
  **Effort**: S (poche ore).

### UX refinement (v0.3.x)

- **Navigazione e breadcrumb**
  In più pagine (admin + public) mancano pulsanti "Indietro" o il link
  alla sezione di origine. Passata sistematica: ogni pagina admin deve
  avere breadcrumb coerente e un modo di tornare al parent logico.
  **Effort**: M (2–3 giorni sparsi). Aggiungere un componente
  `AdminBreadcrumb` guidato dalla route e usarlo ovunque.

- **Password opzionale per call (soprattutto instant)**
  Campo `password` opzionale sull'evento; se settato, il join page
  chiede la password prima di emettere il JWT Jitsi. Per le instant
  call la password va proposta nella UI di creazione ("call privata?").
  Lato Jitsi: `config.roomPassword` o custom gating nel Prosody.
  **Effort**: M (1–2 giorni).

- **Gestione magic-link multi-moderatore**
  Oggi esiste un solo `moderatorToken` per evento — chiunque lo riceve
  diventa moderatore anonimo. Serve un modello `EventModerator` con
  magic-link personali (nome + email + token individuale) così che:
  - Ogni moderatore si presenta con il proprio nome
  - Si possono revocare singoli accessi senza invalidare tutti
  - Il pannello gestione mostra chi ha accesso come co-moderatore
  **Effort**: M/L (2–4 giorni). Nuovo model + UI admin + migration
  del token singolo a "primary moderator" per eventi esistenti.

- **Libreria video pubblica**
  Nuova sezione `/video-library` pubblica dove sfogliare tutti i video
  degli eventi passati (pubblicati) con filtri per data / argomento /
  tipo evento. Include:
  - Import YouTube: permettere al moderatore di collegare un URL
    YouTube come "video dell'evento" (embed iframe + link). Utile
    per retrocompatibilità con registrazioni legacy.
  - Nuove registrazioni Jibri vengono pubblicate qui automaticamente
    quando il moderatore marca il record come `recordingPublished`.
  **Effort**: M (2–3 giorni). Nuovo route + componente lista + campo
  `youtubeUrl` opzionale su Event / Recording.

### Trascrizione, sottotitoli, sintesi AI (v0.4.0)

Questo è il blocco più ambizioso e richiede una discussione
architetturale dedicata prima di iniziare.

- **Sottotitoli live nel player (accessibilità)**
  Ogni utente può attivare sottotitoli durante la call. Lato Jitsi
  esiste Jigasi + Vosk (open source) o integrazione Whisper. Il flusso
  live captions passa via XMPP e viene renderizzato dal frontend.
  **Effort**: L (1 settimana). Deploy Jigasi su cluster + abilitare
  `transcribingEnabled` + UI toggle per participant + rendering
  captions nell'iframe Jitsi.

- **Editor trascrizione post-evento**
  Nella pagina registrazione video del post-evento, un editor testo
  con timeline: ogni intervento mostra speaker + timestamp
  (es. "Raffaele: ciao a tutti — 00:10:24"). Il moderatore può
  correggere il testo, riassegnare lo speaker, esportare SRT/VTT/TXT.
  Player video sincronizzato: click sulla frase → jump al minuto.
  **Effort**: L/XL (2 settimane). Storage trascrizione per event +
  editor UI (timeline + waveform) + WebVTT export.

- **Sintesi AI della call (obbligo legale: trascrizione originale)**
  Per ogni evento registrato e trascritto, generare con LLM:
  - Trascrizione "raw" → **mantenuta sempre** (obbligo normativo)
  - Trascrizione editata (correzioni moderatore) → salvata come
    versione separata
  - Sintesi per speaker ("intervento di Raffaele: ...")
  - Sintesi globale / abstract / argomenti trattati
  - Questionario precompilato (N domande a risposta chiusa/aperta
    estratte dai temi emersi) che il moderatore rivede prima di
    inviarlo ai partecipanti per feedback
  **Effort**: XL (2–4 settimane). Scelta LLM (Claude API vs
  self-hosted), prompt engineering, privacy impact assessment
  (dati conversazione verso provider esterno), UI editor + review +
  invio questionario. **Richiede** prima la trascrizione post-evento.

- **Ricerca full-text sulle trascrizioni**
  Una volta che le trascrizioni sono persistite, esporre ricerca
  per parola chiave su tutti gli eventi (PostgreSQL `tsvector` basta
  per i volumi previsti).
  **Effort**: M (1 settimana).

- [ ] Ruolo **Relatore** (speaker) — mic/video/share senza poteri admin
- [ ] **Live streaming** per audience > 300 (RTMP → player HLS)
- [ ] **Breakout rooms** — sottogruppi durante l'evento
- [ ] **Trascrizione automatica** — speech-to-text (Whisper o Jitsi plugin)
- [ ] **Upload file** nelle risorse sessione (Azure Blob Storage)
- [ ] **Upload immagini evento** (cover image su Blob)
- [ ] **Export report PDF** — statistiche, Q&A, poll, partecipanti
- [ ] **SPID/CIE** autenticazione partecipanti (opzionale per evento)
- [ ] **Microsoft Graph API** — Outlook RSVP → auto-registrazione
- [ ] **Multi-tenancy** — più enti sullo stesso portale con branding separato
- [ ] **App mobile** — React Native con Jitsi SDK
- [ ] **Registrazione multi-camera** — speaker + slide separati

## Contribuire

Vedi [CONTRIBUTING.md](../.github/CONTRIBUTING.md) per come proporre nuove funzionalità o segnalare bug.
