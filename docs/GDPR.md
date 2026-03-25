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

Le registrazioni video vengono effettuate tramite Jibri (headless Chrome) e caricate su Azure Blob Storage. La registrazione è facoltativa e deve essere esplicitamente attivata dal moderatore.

Prima dell'avvio della registrazione:
1. Il moderatore attiva la registrazione dalla barra dei controlli.
2. Un banner visibile a tutti i partecipanti indica che la registrazione è in corso.
3. I partecipanti che accedono all'evento con registrazione attiva vedono una schermata di consenso prima di entrare nella sala.

Le registrazioni seguono la politica di conservazione configurata per l'evento (`dataRetentionDays`). Dopo la scadenza, il cron di pulizia elimina automaticamente sia i file su Azure Blob Storage che i metadati nel database.

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
