# ADR-011 — Identità cross-evento `Person` + Rubrica

**Stato**: Proposto (2026-04-21)
**Decisori**: team eventi-dtd / DTD
**Contesto abilitante**: v0.5.0 — Questionari + Rubrica (fase B)

## Contesto

Oggi il modello dati è **per-evento**: ogni `Registration` vive il tempo dell'evento + retention configurabile, poi il cron GDPR la cancella. Non esiste identità persistente dell'utente tra eventi diversi.

Con l'evoluzione verso un portale di **call di community DTD**, i moderatori hanno chiesto funzionalità che oggi trovano in MS Teams:

1. **Rubrica**: elenco di persone da invitare a nuovi eventi senza dover re-inserire i loro dati a mano.
2. **Deduplica risposte stabili**: se un partecipante ha già dichiarato ente/ruolo in un evento precedente, il form di registrazione li pre-compila.
3. **Profilo persona**: storico di partecipazione (quali eventi, quali risposte a domande profilazione).

Queste esigenze sono legittime ma introducono un'identità utente che **sopravvive alla retention del singolo evento**, cosa che oggi non accade. La base giuridica per raccogliere dati per il singolo evento (`Art. 6.1.b`, esecuzione del contratto) non copre la persistenza per finalità future: serve un **consenso esplicito separato** (`Art. 6.1.a`).

## Decisione

Introduciamo il modello **`Person`** come entità distinta da `Registration`, con queste caratteristiche chiave:

### 1. Separazione stretta fra `Person` e `Registration`

```
Person (persiste oltre il singolo evento)
  ├── emailHash (key, deterministic hash come oggi per Registration)
  ├── displayName
  ├── organization        ← campo profilo stabile
  ├── role                ← campo profilo stabile
  ├── organizationType    ← campo profilo stabile
  ├── optedInToAddressBook: bool  ← CRITICAL: solo true se opt-in esplicito
  ├── optedInAt: DateTime?
  ├── optedOutAt: DateTime?       ← null se mai uscito; non-null = rimozione richiesta
  ├── lastActiveAt: DateTime      ← usata per retention inactivity-based
  ├── retentionMonths: Int        ← configurabile, default 24
  ├── createdAt, updatedAt

Registration (resta per-evento, scade con retention evento)
  ├── ... campi esistenti ...
  ├── personId: FK → Person?      ← NUOVO: nullable, popolato se opt-in
```

Il cambio è additivo: tutte le registrazioni esistenti restano valide. `personId` è nullable perché un utente può registrarsi a un evento **senza** entrare in rubrica.

### 2. Doppio consenso nel form di registrazione

Due checkbox distinte, la seconda opzionale:

- ☑ **Accetto il trattamento dei miei dati per partecipare a questo evento** — base `Art. 6.1.b`, obbligatorio, come oggi.
- ☐ **Voglio ricevere inviti a futuri eventi di community DTD** — base `Art. 6.1.a`, opzionale, revocabile.

Solo il secondo flag crea/aggiorna la `Person` con `optedInToAddressBook=true`. Senza di esso, `Person` non viene creata e `Registration.personId` resta null. Il pattern è coerente con quello di Teams/Google Workspace (che conservano i contatti solo dopo consenso esplicito).

### 3. Distinzione fra campi profilo stabili e risposte evento

- **Campi profilo stabili** (nome, email, ente, ruolo, tipologia ente): attributi della `Person`. Al refresh del form di registrazione per un nuovo evento, se l'emailHash matcha una `Person` esistente con opt-in attivo, il form pre-compila questi campi. L'utente può sempre modificarli (sovrascrivono il profilo). Non c'è "ripetizione della domanda" — c'è un profilo che si aggiorna.
- **Risposte evento-specifiche** (feedback su un talk, sondaggio su un argomento, questionario post-evento dedicato): legate a `QuestionnaireResponse` → `Registration` → `Event`. Scadono con la retention dell'evento. **Non vengono mai deduplicate** né copiate sulla `Person`.

Questa distinzione risolve il dilemma "conservare la risposta oltre l'evento": non la conserviamo. Conserviamo il profilo, che per sua natura è un dato anagrafico aggiornato.

### 4. Retention della `Person`

La `Person` ha una retention propria, **indipendente** dagli eventi. Default: **24 mesi di inattività** (`lastActiveAt + 24m < NOW()` → purge automatica). Configurabile dall'admin a livello di Site Setting.

Al purge:
- la `Person` viene cancellata
- `Registration.personId` delle registrazioni ancora in vita viene impostato a `null` (la Registration resta finché non scade per conto suo)
- record nell'audit log GDPR (già esistente)

### 5. Opt-out autonomo e diritto all'oblio

Endpoint pubblico `POST /api/rubrica/opt-out` con token one-time inviato via email (token non-enumerabile, scadenza 30gg, rinnovabile). La pagina pubblica `/rubrica/opt-out/[token]` mostra i dati in rubrica, il pulsante "rimuovimi ora" (soft-delete: `optedOutAt=NOW()`), e opzione "cancella tutto" (hard-delete: Person + tutte le Registration associate, oltre la normale retention evento — questo implementa `Art. 17`, diritto alla cancellazione).

Il link all'opt-out è presente in **ogni email inviata dal sistema** ai membri della rubrica (footer obbligatorio, come le newsletter).

### 6. Cosa **non** entra nel modello

