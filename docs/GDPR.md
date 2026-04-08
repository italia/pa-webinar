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
