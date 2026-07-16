/**
 * Public changelog — curated release history for pa-webinar.
 *
 * Source of truth for the `/changelog` page (linked from the footer version
 * number). Entries are hand-curated from git tags, merged PRs, commit messages
 * and the roadmap (docs/ROADMAP.md), newest first. Content is in Italian (the
 * primary audience for release notes); the page chrome is localized via the
 * `changelog` i18n namespace.
 *
 * When cutting a new release, prepend an entry here (version without the "v"
 * prefix, ISO date, a short theme `title`, and a handful of user-facing
 * `notes`). Keep bullets outcome-oriented — what changed for operators and
 * participants — not raw commit subjects.
 */

export type ChangelogEntry = {
  /** Semantic version without the leading "v" (matches NEXT_PUBLIC_BUILD_VERSION). */
  version: string;
  /** ISO date (YYYY-MM-DD) of the release tag. */
  date: string;
  /** Short Italian theme for the release. */
  title: string;
  /** User-facing highlights, most notable first. */
  notes: string[];
  /** Marks a release whose primary purpose was security/dependency hardening. */
  security?: boolean;
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.7.7',
    date: '2026-07-16',
    title: 'Meno rumore di fondo quando parli',
    notes: [
      'Cancellazione avanzata del rumore di fondo attiva quando prendi la parola: attenua meglio rumori come tastiera, ventole o traffico, oltre alla soppressione di base già presente.',
    ],
  },
  {
    version: '0.7.6',
    date: '2026-07-16',
    title: 'Volume per partecipante',
    notes: [
      'Nuovo controllo del volume per singolo partecipante nel pannello “Partecipanti”: se una voce si sente troppo alta o troppo bassa, la regoli solo per te, senza cambiare l’audio degli altri.',
      'Registrazione audio separata per-partecipante (per la post-produzione) più affidabile: se la cattura risulta muta, il sistema lo rileva subito ed evita di generare trascrizioni vuote.',
    ],
  },
  {
    version: '0.7.5',
    date: '2026-07-16',
    title: 'La mano alzata resta alzata',
    notes: [
      'Quando alzi la mano ora resta alzata finché non la abbassi tu (o un moderatore la gestisce): prima si abbassava da sola nel momento in cui iniziavi a parlare, facendoti “sparire” dalla coda degli interventi.',
    ],
  },
  {
    version: '0.7.4',
    date: '2026-07-15',
    title: 'Nome in chat protetto dai link inoltrati (sicurezza)',
    security: true,
    notes: [
      'In chat il nome reale di una persona iscritta viene mostrato soltanto sul dispositivo con cui si è registrata: chi apre un suo link di partecipazione inoltrato interviene con il nome che digita, non a nome dell’iscritto originale. Chiusa così un’attribuzione impropria dei messaggi.',
      'Stessa protezione per gli allegati: un file inviato da un link inoltrato non viene più attribuito al nome dell’iscritto originale.',
      'Chi si collega da un secondo dispositivo (ad esempio dal telefono) o con il link ricevuto in anticipo continua a partecipare, scrivere in chat e inviare allegati senza interruzioni: cambia solo il nome mostrato, che diventa quello digitato al momento dell’ingresso.',
    ],
  },
  {
    version: '0.7.3',
    date: '2026-07-15',
    title: 'Conteggio presenze corretto, reazioni al centro e ritocchi sala',
    notes: [
      'Il conteggio dei presenti non moltiplica più la stessa persona che esce e rientra (per esempio con il tasto “Indietro” del browser): i collegamenti doppi della stessa persona vengono contati una sola volta. La lista partecipanti continua a mostrare ogni collegamento, così il moderatore può sempre vedere e gestire tutti.',
      'La barra delle reazioni/emoji è ora centrata in basso, ben visibile e facile da trovare, invece che nell’angolo in basso a sinistra.',
      'Il numero di iscritti non è più mostrato pubblicamente sulla pagina dell’evento e nell’elenco eventi: resta visibile agli amministratori nel pannello. Durante la diretta il pubblico vede soltanto il numero dei presenti.',
      'Soppressione del rumore di fondo attiva automaticamente su tutti i microfoni (l’elaborazione audio di base — eco e rumore — è sempre abilitata, senza bisogno di attivarla a mano).',
      'Ingresso in sala leggermente più rapido: il “risveglio” del sistema video parte già al clic sul pulsante di ingresso.',
    ],
  },
  {
    version: '0.7.2',
    date: '2026-07-15',
    title: 'Chat più ricca: allegati, risposte e menzioni',
    notes: [
      'In chat è ora possibile inviare immagini e allegati (PNG, JPEG, WebP, GIF e PDF, fino a 10 MB), con anteprima direttamente nel messaggio.',
      'Nuova funzione “Rispondi”: si può citare un messaggio specifico e la citazione resta visibile nel filo della conversazione.',
      'Menzioni con @: è possibile richiamare un partecipante per nome all’interno di un messaggio.',
      'Moderazione della chat: i moderatori possono rimuovere singoli messaggi durante l’evento.',
    ],
  },
  {
    version: '0.7.1',
    date: '2026-07-09',
    title: 'Statistiche post-evento per ogni evento',
    notes: [
      'Nuova scheda “Statistiche” per ogni evento nel pannello amministratore (disponibile anche per gli eventi senza registrazione o senza registrazione video): mostra l’andamento della call, chi ha parlato di più, il grado di partecipazione complessivo e i principali indicatori.',
      'Grafico dell’andamento dell’interazione nel tempo — chat, domande, voti alle domande, sondaggi, parole della word cloud e reazioni — con evidenziato il momento di picco della call.',
      'Classifica di chi ha parlato più a lungo (minuti a testa) con l’equilibrio degli interventi, insieme ai conteggi delle reazioni e delle alzate di mano.',
      'Nuova stima della permanenza media dei partecipanti in sala, usata anche nel calcolo del grado di attenzione complessivo.',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-07-09',
    title: 'Relatori modificabili e player solo-audio',
    notes: [
      'Nel post-evento è ora possibile rinominare i relatori, correggendo i nomi degli speaker riconosciuti automaticamente dalla trascrizione.',
      'Se la registrazione non ha un video riproducibile, la pagina di correzione mostra comunque un player solo-audio per riascoltare e sistemare testo e speaker.',
      'Correzione della registrazione multi-traccia: ora viene catturato correttamente l’audio reale dei partecipanti remoti.',
    ],
  },
  {
    version: '0.6.9',
    date: '2026-07-09',
    title: 'Affidabilità dell’elaborazione AI',
    notes: [
      'Il pannello amministratore mostra ora un indicatore di affidabilità dell’elaborazione AI post-evento (trascrizione, sintesi, traduzioni), per capire a colpo d’occhio se il risultato è completo e attendibile.',
    ],
  },
  {
    version: '0.6.8',
    date: '2026-07-08',
    title: 'Pagina di editing post-evento più chiara',
    notes: [
      'La pagina di correzione (trascrizione, sintesi, traduzioni) ora spiega quando i contenuti AI non sono ancora disponibili — “elaborazione in corso” oppure “avvia l’elaborazione dai controlli in alto” — invece di mostrare un errore rosso che sembrava un guasto.',
      'Un salvataggio non riuscito viene ora mostrato in rosso e riporta il motivo specifico restituito dal server, invece di apparire in verde come se fosse andato a buon fine.',
      'Sessione amministratore scaduta e problemi di caricamento vengono ora distinti con messaggi dedicati (invece di un unico errore generico).',
      'Se l’audio della registrazione non è riproducibile, la pagina lo segnala e resta comunque possibile correggere testo e speaker dei segmenti.',
    ],
  },
  {
    version: '0.6.7',
    date: '2026-07-08',
    title: 'Reazioni sempre visibili e “Note / Checklist”',
    notes: [
      'Le reazioni (emoji) sono ora sempre visibili in una barra in basso a sinistra, non più nascoste dietro un pulsante: più facili da trovare e da usare durante l’evento.',
      'La funzione “Agenda” è stata rinominata “Note / Checklist” per rendere evidente che è un’area di note a checklist (i contenuti non finiscono in chat); resta attivabile dal moderatore per ogni evento.',
    ],
  },
  {
    version: '0.6.6',
    date: '2026-07-08',
    title: 'Rifiniture: chat, conteggi e accesso',
    notes: [
      'I link condivisi in chat sono ora cliccabili e si aprono in una nuova scheda in modo sicuro (prima erano semplice testo).',
      'In sala, il numero di iscritti totali è ora visibile solo ai moderatori: i partecipanti vedono soltanto quante persone sono effettivamente presenti.',
      'Accesso alla sala più rapido: la connessione al server video viene preparata già durante la sala d’attesa, riducendo l’attesa al momento dell’ingresso.',
      'Nella lista partecipanti l’intestazione con il conteggio resta sempre visibile mentre si scorre l’elenco.',
    ],
  },
  {
    version: '0.6.5',
    date: '2026-07-08',
    title: 'Registrazioni e conteggi',
    notes: [
      'Il conteggio dei presenti in sala esclude ora il registratore: mostra solo le persone reali, non il bot che cattura l’audio.',
      'Post-produzione: nuovo pulsante “Genera AI” per avviare trascrizione, sintesi e traduzione anche sulle registrazioni solo-audio (una traccia per partecipante), che prima non mostravano alcun controllo di avvio.',
      'Nell’elenco delle tracce, ai soprannomi è affiancato un identificativo: persone diverse con lo stesso soprannome ricevono identificativi distinti, mentre più interventi della stessa persona condividono lo stesso identificativo.',
      'Messaggio chiaro quando l’avvio della pipeline non accoda alcun lavoro (AI disattivata per l’evento o pipeline in pausa), invece di un falso “operazione riuscita”.',
    ],
  },
  {
    version: '0.6.4',
    date: '2026-07-08',
    title: 'Sicurezza dell’identità e rifiniture della sala',
    notes: [
      'Correzione di sicurezza: condividendo il proprio link personale della sala, chi lo apre entra ora con il PROPRIO nome (prima poteva ereditare il nome di chi aveva inviato il link).',
      'Condivisione schermo più nitida: ora privilegia la risoluzione (5 fps ad alta qualità) invece della fluidità, così slide e documenti restano leggibili anche quando c’è poco movimento.',
      'Rimossa la funzione “nascondi la tua immagine” che, una volta attivata, non permetteva più di far riapparire il proprio riquadro.',
      'Accesso amministratore: dopo una nuova autenticazione a seguito di inattività, la pagina si aggiorna correttamente (niente più pagina apparentemente bloccata fino al ricaricamento manuale).',
    ],
    security: true,
  },
  {
    version: '0.6.3',
    date: '2026-07-08',
    title: 'Rifiniture della sala evento — round 2',
    notes: [
      'Il timer di presentazione è ora integrato nella barra dei controlli del moderatore, senza occupare una riga dedicata; la barra del conto alla rovescia compare solo quando il timer è attivo.',
      'In chat compare il nome reale di chi scrive, non più un generico “Moderatore”.',
      'La chat è diventata un pannello a sé nella barra laterale (non più sempre sovrapposta agli altri contenuti): interfaccia più pulita, con il contatore dei messaggi non letti sul tab.',
      'Nuovo pulsante “Lavagna” per i moderatori, per aprire la lavagna condivisa direttamente dalla barra dei controlli.',
      'Pulsante “Condividi” con colore corretto (non più confondibile con “Esci”), icone accanto ai link e, per i soli moderatori, il link di moderazione nascosto dietro un avviso per invitare altri moderatori senza sbagliare.',
      'La nuvola di parole non è più attiva di default: resta attivabile a scelta dal moderatore durante l’evento.',
    ],
  },
  {
    version: '0.6.2',
    date: '2026-07-08',
    title: 'Rifiniture della sala evento in diretta',
    notes: [
      'La barra dei controlli (microfono, webcam, condivisione schermo) resta sempre visibile e cliccabile, anche a schermo intero, durante una condivisione o quando si è da soli in sala.',
      'Il moderatore può di nuovo attivare e disattivare le funzioni live (Domande, Chat, Agenda) durante l’evento.',
      'I controlli audio e video sono utilizzabili già durante la preparazione della sala, senza attendere l’avvio del server video.',
      'L’elenco “Mani alzate” mostra correttamente chi ha chiesto la parola.',
      'Nuovo pulsante “Condividi” nella sala: copia al volo il link per partecipare e il link della pagina evento (senza esporre token riservati).',
      'Il marchio PA Webinar torna visibile nella barra superiore della sala evento.',
    ],
  },
  {
    version: '0.6.1',
    date: '2026-07-07',
    title: 'Changelog pubblico e aggiornamenti di sicurezza',
    notes: [
      'Nuova pagina changelog pubblica, raggiungibile cliccando il numero di versione nel footer: elenca tutte le versioni della piattaforma con le principali novità.',
      'Aggiornamenti di sicurezza delle dipendenze (undici, nodemailer) e hardening della pipeline di build (scansione vulnerabilità).',
    ],
    security: true,
  },
  {
    version: '0.6.0',
    date: '2026-07-07',
    title: 'Workflow post-evento e sala d’attesa interattiva',
    notes: [
      'Nuovo workflow di fine evento: al termine il moderatore sceglie la destinazione della registrazione (pubblica sulla pagina, in libreria o solo in archivio) con un prompt dedicato.',
      'Recap post-evento automatico e anonimizzato (partecipanti, domande più votate, risultati sondaggi, nuvola di parole, valutazioni) mostrato su ogni pagina di evento concluso, anche senza registrazione.',
      'Email di riepilogo post-evento ai partecipanti, con i contenuti dell’evento.',
      'Sala d’attesa “Piazza Digitale” interattiva: si cammina con il proprio avatar fino al varco per entrare in call, sempre affiancata dal pulsante di ingresso classico.',
      'Nuvola di parole come sezione dedicata nella pagina di evento concluso, con toggle di visibilità per l’admin.',
      'Lavagna condivisa (whiteboard) abilitabile per singolo evento e da template.',
      'Revisione UX del wizard di creazione evento: opzioni avanzate collassate, moderatore principale con link, avvisi PII, salvataggio bozza e gestione errori parziali.',
      'Retention differenziata delle registrazioni e delle tracce audio per-relatore, allineata al segnale “video pubblicato”, con pulizia GDPR della chat.',
    ],
  },
  {
    version: '0.5.11',
    date: '2026-06-17',
    title: 'Rifiniture moderazione, chiusura call e audio',
    notes: [
      'I moderatori compaiono con il proprio nome reale invece di un generico “Moderatore”.',
      'Schermata di chiusura in-app quando l’evento termina (niente più “Sala in preparazione”).',
      'Correzione della sovrapposizione di icone nella sala d’attesa.',
      'Soppressione del rumore forzata su OFF via IFrame API per risolvere problemi audio.',
    ],
  },
  {
    version: '0.5.9',
    date: '2026-06-17',
    title: 'Registrazione multi-traccia stabile, feedback a stelle e performance',
    notes: [
      'Registrazione per-relatore (multi-traccia) resa affidabile end-to-end: audio completo per traccia, niente troncamenti, upload paralleli.',
      'Questionario di feedback post-evento a stelle con dashboard di riepilogo per l’admin.',
      'Miglioramenti di performance: codec VP9 per la webcam, caricamento lazy su mobile, tuning del recorder.',
      'Hook post-upgrade Helm che ricarica automaticamente la config.js di Jitsi.',
    ],
  },
  {
    version: '0.5.8',
    date: '2026-06-16',
    title: 'Qualità video/audio configurabile e nuovo flusso di ingresso',
    notes: [
      'Controllo della qualità video/audio configurabile dall’admin (preset per evento).',
      'Redesign del flusso di join (registrazione → sala d’attesa → videocall).',
      'L’alzata di mano mostra il nome reale di ciascun partecipante.',
    ],
  },
  {
    version: '0.5.6',
    date: '2026-06-12',
    title: 'Sala d’attesa configurabile e copertine evento',
    notes: [
      'Motore della sala d’attesa configurabile (videogioco / giardino / classica), a livello di sito e di singolo evento.',
      'Immagini di copertina sulla pagina evento e nelle miniature delle card.',
      'File caricati serviti tramite route dedicata con URL firmati a breve scadenza.',
      'Pulsante “Entra ora” immediato subito dopo la registrazione.',
      'Consolidamento della sezione admin per la gestione delle registrazioni AI e irrobustimento della cattura multi-traccia.',
    ],
  },
  {
    version: '0.5.2',
    date: '2026-06-11',
    title: 'Preparazione evento e rifiniture',
    notes: [
      'Agenda con assenso/dissenso e correzioni ai permessi ereditati da template.',
      'Nomi reali (non “SPEAKER_00”) in sintesi e sottotitoli.',
      'Serie di hotfix (v0.5.2–v0.5.5) in preparazione degli eventi pubblici.',
    ],
  },
  {
    version: '0.5.1',
    date: '2026-06-05',
    title: 'Home community-first e archivio multi-traccia',
    notes: [
      'Redesign della home in ottica community-first con override di traduzione a runtime e accessibilità AgID.',
      'Archivio MKV multi-traccia con player di riascolto per singolo relatore.',
      'Allineamento delle tracce multi-traccia al mix Jibri tramite cross-correlazione.',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-06-04',
    title: 'Post-produzione AI e registrazione multi-traccia',
    notes: [
      'Pipeline di post-produzione AI: trascrizione, sintesi, sottotitoli, traduzioni e doppiaggio multivoce (sempre sintetico), con provenienza dei modelli tracciata.',
      'Registrazione multi-traccia (una traccia per relatore) con attribuzione speaker e naming automatico (ADR-013).',
      'Libreria video pubblica e pagina di gestione post-evento per l’admin.',
      'Editor della trascrizione post-evento con correzione testo e riassegnazione speaker.',
      'Overhaul della UX admin: toast e modali .italia al posto di alert nativi, skeleton loader, design token colori al posto di centinaia di hex hardcoded.',
      'Consenso per-partecipante alla registrazione multi-traccia (GDPR) ed export Art.15 esteso.',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-04-24',
    title: 'Engagement & Lifecycle',
    notes: [
      'Nuove funzioni live: nuvola di parole, timer di presentazione, contatore reaction, controlli live in stile Meet e pannello mani alzate.',
      'Ciclo di vita delle registrazioni (temporanea → pubblicata) con gestione admin (anteprima, pubblica, elimina) e retention differenziata.',
      'Pagina post-evento a schede (registrazione, archivio Q&A, sondaggi, feedback, materiali) con configurazione di cosa esporre e quando.',
      'Wizard di creazione evento in 5 step, tassonomia dei tag, rubrica contatti (Person) e title-kicker editoriale.',
      'Libreria video pubblica `/video-library` e trasparenza `/service-inventory` (CycloneDX 1.6 per-tenant).',
      'Autoscaling JVB a due fasi con snapshot Redis per la pagina di stato.',
      'Cleanup GDPR a 3 fasi (PII immediata / contenuti a retention / hard delete).',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-04-03',
    title: 'Piattaforma configurabile e infrastruttura',
    notes: [
      'Site settings per il riuso da parte di altre PA (branding, colori, favicon, SEO, footer, modalità home, privacy/accessibilità) senza rebuild.',
      'Dashboard di analytics e pannello admin dell’infrastruttura.',
      '3 modalità di deploy Helm (simple / standard / full) e JVB scale-to-zero con nodepool dedicato.',
      'Pipeline Jibri multi-cloud (Azure Blob / S3 / GCS / MinIO / local) e watermark Jitsi configurabile.',
      'OpenSSF Scorecard, Dependabot, SBOM delle dipendenze, gestione errori centralizzata, rate limiting e oltre 210 test unitari.',
      'Numerosi incrementi (v0.3.8–v0.3.45) a seguito del feedback post-demo.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-04-01',
    title: 'Feedback DTD',
    notes: [
      'Profilazione dei partecipanti in registrazione (ente, ruolo, tipologia) configurabile per evento, con export CSV e statistiche aggregate.',
      'Reminder configurabili con più offset ed email differenziate.',
      'Sondaggi/polling con risultati real-time ed export CSV.',
      'Miglioramenti GDPR: privacy policy per evento, consensi granulari, audit log delle cancellazioni ed export dati Art.15.',
      'Consolidamento dei ruoli Moderatore / Auditore e audit delle licenze delle dipendenze.',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-03-31',
    title: 'MVP — prima versione',
    notes: [
      'Piattaforma pubblica per eventi digitali con design system .italia (Bootstrap Italia, design-react-kit).',
      'Sala live con Jitsi Meet (IFrame API, autenticazione JWT) e ruoli enforced server-side.',
      'Registrazione partecipanti GDPR-compliant con PII cifrate (AES-256-GCM).',
      'Q&A con upvoting e moderazione, sala d’attesa con countdown e accesso guest.',
      'Email di conferma/reminder, integrazione calendario (Google, Outlook, Yahoo, iCal).',
      'Pannello admin con autenticazione API key, cleanup GDPR, metriche Prometheus.',
      'Helm chart production-grade, Docker non-root/read-only, CI/CD GitHub Actions, publiccode.yml.',
    ],
  },
];