Esplicitamente escluso dalla `Person` per limitare il perimetro:

- **Telemetria AV** (ha usato microfono/camera/screen share, quanto a lungo) — profilazione comportamentale, richiederebbe una terza base giuridica. Se serve una metrica di uso, la calcoliamo **aggregata per evento**, mai per persona.
- **Contenuti di risposte aperte** ai questionari — restano sul singolo evento. Non finiscono nel profilo.
- **Testo delle domande Q&A poste in live** — restano sul singolo evento.
- **Dati geografici o tecnici** (IP, user-agent, device) — già minimizzati oggi e non replicati in `Person`.

## Conseguenze

### Positive

- **Esperienza moderatori**: possono invitare persone dalla rubrica senza riscrivere email, come in MS Teams.
- **Esperienza partecipanti**: form pre-compilato alla registrazione successiva; meno attrito.
- **Privacy by design**: la rubrica esiste **solo** per chi ha dato opt-in esplicito, è separata dai dati di partecipazione, ha retention propria, è revocabile in autonomia.
- **Separazione dei dati**: un data breach sulla tabella `registrations` non espone la rubrica (e viceversa). La Person non contiene risposte sensibili.
- **Conforme ai principi GDPR**: minimizzazione (solo campi necessari per l'invito), limitazione finalità (solo invitare), limitazione conservazione (retention automatica), trasparenza (doppio consenso visibile).

### Negative

- **Complessità implementativa**: +1 modello, +1 FK nullable, +1 endpoint pubblico, +1 cron, +1 flusso di registrazione condizionale.
- **Informativa privacy da aggiornare**: serve coordinamento con DPO/legale.
- **Migrazione dati esistenti**: le `Registration` attuali non hanno `personId`; rimarranno `null` (nessuna retroattività, gli utenti attuali entrano in rubrica solo se opt-in al prossimo evento). Accettabile per ora.

### Rischi da monitorare

- **Collisione emailHash**: usiamo la stessa funzione di hash di `Registration.emailHash` per coerenza, salt applicativo. Collisioni praticamente nulle per il volume atteso, ma documentato come non-problema.
- **Race condition opt-out**: se un utente fa opt-out mentre parte una registrazione a un nuovo evento, quella `Registration` potrebbe finire con `personId` valido. Gestito con un check finale al commit del form.
- **Drift profilo**: se l'utente cambia ente tra due eventi, il profilo viene aggiornato e il pre-compile del form successivo usa il nuovo valore. Lo storico ente-al-momento-dell'evento resta **solo sulla Registration** (snapshot), non sulla Person.

## Alternative scartate

### A1. "Rubrica come vista aggregata su Registration attive"

Invece di creare un modello `Person`, ricavare la rubrica da `SELECT DISTINCT emailHash, MAX(displayName) FROM registrations WHERE consent_future_invites = true`. **Scartata** perché: (a) i dati di Registration scadono con l'evento, quindi la rubrica si svuoterebbe appena gli eventi vanno in retention; (b) la finalità di "rubrica" è diversa da "registrazione a un evento" e il GDPR vuole che i dati con finalità diverse siano separati.

### A2. Opt-in unico che copre sia partecipazione sia rubrica

Un solo consenso "partecipo e voglio essere contattato in futuro". **Scartata** perché viola `Art. 7.2` (il consenso deve essere distinguibile per finalità) e `Art. 7.4` (non condizionare un servizio al consenso per finalità ulteriori).

### A3. Profilo persona ricco (include telemetria AV, engagement score, preferenze)

**Scartata** per data minimization e per evitare la categoria di "profilazione" (`Art. 22`), che richiederebbe ulteriori tutele.

### A4. Deduplica anche delle risposte evento-specifiche

Idea iniziale: se un utente ha risposto "come valuti il Q&A?" per l'evento X, non glielo richiedo per l'evento Y. **Scartata** perché la risposta al Q&A di X non ha significato per Y; sarebbe mantenere un dato oltre la sua finalità. Deduplica solo per campi **profilo stabili**.

## Rollout

1. **Schema + migration**: aggiunta modello `Person`, FK nullable su `Registration`, indici su `emailHash`, `optedInToAddressBook`, `lastActiveAt`.
2. **Backend**: service `lib/person/*` per create/update/touch (aggiorna `lastActiveAt`), endpoint opt-out pubblico, cron retention.
3. **Frontend form registrazione**: secondo checkbox, pre-compile campi profilo se emailHash matcha.
4. **Admin UI**: sezione `/admin/rubrica` (lista con filtri, dettaglio persona, export CSV, rimuovi-da-rubrica manuale).
5. **Informativa privacy**: aggiornare `docs/GDPR.md` + testi in-app; coordinamento DPO.
6. **Audit**: ogni create/update/delete `Person` registrato in `GdprAuditLog`.

## Riferimenti

- `docs/GDPR.md` — informativa attuale (da aggiornare a rollout)
- `app/prisma/schema.prisma` — modelli `Registration`, `EventFeedback`, `GdprAuditLog`
- ADR-004 (JWT partecipanti): pattern emailHash già consolidato
- ADR-010 (SiteSetting): pattern singleton per retention configurabile
- Regolamento UE 2016/679 (GDPR): Art. 5.1.b, 5.1.c, 5.1.e, 6.1.a, 6.1.b, 7.2, 7.4, 17, 21, 22
