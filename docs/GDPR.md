# GDPR — Informativa sul trattamento dei dati / Data Processing Notice

## Dati raccolti / Data Collected

### Partecipanti / Participants
- **Nome visualizzato** (`displayName`): mostrato agli altri partecipanti nella sala evento.
- **Email**: utilizzata solo per inviare la conferma di registrazione, il link di accesso e promemoria. L'email viene crittografata a riposo (`encryptPII`) e un hash (`hashEmail`) viene usato per impedire registrazioni duplicate.
- **Consenso GDPR** (`consentGiven`, `consentTimestamp`): flag e timestamp del consenso esplicito.
- **Token di accesso** (`accessToken`): token unico per accedere alla sala evento.

Nessun altro dato viene raccolto dal partecipante.

### Moderatori / Moderators
- **Nome** e **email** del moderatore: opzionali, configurati alla creazione dell'evento. Usati per l'intestazione delle email e le informazioni .ics.
- **Token moderatore** (`moderatorToken`): UUID unico che funge da credenziale di accesso. Non è previsto un sistema di account utente.

## Archiviazione e crittografia / Storage & Encryption

| Dato | Storage | Crittografia |
|---|---|---|
| Email partecipante | PostgreSQL | AES-256 (campo crittografato) |
| Hash email | PostgreSQL | SHA-256 (irreversibile) |
| Nome partecipante | PostgreSQL | In chiaro |
| Domande Q&A | PostgreSQL | In chiaro |
| Chat Jitsi | Memoria (Prosody XMPP) | **Non persistita** |
| Registrazioni video | Azure Blob Storage | Crittografia at-rest (Azure) |

## Chat Jitsi

I messaggi della chat nativa di Jitsi (la chat accessibile dalla toolbar video) **non vengono salvati** dopo la fine dell'evento. La chat transita esclusivamente tramite il server Prosody (XMPP) in memoria. Quando la conferenza termina, tutti i messaggi vengono cancellati.

Il sistema Q&A (domande con upvote nel pannello laterale) è invece persistito in PostgreSQL e segue le stesse regole di conservazione delle registrazioni.

## Registrazioni video

Le registrazioni video vengono effettuate tramite Jibri (headless Chrome) e caricate su Azure Blob Storage.

### Flusso registrazione

1. **Registrazione temporanea**: quando un evento è LIVE e Jibri è disponibile,
   la registrazione viene avviata automaticamente. Questa registrazione è
   temporanea e viene eliminata dopo 24 ore se non pubblicata. Serve per
   consentire ai ritardatari di guardare l'evento dall'inizio ("catch-up").

2. **Pubblicazione**: il moderatore può decidere di pubblicare la registrazione
   nella pagina dell'evento. In questo caso, il video è accessibile ai visitatori
   della pagina evento.

3. **Conservazione**: la registrazione pubblicata segue il periodo di retention
   configurato per l'evento (default: 30 giorni) oppure un periodo specifico
   configurato dal moderatore (`recordingDeleteAfterDays`).

4. **Eliminazione**: alla scadenza del periodo di conservazione, il video viene
   eliminato dallo storage e il link rimosso dalla pagina evento.

### Consenso

- I partecipanti sono informati della registrazione prima dell'ingresso nella sala
  tramite una schermata di consenso full-screen.
- Il consenso è informato (banner visibile) e implicito (entrare = acconsentire).
- Se l'evento ha un testo di consenso personalizzato (`recordingConsentText`),
  viene mostrato al posto del testo predefinito.
- Se il moderatore abilita la pubblicazione, l'informativa al momento della
  registrazione include questa possibilità.
- I partecipanti possono richiedere la rimozione del video ai sensi dell'Art. 17 GDPR.

### Dati tecnici

- Le registrazioni sono archiviate su object storage (Azure Blob, S3, GCS, MinIO).
- L'accesso avviene tramite URL temporanei (SAS token) con scadenza.
- I video non sono indicizzati dai motori di ricerca (noindex, nofollow).
- Il player video non scarica il file intero — streaming progressivo.

## Registrazione multi-traccia (speaker attribution)

