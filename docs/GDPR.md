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


## Pipeline AI post-evento

La pipeline AI di post-produzione (trascrizione, sintesi, traduzione,
doppiaggio) ha un perimetro GDPR specifico — tutto in-cluster, niente
API esterne. Le sezioni seguenti sono il riferimento normativo del
codice in `app/src/lib/ai/`, `app/src/app/api/cron/postprod-retention/`
e dei worker in `infra/ai/worker/`.

### Base giuridica e finalità

| Trattamento | Base giuridica | Finalità |
|---|---|---|
| Trascrizione (WhisperX) | Art. 6.1.e (compito di interesse pubblico — accessibilità degli atti di un evento PA) | Rendere il contenuto fruibile da non udenti / consultabile a posteriori |
| Sintesi e traduzione (Mistral via vLLM) | Art. 6.1.e | Sintesi divulgativa multilingue dell'evento pubblico |
| Doppiaggio sintetico (Piper TTS) | Art. 6.1.e | Accessibilità linguistica della registrazione pubblicata |
| Identificazione speaker (`Speaker.displayName`) | Art. 6.1.e + ruolo di moderatore/relatore reso pubblico al momento dell'iscrizione | Etichettare i segmenti della trascrizione |

Il trattamento avviene **solo dopo** la fine dell'evento, sulla
registrazione caricata da Jibri; non c'è elaborazione AI in tempo
reale sul flusso live.

### Voice cloning: non supportato

Il doppiaggio AI **non** clona la voce dei relatori reali. Il sistema
usa Piper TTS con voci sintetiche pre-trained pubbliche (MIT). Imitare
la voce di una persona identificabile costituirebbe trattamento di
dati biometrici ai sensi dell'**Art. 9 GDPR** e richiederebbe consenso
esplicito per finalità specifica difficile da ottenere da partecipanti
di un evento pubblico. La scelta è deliberata, persistente e
documentata in ADR-005 e nell'UI del tab `Pipeline AI` di
`/admin/settings`.

**Doppiaggio multivoce ≠ voice cloning.** Quando nella PVC `ai-models`
sono presenti più voci Piper per la lingua target, il worker assegna a
ogni `SPEAKER_xx` distinto **una voce diversa del pool** in modo
deterministico (ordinamento per tempo totale di parola → indice nel
pool). Non c'è inferenza dalla voce reale alla voce sintetica: le voci
del pool sono pre-trained pubbliche, fungibili, non identificative di
nessuna persona reale. Lo speaker A che parla in una voce sintetica F
americana in un evento può parlare in voce sintetica M britannica in
un altro — l'assegnazione cambia con la composizione degli speaker
dell'evento. È solo una scelta editoriale per facilitare la
comprensione di chi sta parlando nel doppiaggio.

### Dove vivono i dati AI

| Tabella / Storage | Contiene | Note GDPR |
|---|---|---|
| `Recording.consentSnapshot` (JSONB) | Snapshot dei flag AI all'avvio della pipeline | Mai modificato dopo il primo write — audit consenso |
| `Recording.sourceLanguage` | ISO-639-1 | Non PII |
| `PostprodArtifact.inlineBody` (cifrato) | Trascrizione, sintesi, traduzioni inline | Cifrato a riposo con la chiave PII |
| `PostprodArtifact.blobKey` | Path nel postprod bucket | I blob (VTT, audio dubbed) restano nello storage finché esiste l'artifact row |
| `Speaker.displayName` | Nome del moderatore/relatore | Copiato da `Person.displayName` al momento del mapping admin |
| `Speaker.diarLabel` | "SPEAKER_00" ecc., generato da pyannote | Non PII |
| `PostprodJob.payload` (JSONB) | Parametri del job (runId, lingua sorgente, lingua target) | Può contenere riferimenti a `recordingId` |
| `PostprodJob.lastError` | Stack trace dell'ultimo errore | Può contenere snippet di trascrizione in caso di fallimento mid-processing |

### Retention

La retention degli artefatti AI è governata da due meccanismi che
coesistono:

1. **Event-bound (default)**: `Recording.retentionUntil = null`. Gli
   artefatti AI vengono cancellati a cascata insieme all'evento
   quando il cron `cleanup` purga le righe Event ai sensi di
   `dataRetentionDays`.
2. **Override globale**: `SiteSetting.aiArtifactRetentionDays > 0`.
   Il cron `/api/cron/postprod-retention` (quotidiano) cancella ogni
   artifact AI più vecchio di N giorni anche se l'evento è ancora
   vivo. Caso d'uso: "verbale come atto pubblico" che vive 730 giorni
   dopo l'evento.
3. **Override per-recording**: `Recording.retentionUntil != null`.
   Quando passa, lo stesso cron:
   - cancella i blob postprod dallo storage (best-effort, log su
     failure);
   - cancella le righe `PostprodArtifact`;
   - **`deleteMany` su `Speaker`** della recording — `displayName` è
     PII e non sopravvive alla retention;
   - **`updateMany` su `PostprodJob`** azzerando `payload` a
     `{scrubbed: true}` e `lastError` a `null` — le righe restano
     per audit (count, durate, esiti) ma niente più snippet PII;
   - marca `Recording.status = ARCHIVED`.

### Accesso pubblico agli artefatti AI

Gli endpoint pubblici `/api/events/[slug]/postprod/{transcript,
subtitle/[lang], dubbed-audio/[lang], download/[file]}` sono protetti
dall'helper `assertPostprodAccessible(slug)` (in
`app/src/lib/ai/access.ts`) che verifica in cascata:

1. `SiteSetting.aiPipelineEnabled` — kill-switch globale.
2. `event.recordingPublished` — la moderazione ha pubblicato il video.
3. `event.postEventPublic` — il post-evento è pubblico (toggle privacy).
4. `event.postEventPublicUntil` — eventuale finestra temporale.

Qualsiasi check fallito ritorna `404` (non `403`) per non distinguere
"evento inesistente" da "post-evento ritirato".

### Disclaimer AI Act (Art. 50)

La status page pubblica e il player video mostrano un banner
permanente quando la pipeline è attiva: "Trascrizioni, sintesi e
doppiaggi sono generati automaticamente da modelli AI in cluster. Il
contenuto può contenere errori; il video resta la fonte autoritativa.
Niente voice cloning, niente API esterne". Il testo è
internazionalizzato (`status.postprod.aiBadge` in
`app/src/i18n/messages/*.json`) e visibile in ognuno dei 24 locali
UE supportati.
