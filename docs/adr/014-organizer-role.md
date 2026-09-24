# ADR-014 — Ruolo organizzatore: account dello staff con accesso via email

**Stato**: Accettato e implementato — esteso da [ADR-015](015-named-administrators.md) (amministratori nominali)
**Decisori**: team pa-webinar

## Contesto

Fino a questa decisione l'area di amministrazione conosceva due soli modi di
entrare:

- **la chiave dell'istanza** (`ADMIN_API_KEY`), che apre tutto: configurazione
  della piattaforma, dati di tutti gli eventi, rubrica, registri GDPR;
- **il link del moderatore** di un evento, che apre la conduzione di *quel*
  evento: agenda, chat, file, concessioni. Non permette di crearne uno, di
  pubblicarlo, di gestirne materiali, questionari o post-produzione.

Chi organizza eventi senza amministrare la piattaforma — una struttura che
tiene i propri webinar su un'istanza gestita da altri — non aveva un posto.
Per fargli creare un evento bisognava dargli la chiave dell'istanza, cioè il
potere di cambiare la configurazione, cancellare gli eventi altrui e leggere
i dati personali di tutti i partecipanti.

Il modello dei dati non aiutava: `Event` non aveva un proprietario, quindi
non c'era modo di dire «questo evento è di questa persona».

## Decisione

Un terzo modo di entrare: **l'account dello staff** con ruolo `ORGANIZER`.

**Identità.** `StaffAccount` con nome ed email cifrati a riposo
(`encryptPII`); l'email si cerca per hash (`hashEmail`). Nessuna password:
si entra con un **link monouso** mandato all'email, coerente con la scelta,
gia' fatta per i moderatori, di non avere account con password. Del token
nel database finisce solo l'hash SHA-256; il link scade dopo 20 minuti, si
consuma una volta sola in modo atomico e solo con un clic esplicito — la
pagina d'arrivo non lo consuma all'apertura, così i filtri antispam che
visitano i link delle email non bruciano l'accesso.

**Proprietà.** `Event.createdById`, nullable, `onDelete: SetNull`. L'evento
creato da un organizzatore è suo; gli eventi creati dall'amministrazione e
quelli nati prima di questa decisione non hanno proprietario e restano
dell'amministrazione. Cancellare un account non cancella gli eventi: tornano
all'amministrazione. La copia di un evento duplicato appartiene a chi la
crea.

**Sessione.** Lo stesso cookie firmato dell'amministrazione
(`admin_session`), con il ruolo nel token e l'identificativo dell'account
come `sub`. A ogni richiesta la sessione dell'organizzatore rilegge
l'account: disattivarlo vale subito, non alla scadenza del cookie. Il
rinnovo periodico conserva il ruolo.

**Autorizzazione.** `isAdminAuthenticated` resta vera **solo** per
l'amministrazione: le rotte che non sono state riviste per il nuovo ruolo
continuano a rifiutare l'organizzatore invece di aprirsi per errore. Le
rotte riviste usano guardie esplicite (`requireStaff`,
`requireEventManager`, `requireRecordingManager`, `requireSpeakerManager` in
`lib/auth/staff-session.ts`); gli elenchi si filtrano con `eventScope`. Le
pagine dichiarano chi le vede con `soloAdmin` / `staffOLogin`
(`lib/auth/staff-page.ts`): chi è entrato ma non ha il ruolo giusto vede
«accesso non consentito», non un rinvio al login che lo farebbe girare in
tondo.

**Cosa può l'organizzatore**: creare eventi e chiamate rapide; gestire i
propri — modifica, pubblicazione, materiali, questionari, inviti, tag,
duplicazione, analisi, post-produzione delle loro registrazioni; leggere le
librerie condivise che servono a comporli (tag, domande). **Cosa no**:
configurazione della piattaforma, lingue, modelli GDPR ed email,
infrastruttura, monitoraggio, rubrica, iscrizioni di tutti gli eventi,
registro GDPR, pubblicazioni, statistiche d'istanza, file orfani
dell'archivio, gestione degli organizzatori.

**Disattivare o eliminare un account** chiude subito la sessione, cancella i
link di accesso non usati e **cambia il link da moderatore di ogni suo
evento**: quelli li ha visti tutti, e con il vecchio link potrebbe ancora
modificarli. Chi lo usava legittimamente trova il nuovo nella pagina
dell'evento.

**La rubrica resta dell'amministrazione.** L'organizzatore rinomina i relatori
e gestisce gli inviti dei propri eventi, ma non collega persone della rubrica
né ne vede i profili; nel creare un evento il selettore della rubrica non gli
compare.

**Il moderatore non diventa un account.** Il link per evento fa già quel
mestiere, e un secondo modello d'identità per la stessa cosa porterebbe poco
e costerebbe molto.

## Presidi

- `lib/auth/staff-access.test.ts` pretende che ogni rotta e ogni pagina
  dell'area dichiari chi la usa, e che l'elenco delle rotte aperte
  all'organizzatore coincida con quello scritto nel test: aprirne una è una
  scelta, non l'effetto collaterale di una guardia copiata.
- Il menu dell'area mostra all'organizzatore un elenco di voci **ammesse**:
  una sezione aggiunta in futuro nasce riservata all'amministrazione.

## Conseguenze

- Ogni rotta dell'area ha una classificazione esplicita; le pagine hanno
  smesso di rinviare al login chiunque non sia amministratore.
- La mail di accesso esiste in italiano e inglese, come le altre email della
  piattaforma.
- Il registro delle azioni amministrative (`admin_audit_log`) registra
  accessi, creazioni, disattivazioni e cancellazioni degli organizzatori.