A differenza della registrazione video standard — che cattura un **audio
misto** (tutti i partecipanti in un'unica traccia) ed è già coperta dalla
sezione precedente — la funzione di *speaker attribution* introduce la
cattura di **una traccia audio isolata per partecipante**. Lo scopo è
unicamente attribuire le porzioni di transcript al relatore corretto
(chi ha detto cosa), non identificare la voce come tale. Il razionale
tecnico e l'analisi completa sono in
[ADR-013](adr/013-multitrack-speaker-attribution.md).

L'audio isolato del singolo individuo è un dato personale ad **alta
sensibilità**: in quanto vicino al dato biometrico vocale, ricadrebbe
nell'Art. 9 GDPR **se** usato per identificare la persona dalla voce.
Per questo è trattato come un trattamento nuovo e distinto, soggetto a
garanzie aggiuntive rispetto all'audio misto.

### Base giuridica e consenso

- **Opt-in a livello evento** (minimizzazione): la registrazione per-partecipante
  NON è automatica per gli eventi con trascrizione. L'organizzatore la abilita
  esplicitamente con il flag `Event.multitrackRecordingEnabled` (toggle dedicato
  nel wizard, sotto "Trascrizione automatica"). Il recorder multi-traccia viene
  avviato solo per eventi con `recordingEnabled` + `aiTranscriptEnabled` +
  `multitrackRecordingEnabled` (gate in `/api/internal/recorder-desired`). Senza
  l'opt-in, la trascrizione usa il fallback su traccia mista (diarization pyannote),
  senza isolare l'audio del singolo parlante.
- Il trattamento richiede il **consenso esplicito** dell'interessato
  (Art. 6.1.a GDPR), **separato** dal consenso alla registrazione audio/video
  standard (`Registration.consentRecording`). Il consenso al missaggio non
  implica il consenso alla traccia isolata: è una casella distinta
  (`Registration.consentMultitrack`).
- **Consenso come gate alla registrazione** (coerente con `consentRecording`):
  quando l'evento ha `multitrackRecordingEnabled`, il consenso multi-traccia è
  **obbligatorio per registrarsi** (validato in
  `/api/events/[param]/registrations`). Così ogni partecipante presente in
  stanza ha prestato il consenso e il recorder può registrare tutte le tracce
  senza filtri runtime fragili. Chi non acconsente non completa la
  registrazione (come già avviene per il consenso alla registrazione standard).
  > Scelta di design: alternativa più inclusiva (il non-consenziente entra solo
  > nel mix, non isolato) richiederebbe un filtro per-partecipante lato recorder
  > basato sull'identità Jitsi — fragile e rimandato. Vedi ADR-013.
- Lo stato dei flag di consenso al momento dell'avvio è cristallizzato in
  uno snapshot (coerente con `Recording.consentSnapshot`, vedi
  `docs/POSTPROD.md`), così che la base giuridica resti dimostrabile anche
  a posteriori.

### Distinzione dal voice-cloning (NON è biometria)

Va sottolineato senza ambiguità: la piattaforma **non clona, non sintetizza
e non identifica** la voce. La traccia isolata è un mero input acustico per
un trascrittore (WhisperX + diarization pyannote, vedi `docs/POSTPROD.md`):
serve a produrre **testo attribuito**, non un'impronta vocale. Non viene
calcolato né conservato alcun *voiceprint*, embedding biometrico o modello
vocale per-persona. Coerentemente con `docs/POSTPROD.md` ("Art. 9 GDPR —
dati biometrici"), l'Art. 9 non si applica perché non c'è identificazione
biometrica; la sensibilità deriva dalla natura dell'input, non dall'uso,
ed è proprio per neutralizzare il rischio di uso biometrico che si adottano
le mitigazioni di minimizzazione e cancellazione precoce qui descritte.

### Minimizzazione: la traccia è un input intermedio

Il principio cardine è la **minimizzazione** (Art. 5.1.c GDPR): la traccia
per-partecipante è un **artefatto intermedio**, non un output conservato.

> **Eccezione opt-in — conservazione per archivio/riascolto** (`Event.retainParticipantTracks`, default OFF). Un organizzatore può scegliere di **conservare** le tracce per-partecipante oltre la trascrizione, per produrre un archivio scaricabile (file unico con tracce audio etichettate per nome + sottotitoli) e per il riascolto per-relatore nella video-library. È una **finalità ulteriore** che estende la conservazione di PII sensibile: si applica **solo** se l'organizzatore l'ha attivata esplicitamente, va dichiarata nell'informativa dell'evento e richiede il consenso `consentMultitrack`. Quando attiva, il purge **non** cancella subito le tracce: vengono mantenute fino alla scadenza di retention del recording (`Recording.retentionUntil`), poi purgate. Quando OFF vale la minimizzazione standard descritta sotto.

- Ogni traccia è modellata da `RecordingTrack`, distinto dal `Recording`
  (audio misto) e dai `PostprodArtifact` (transcript, sintesi, sottotitoli).
- Appena la trascrizione e l'attribuzione sono completate, il blob audio
  isolato viene **cancellato** e il campo `RecordingTrack.audioPurgedAt`
  viene valorizzato con il timestamp della purga. Da quel momento resta solo
  il riferimento di attribuzione (chi ha detto quale segmento), non l'audio.
- La **retention** della traccia isolata è quindi molto più breve di quella
  del transcript: il transcript segue la retention dell'evento /
  `SiteSetting.aiArtifactRetentionDays` (vedi `docs/POSTPROD.md`), mentre la
  traccia audio è tipicamente purgata **entro poche ore** dal completamento
  del post-processing, indipendentemente dalla retention dell'evento.
- Un eventuale fallback (transcript senza speaker attribution, vedi
  `docs/POSTPROD.md`) non produce né conserva tracce isolate.

### Cifratura e isolamento at-rest

- Il blob della traccia isolata **non è mai pubblico** e non è indicizzato:
  niente SAS URL/link pubblici come per i video pubblicati. È accessibile
  solo al worker di post-processing tramite **signed URL a breve scadenza**,
  per il tempo strettamente necessario alla trascrizione.
- L'associazione tra traccia e persona usa il **`displayName` cifrato**
  (AES-256-GCM via `encryptPII`, coerente con `crypto:encryption/pii`): il
  worker e lo storage non vedono il nome in chiaro.
- La cifratura at-rest del blob è quella del provider (Azure SSE / S3 SSE),
  come per i recording standard.

### Diritti dell'interessato

- **Accesso (Art. 15)**: l'export GDPR (`/api/gdpr/export`) riporta
  l'esistenza dell'attribuzione testuale; la traccia audio isolata, se già
  purgata (`audioPurgedAt` valorizzato), non è più disponibile per
  definizione.
- **Cancellazione (Art. 17)**: cancellare una `RecordingTrack` (o la sua
  purga automatica) **non intacca il transcript già attribuito**, che è un
  artefatto derivato e autonomo. La cancellazione dell'audio non riscrive
  retroattivamente il testo: il transcript resta valido finché vive secondo
  la propria retention. Chi richiede la rimozione del proprio contributo
  testuale dal transcript esercita il diritto sul `PostprodArtifact`, non
  sulla traccia (che potrebbe già non esistere più).

## Conservazione dei dati / Data Retention

Ogni evento ha un periodo di conservazione configurabile (`dataRetentionDays`, default: 30 giorni dopo la fine dell'evento). Dopo questo periodo, il cron di pulizia (`/api/cron/cleanup`) elimina automaticamente:

- **Registrazioni dei partecipanti**: email crittografata, nome, hash, token di accesso.
- **Domande Q&A**: testo delle domande e voti.
- **Registrazioni video**: file su Azure Blob Storage e URL nel database.

L'evento stesso (titolo, descrizione, date) viene mantenuto in stato `ARCHIVED` per riferimento storico.

## Cookie

L'applicazione utilizza un unico cookie funzionale:

| Cookie | Scopo | Durata | HttpOnly | SameSite |
|---|---|---|---|---|
| `admin_session` | Sessione JWT per l'area amministrativa | 24 ore | Sì | Strict |

Non vengono utilizzati cookie di marketing, tracciamento o analytics. Non è necessario un banner cookie poiché l'unico cookie è strettamente necessario al funzionamento del servizio.

## Log

I log dell'applicazione:
- **Non contengono** indirizzi IP.
- **Non contengono** dati personali dei partecipanti.
- Sono conservati per un massimo di **30 giorni**.
- Contengono solo informazioni di debug (errori, ID evento, timestamp).

## Font e risorse esterne

Tutti i font (Titillium Web, Roboto Mono, Lora) sono **self-hosted**. Non viene effettuata alcuna richiesta a CDN esterni (Google Fonts, Adobe, ecc.).

Non vengono utilizzati script di analytics (Google Analytics, Mixpanel, ecc.) né pixel di tracciamento.

## Diritti dell'interessato / Data Subject Rights

I partecipanti possono esercitare i diritti previsti dal GDPR (accesso, rettifica, cancellazione, portabilità) contattando l'organizzatore dell'evento o il Dipartimento per la Trasformazione Digitale.

La cancellazione automatica dei dati al termine del periodo di conservazione garantisce il principio di minimizzazione dei dati.

## v0.2.0 — Campi aggiuntivi registrazione

### Nuovi dati raccolti

| Dato | Obbligatorietà | Base giuridica | Note |
|------|---------------|----------------|------|
| Ente di appartenenza | Configurabile per evento | Consenso | Testo libero |
| Ruolo nell'ente | Configurabile per evento | Consenso | Testo libero |
| Tipologia ente | Configurabile per evento | Consenso | Select predefinita |

Questi campi seguono la stessa retention dell'evento e vengono eliminati dal cron GDPR.

### Consensi granulari

Tre consensi distinti nel modulo di registrazione:

1. **Trattamento dati per partecipazione** (`consentGiven`) — obbligatorio, senza questo non è possibile registrarsi.
2. **Registrazione audio/video** (`consentRecording`) — obbligatorio solo se l'evento ha `recordingEnabled = true`. Il campo è `null` se la registrazione non è abilitata.
3. **Comunicazioni future** (`consentFutureCommunications`) — opzionale, default `false`. "Desidero ricevere informazioni su eventi futuri organizzati dal DTD."

Nessun consenso è pre-selezionato.

### Informativa privacy per evento

Ogni evento supporta due modalità di informativa privacy:
- **URL esterno** (`privacyPolicyUrl`): link a un documento esterno.
- **Testo personalizzato** (`privacyPolicyText`): testo inline mostrato in una sezione espandibile nel modulo di registrazione.

Se nessuna delle due è configurata, viene usato l'URL da `DEFAULT_PRIVACY_POLICY_URL` (variabile d'ambiente).

### Audit log GDPR

Modello `GdprAuditLog` — log immutabile delle operazioni GDPR senza PII:

| Campo | Tipo | Note |
|-------|------|------|
| `eventId` | UUID | Riferimento all'evento |
| `action` | String | `DATA_DELETED`, `CONSENT_RECORDED`, `DATA_EXPORTED` |
| `recordCount` | Int | Numero di record coinvolti |
| `details` | JSON | Dettagli operazione (no PII) |
| `createdAt` | DateTime | Timestamp immutabile |

Azioni registrate:
- **`CONSENT_RECORDED`**: scritto alla registrazione di ogni partecipante, include i flag di consenso (non i dati personali).
- **`DATA_DELETED`**: scritto dal cron di pulizia, include i conteggi delle entità eliminate (registrazioni, domande, sondaggi, materiali).
- **`DATA_EXPORTED`**: scritto quando un utente richiede i propri dati via `/api/gdpr/export`, include solo un prefisso dell'hash email.

### Diritto di accesso (Art. 15)

Endpoint: `GET /api/gdpr/export?email=xxx`

- L'email viene hashata e confrontata con `emailHash` nelle registrazioni.
- Restituisce: registrazioni, eventi, domande Q&A, voti ai sondaggi.
- Non restituisce dati di altri partecipanti.
- Rate limit: 3 richieste per ora per IP.
- Pagina utente: `/[locale]/privacy/i-miei-dati`

### Anteprima conservazione dati

Nel form di creazione evento, sotto il campo `dataRetentionDays`, un callout informativo mostra esattamente cosa verrà eliminato automaticamente:
- Dati dei partecipanti (nome, email, ente)
- Domande Q&A e voti
- Risultati dei sondaggi
- Registrazioni video
- Le statistiche aggregate vengono mantenute.

## Rubrica / Identità Persona (v0.4.x)

Oltre alla `Registration` per-evento, la piattaforma introduce il modello
`Person` — un'identità **cross-evento** basata su `emailHash` che persiste
oltre la retention del singolo evento. La base giuridica è distinta
(consenso esplicito separato Art. 6.1.a) e il flusso è documentato in
[ADR-011](adr/011-person-rubrica.md).

### Principi

- **Opt-in esplicito**: un record `Person` con `optedInToAddressBook = true`
  esiste solo quando il partecipante (o l'admin, in scrittura diretta) ha
  dato consenso separato alla conservazione in rubrica. La semplice
  registrazione a un evento **non** alimenta la rubrica.
- **Nessun dato sensibile**: solo `emailHash`, `displayName`, `organization`,
  `organizationRole`, `organizationType`, più i timestamp `optedInAt` /
  `optedOutAt` / `lastActiveAt`. Nessuna telemetria AV, nessun tracciamento
  comportamentale.
- **Retention per inattività**: cron `/api/cron/rubrica-retention` cancella
  i `Person` inattivi oltre la soglia (default 24 mesi), slide su
  `lastActiveAt`.

### Opt-out (Art. 21)

Il diritto di opposizione è esercitabile via link firmato nell'email di
invito: il token non è un JWT ma un HMAC dedicato (vedi
`app/src/lib/persons/opt-out-token.ts`) che espone `POST /api/rubrica/opt-out`.
Al click:

1. Il record `Person` viene marcato `optedOutAt = now()` e `optedInToAddressBook = false`.
2. L'admin UI di `/admin/rubrica` non mostra più la persona nelle liste di invito.
3. Il `emailHash` resta nel record per impedire re-opt-in silenzioso senza nuovo consenso.

Gli admin possono esercitare l'opt-out per conto dell'interessato da
`/admin/rubrica` (action "Rimuovi dalla rubrica"), azione loggata su
`GdprAuditLog`.

## Percorso guest (senza Registration)

Alcune feature accettano contributi da utenti **non registrati** (guest)
quando l'evento li consente:

| Feature | PII salvate | Retention |
|---|---|---|
| Q&A domande | `Question.authorName` (display name scelto al momento, `registrationId` nullable) | Segue `dataRetentionDays` dell'evento |
| Chat in-app | `ChatMessage.authorName`, nessuna email | Segue `dataRetentionDays` dell'evento |
| Reactions / word cloud | Nessuna PII — solo contatori / parole | Segue `dataRetentionDays` dell'evento |

Ai guest non viene chiesta l'email; il display name è sotto il controllo
dell'utente e può essere lasciato vuoto (sostituito con un placeholder
generico). Nessuna PII viene persistita senza un display name esplicito.

## Proposta stringhe i18n — informativa multi-traccia

> **Nota per chi implementa**: blocco **proposto**, non ancora applicato ai
> file di messaggi. L'informativa privacy e il modulo di consenso dovranno
> esporre queste chiavi. Testi IT (default) ed EN; le altre 23 lingue
> seguiranno la traduzione standard. Le chiavi sono raggruppate sotto
> `privacy.multitrack` per coerenza con il namespacing esistente.

| Chiave | IT | EN |
|---|---|---|
| `privacy.multitrack.consentLabel` | Acconsento alla registrazione di una traccia audio separata della mia voce, al solo scopo di attribuire correttamente la trascrizione a chi parla. | I consent to recording a separate audio track of my voice, for the sole purpose of correctly attributing the transcript to each speaker. |
| `privacy.multitrack.purpose` | La traccia separata serve unicamente ad associare il testo trascritto al relatore corretto. Non viene usata per identificare, riconoscere o riprodurre la tua voce. | The separate track is used only to associate the transcribed text with the correct speaker. It is not used to identify, recognise or reproduce your voice. |
| `privacy.multitrack.notBiometric` | Non creiamo alcuna impronta vocale né modello della tua voce: trattiamo l'audio solo per trasformarlo in testo. | We do not create any voiceprint or model of your voice: we process the audio only to turn it into text. |
| `privacy.multitrack.minimization` | La traccia audio separata è temporanea: viene cancellata subito dopo la trascrizione e conservata per un periodo molto più breve del testo prodotto. | The separate audio track is temporary: it is deleted right after transcription and kept for a much shorter period than the resulting text. |
| `privacy.multitrack.encryption` | La traccia è cifrata, non è mai pubblica ed è accessibile solo al sistema di trascrizione per il tempo strettamente necessario. | The track is encrypted, never public, and accessible only to the transcription system for the strictly necessary time. |
| `privacy.multitrack.rights` | Puoi chiedere in qualsiasi momento la cancellazione della tua traccia audio. La cancellazione dell'audio non modifica il testo già trascritto e attribuito. | You can request deletion of your audio track at any time. Deleting the audio does not change text that has already been transcribed and attributed. |
| `privacy.multitrack.legalBasis` | Base giuridica: consenso esplicito (art. 6, par. 1, lett. a, GDPR), distinto dal consenso alla registrazione video. | Legal basis: explicit consent (Art. 6(1)(a) GDPR), distinct from consent to video recording. |
| `privacy.multitrack.optionalNotice` | Se non presti questo consenso, potrai comunque partecipare ed essere registrato nell'audio comune dell'evento; semplicemente non verrà creata una tua traccia separata. | If you do not give this consent, you can still take part and be recorded in the event's shared audio; simply no separate track of you will be created. |
