# ADR-015 — Amministratori nominali accanto alla chiave dell'istanza

**Stato**: Accettato e implementato
**Decisori**: team pa-webinar
**Estende**: [ADR-014](014-organizer-role.md)

## Contesto

Con ADR-014 gli organizzatori entrano con un account nominale e un link
monouso. L'amministrazione no: si entrava solo con la chiave dell'istanza
(`ADMIN_API_KEY`), condivisa. Ne seguivano tre problemi, tutti più gravi per
chi riusa la piattaforma, dove chi amministra cambia nel tempo:

- il registro delle operazioni distingueva le sessioni ma non le persone;
- chi lasciava l'ente non si poteva escludere senza cambiare la chiave a
  tutti;
- la chiave è una credenziale lunga, da custodire e da passarsi.

## Decisione

**Un secondo ruolo sugli account dello staff**: `StaffRole` vale
`ORGANIZER` o `ADMIN`. Stesso accesso degli organizzatori — link monouso
per email, nessuna password — e stessi poteri della chiave.

**Il ruolo si legge dall'account, non dal token.** La sessione di un account
rilegge a ogni richiesta ruolo e stato (`getStaffSession`): nominare,
declassare o disattivare qualcuno vale alla richiesta successiva, non alla
scadenza del cookie. Il ruolo scritto nel token serve solo al middleware,
che non legge il database e si limita a lasciar entrare lo staff nell'area.
`isAdminAuthenticated` passa dalla stessa sessione: è vera per la chiave e
per gli account `ADMIN` attivi, e resta falsa per gli organizzatori.

**La chiave resta**, per il primo accesso di un'installazione nuova, per
l'emergenza e per l'automazione. Chi entra con la chiave nomina le persone
dalla pagina «Utenze»; da lì in poi la chiave può restare in cassaforte.

**Nessuno agisce su se stesso**: un amministratore non può togliersi il
ruolo, disattivarsi o eliminarsi. Farlo per errore lascerebbe l'istanza
senza chi la amministra, con la chiave come unica via d'uscita.

**Registro delle operazioni.** L'autore è `admin:<account>` o
`organizer:<account>`, con il ruolo letto dall'account al momento
dell'operazione; la chiave, che non ha un titolare, resta registrata con
l'impronta della sessione.

**Eventi.** Un evento creato da un amministratore nominale ha lui come
proprietario (`createdById`): se in seguito viene declassato a
organizzatore, i suoi eventi restano suoi. Gli eventi creati con la chiave
non hanno proprietario, come prima.

## Conseguenze

- Disattivare o eliminare un amministratore cambia, come per gli
  organizzatori, il link da moderatore degli eventi di cui è proprietario.
  Non cambia quelli degli altri eventi, che un amministratore può aver
  visto: ruotarli tutti romperebbe i link di ogni evento dell'istanza. Chi
  lascia l'ente con la conoscenza di quei link va trattato come chi conosceva
  la chiave — si rigenerano, dalla pagina dell'evento, quelli degli eventi
  che contano.
- Promuovere qualcuno ad amministratore gli dà accesso ai dati di tutti gli
  eventi e alla rubrica: l'interfaccia lo chiede con una conferma esplicita.
- Il flusso di accesso, la durata della sessione e il suo rinnovo sono
  quelli di ADR-014.
