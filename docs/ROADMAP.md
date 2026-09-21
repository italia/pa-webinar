# Roadmap — pa-webinar

Questo documento elenca **solo ciò che manca**. Cosa la piattaforma fa già è nel [README](../README.md#funzionalità); cosa è stato rilasciato e quando è nel [CHANGELOG](../CHANGELOG.md) e sulla pagina pubblica `/changelog`.

Le voci non hanno un numero di versione: un numero è una promessa con una data implicita, e quando slitta il documento inizia a mentire. Al suo posto ogni voce porta **da quando è aperta**, così uno slittamento resta visibile invece di essere riassorbito in silenzio.

## Installazione ed esercizio

È il lavoro in corso, ed è la parte più indietro rispetto a ciò che il progetto dichiara di essere. La piattaforma è in esercizio, ma l'istanza che gira ci è arrivata a mano, un intervento alla volta: il repo non contiene ancora un percorso che un'altra amministrazione possa ripercorrere da sola. Finché è così, "software a riuso" resta una dichiarazione di intenti.

Tutte le voci di questa sezione sono **aperte da luglio**.

| Voce | Dove siamo |
|---|---|
| **Un'installazione esercitata da zero** | Il chart si rende su tutti i profili e i manifesti prodotti sono validi, ma nessuno ha mai percorso l'installazione per intero su un cluster pulito fino a un evento che funziona. Finché è così, "si installa" significa soltanto "si rende senza errori": restano fuori dalla verifica il rilascio dei certificati, la raggiungibilità del bridge video, l'invio delle email e tutto ciò che dipende dall'ambiente. Serve una prova periodica, non una tantum |
| **Immagini scaricabili, verificabili e fissate a una versione** | Nessuna delle immagini pubblicate accetta un prelievo anonimo: chi clona il repo non può scaricarne nemmeno una. Tre componenti su cinque — registrazione multi-traccia, controller di attribuzione e pipeline di post-produzione — non hanno affatto una versione, escono solo con un tag mobile riscritto a ogni modifica del ramo di sviluppo, ed è il tag che il chart usa come predefinito: chi installa il chart di una versione riceve ciò che è uscito ieri, e un ritorno a una versione precedente non li riporta indietro. Le immagini pubblicate non sono né scansionate né firmate, e sono costruite per una sola architettura |
| **Installazione su un solo server** | Non tutte le amministrazioni hanno un cluster, e per chi fa un evento al mese non lo giustifica. Oggi l'unico percorso che arriva davvero a un'istanza in piedi è Docker Compose, che però è un ambiente di sviluppo e si comporta come tale: i segreti stanno nel file tracciato, non c'è TLS — e senza TLS il cookie di sessione, che è `Secure`, non esce da `localhost` —, dei lavori periodici ne girano tre su otto, quindi la retention dei dati personali non viene mai applicata, e mancano archivio a oggetti e TURN. La scelta da fare è se portare quel percorso in esercizio o dare una ricetta mono-nodo su k3s; in entrambi i casi serve un archivio a oggetti installabile accanto al resto, che oggi non c'è in nessuna forma |
| **Portabilità fra fornitori** | Lo strato di archiviazione a oggetti è scritto per più fornitori ed è la parte meglio documentata del progetto, ma sopra ci sono due punti che non lo seguono: il caricamento dei video dal pannello di amministrazione passa dall'SDK di un fornitore dentro il browser, quindi su un'installazione S3 non funziona, e nessun test esercita quello strato — la matrice di compatibilità è affermata, non verificata. Sotto, le note per i singoli cloud si riducono a un `nodeSelector` e al comando per creare il pool di nodi dei bridge, eseguibile per uno solo di essi, e la pipeline di post-produzione ha una sola procedura, scritta per un cloud solo. Serve dichiarare cosa è portabile davvero e chiudere i punti in cui non lo è |
| **Ingresso oltre ingress-nginx** | Il chart configura l'ingresso con annotazioni di NGINX, e su un altro controller vengono ignorate senza dirlo: si perdono il tempo di vita delle connessioni lunghe da cui dipendono i canali della sala, il limite di frequenza, la dimensione massima dei caricamenti e il reindirizzamento della radice del dominio della conferenza. Con un controller che parla solo Gateway API il chart non produce nulla di utilizzabile, perché non ha risorse di instradamento. Le due strade sono rendere configurabile ciò che oggi è scritto come annotazione, e affiancare agli `Ingress` un instradamento Gateway API |
| **Backup e ripristino** | Non esistono in nessuna forma: nessuna procedura, nessun lavoro periodico, nessuna riga nella documentazione oltre a un «configura i backup del database» nelle note di fine installazione. Prima della procedura va dichiarata la superficie: banca dati, archivio a oggetti (registrazioni, tracce, artefatti di post-produzione, allegati, immagini caricate), la configurazione che vive in banca dati, e le chiavi — perdere quella che cifra i dati personali rende illeggibile ogni dato personale, e oggi nessun documento dice che va conservata insieme alla copia. Va stabilito anche l'ordine delle operazioni: rimettere una copia della banca dati più vecchia dell'archivio fa cancellare i file dalla riconciliazione, che non li trova più referenziati |
| **Accorgersi che qualcosa non va** | Gli allarmi coprono applicazione, banca dati, bridge video e TURN. Non copre niente i lavori periodici, la coda delle email, la retention e lo spazio su disco: cioè le cose che si rompono in silenzio. La pulizia dei dati scaduti, in più, risponde «fatto» anche quando non cancella niente, perché tratta l'errore evento per evento e restituisce comunque esito positivo: un guasto che la blocca ovunque produce un lavoro verde. Servono allarmi su quel perimetro e rotte periodiche che falliscano davvero quando falliscono |
| **Sapere di aver installato bene, e poter tornare indietro** | Finita l'installazione non c'è modo di verificare che l'istanza funzioni: la verifica documentata guarda che i pod siano avviati, non che si riesca a creare un evento ed entrare in sala. La procedura di ritorno a una versione precedente sta in quattro righe e non affronta il punto che conta, cioè cosa succede alle migrazioni — additive per scelta, ma non è scritto lì — e ai tre componenti che un ritorno indietro non riporta indietro |

## Prossimo

| Voce | Dove siamo |
|---|---|
| **La cancellazione su richiesta cancella tutto**<br/>*aperta da luglio* | La rotta che esegue il diritto alla cancellazione elimina le iscrizioni e si affida alle cascate, ma le cascate non arrivano ovunque: i messaggi in chat non hanno una chiave verso l'iscrizione, quindi nome del mittente e testo restano; le risposte ai questionari perdono il collegamento ma conservano nome e impronta dell'indirizzo; restano inviti, tracce audio e la voce in rubrica. Chi esercita il diritto riceve una conferma mentre parte dei suoi dati sopravvive fino alla scadenza dell'evento |
| **La coda delle email non viene mai svuotata**<br/>*aperta da luglio* | Le righe della coda contengono destinatario, nome e link di accesso, cifrati. Vengono create e marcate come spedite, e non le cancella nessuno: nessuna scadenza, nessuna retention. Non essendo legate a un evento sfuggono anche alla guardia che verifica l'esaustività della pulizia, che ragiona per evento |
| **Le tracce dei partecipanti senza pipeline di post-produzione**<br/>*aperta da luglio* | La cancellazione dell'audio grezzo per partecipante scatta quando la trascrizione multi-traccia è completata. Su un'installazione che registra ma non fa girare la post-produzione quel passaggio non avviene mai, e le tracce restano nell'archivio a tempo indeterminato, qualunque sia la retention dell'evento. È la configurazione più probabile per chi riusa la piattaforma |
| **Trascrizioni oltre la soglia di replica**<br/>*aperta da luglio* | Il testo prodotto dalla pipeline viene replicato in banca dati solo sotto una certa dimensione; sopra vive nel solo archivio a oggetti. Il pannello pubblico e l'editor leggono soltanto la copia in banca dati e non ricadono sull'archivio, quindi per un evento di durata reale il pannello si apre vuoto e l'editor non trova il testo. Vale per la registrazione più lunga, non per la più corta: è il percorso che regge il verbale |
| **Accessibilità: una misura, non una dichiarazione**<br/>*aperta da luglio* | La pagina di dichiarazione esiste ed è costruita sul modello richiesto, ma rimanda lo stato di conformità effettivo a una valutazione che nessuno ha fatto. Nel progetto non c'è nessuno strumento di verifica automatica, e i test in browser non contengono una sola asserzione di accessibilità. Per un prodotto soggetto agli obblighi di legge, «progettato per essere conforme» senza una misura è l'unica affermazione che non si può sostenere |
| **Consenso granulare al trattamento automatico**<br/>*aperta da luglio* | In banca dati ci sono tre colonne per il consenso di ciascun partecipante a trascrizione, sintesi e traduzione: nessuno le scrive e nessuno le legge. Ciò che governa davvero la pipeline è la configurazione dell'evento. O il consenso diventa per persona come lo schema promette, o le colonne vanno tolte: così com'è, il modello dei dati dichiara una garanzia che il prodotto non dà |
| **Batteria E2E Playwright**<br/>*aperta da marzo* | I test in browser sono due file: uno copre la sala d'attesa e l'arrivo al pulsante d'ingresso, l'altro è una guardia sul colore della fascia istituzionale. Nessuno dei due entra davvero in conferenza, e il pannello di amministrazione è esercitato solo via API. Restano scoperti Q&A, sondaggi, cambio lingua, cancellazione su richiesta, scarico del `.ics` e chat su più repliche. Il lavoro è dichiarato non bloccante — come l'analisi statica di sicurezza e lo Scorecard: oggi nessuno dei tre protegge da una regressione |

## Dopo

| Voce | Dove siamo |
|---|---|
| **Controllo d'accesso sugli allegati in chat** | Oggi un allegato è protetto da un indirizzo non indovinabile (vedi "Limiti noti"): la rotta che li serve non valuta nessuna autorizzazione. Il controllo vero richiede un cookie con ambito su quella rotta, riletto a ogni richiesta, così che una password aggiunta o un evento chiuso abbiano effetto subito. Un token nell'indirizzo non basta ed è già stato scartato due volte |
| **Rate-limiting distribuito** | Il contatore dei limiti di frequenza vive nella memoria del singolo processo, mentre il chart di serie porta più repliche dell'applicazione: ogni limite risulta moltiplicato per il numero di repliche. Serve un contatore condiviso su Redis — che è già nel percorso realtime, quindi la scelta si porta dietro il punto sull'alta affidabilità in "Condizionale" — e una decisione su cosa fare quando Redis non risponde |
| **Distinguere ovunque il testo della macchina da quello rivisto**<br/>*aperta da luglio* | Per la trascrizione la versione prodotta dalla macchina viene conservata e l'editor mostra le due a confronto. L'editor delle sintesi e delle traduzioni no: alla prima correzione riscrive l'artefatto e l'originale sparisce. E la distinzione si ferma al pannello di amministrazione — chi legge il verbale dal sito vede il testo corretto senza sapere che una persona è intervenuta, né su quali righe |
| **Export del report di evento**<br/>*aperta da marzo* | Statistiche, Q&A, sondaggi e partecipanti in un unico documento scaricabile. I dati sono già tutti aggregati lato server e alimentano la pagina pubblica di fine evento e l'email di riepilogo, ma non finiscono mai in un file: esistono vari export parziali in CSV, testo e sottotitoli, nessuno dei quali è il report. Per il PDF non c'è ancora nessuna libreria nel progetto |
| **Ricerca nel testo delle trascrizioni** | Oggi la libreria video cerca solo su titolo e descrizione, e dentro una trascrizione si cerca lato client su ciò che è già stato scaricato. Non è solo questione di aggiungere un indice: il testo sta nell'archivio a oggetti e, quando è replicato in banca dati, è cifrato — un indice in chiaro sarebbe una nuova superficie di dati personali. Prima serve la decisione di disegno |
| **Marker e capitoli del moderatore** | I capitoli generati automaticamente ci sono; mancano quelli decisi da chi conduce, durante l'evento. I segnalibri personali esistono già ma vivono nel browser di chi li mette: i marker del moderatore sono un'altra cosa, condivisi e persistiti |
| **API pubblica documentata**<br/>*aperta da marzo* | Lo spec OpenAPI è servito e navigabile da fuori, e le operazioni che dichiara sono esatte, ma copre meno di un quarto delle rotte — famiglie intere sono fuori — e la sua versione coincide con quella dell'applicazione. Prima di pubblicare una interfaccia di documentazione servono copertura e una politica di versionamento: un'API dichiarata pubblica è un impegno di stabilità |

## Serie ed eventi ricorrenti

Due casi tipici con esigenze diverse: una serie a **cadenza fissa** (giorno stabile, data da confermare volta per volta) e una serie a **data mobile** (periodica, spesso riprogrammata di qualche giorno).

Oggi un'occorrenza si crea duplicando la precedente: il clone eredita la configurazione — non i materiali e non i sondaggi — e, se l'evento ha una cadenza, riceve una data proposta, con un calcolo che però funziona solo quando l'occorrenza di partenza è già passata e che non tiene conto del fuso orario. Manca il pezzo centrale: **la serie non esiste come entità**. Nessuno possiede la configurazione canonica, e la cadenza non viene consumata da nessuno schedulatore.

L'idea portante è che la **serie possieda la configurazione** (flag di cattura, retention, lingue, permessi) e ogni occorrenza la erediti, con la possibilità di scostarsene puntualmente: così i flag non si perdono per dimenticanza. La cadenza resta un *suggerimento*, non una schedulazione rigida — l'occorrenza successiva nasce come bozza con una data proposta, che chi organizza conferma, sposta o salta.

Registrazione e post-produzione restano per-occorrenza: la serie aggiunge ereditarietà della configurazione e una vista aggregata, non cambia il modello di cattura.

## Limiti noti di ciò che è già spedito

Funzionalità complete e in uso, ognuna con un confine che conviene conoscere prima di appoggiarcisi.

| Sottosistema | Il limite |
|---|---|
| **Allegati in chat** | La protezione è l'indirizzo non indovinabile più la cancellazione del file alla moderazione o alla scadenza, non un controllo d'accesso valutato a ogni richiesta: chi ha il link vede l'allegato anche a evento chiuso |
| **Registrazione multi-traccia** | Se la conferenza cade a metà evento la cattura si chiude con quello che ha già raccolto, senza riconnessione. La registrazione troncata viene poi elaborata come una normale: nel pannello si vede una registrazione parziale **senza alcun segnale** che sia stata interrotta |
| **Ruolo di moderatore nella conferenza** | Il modulo che impone l'affiliazione nella stanza leggendo il ruolo dal token è montato solo nello stack di sviluppo, non nel chart: in cluster il ruolo viaggia nel token e vale per il portale, ma nella conferenza non c'è niente che lo imponga lato server |
| **Indice di affidabilità della trascrizione** | È calcolato sui punteggi che il riconoscimento ha prodotto, letti dall'artefatto corrente. Dopo una revisione manuale quei punteggi restano attaccati a un testo che una persona ha riscritto, quindi la percentuale non descrive più ciò che si legge |
| **Spegnimento automatico dei bridge video** | Le statistiche dei bridge sono aggregate per processo: due eventi in diretta sullo stesso bridge tengono acceso il nodo anche quando uno dei due si è svuotato |
| **Interfaccia in 24 lingue** | Se una chiave di traduzione manca, il testo ricade sull'**italiano**, non sull'inglese |
| **Piazza della sala d'attesa** | Posizioni ed emote viaggiano sul battito di presenza, non su un canale push dedicato: chi le usa vede subito la propria animazione, gli altri la vedono al battito successivo |
| **Copertura dei test** | Concentrata sulla logica di libreria. Poche rotte hanno test propri e nessun componente ha test di resa: le soglie in `app/vitest.config.ts` sono un cricchetto sul valore misurato — impediscono che scenda, non dichiarano che vada bene |

## Più avanti

| Voce | Nota |
|---|---|
| **Sottotitoli in diretta** | Oggi i sottotitoli sono solo post-evento, per scelta: in diretta richiedono un motore di riconoscimento in streaming accanto alla conferenza |
| **Più enti su una sola installazione** | Oggi l'istanza è di un ente solo, personalizzabile a fondo: la configurazione è una riga sola e nessun dato è partitionato per ente. Ospitare più enti separati chiede isolamento dei dati e branding per ente |
| **Questionario post-evento assistito** | Precompilare le domande dai temi emersi nella trascrizione. I due pezzi (questionari e trascrizione) ci sono già, manca il raccordo |
| **Guida operativa consolidata** | Oggi il troubleshooting è sparso in tre sezioni separate, una per guida, e nessuna copre i modi di fallimento dell'installazione |

## Condizionale

Voci reali ma non pianificate: grandi, di nicchia, o attivate solo da un evento preciso.

- **SPID/CIE** — identità digitale italiana per i partecipanti
- **Inviti con risposta** — il calendario è già a tre vie e l'evento si scarica in `.ics`, ma l'invito non chiede conferma: manca la risposta che diventa iscrizione, e la sincronizzazione con i calendari aziendali
- **Stanze separate** — i sottogruppi nativi della conferenza sono nascosti nell'interfaccia, non disattivati sul server: esporli è una scelta di prodotto, non uno sviluppo da zero, ma va deciso cosa fanno chat, Q&A e controlli quando i partecipanti sono in sottostanze diverse
- **Offuscamento di volti e voci** prima della pubblicazione di una registrazione
- **Diretta in sola visione** per un pubblico illimitato, senza caricare i bridge video
- **App mobile** — oggi il web è responsive e funziona da telefono
- **Registrazione multi-camera** — relatore e slide separati; la multi-traccia attuale è solo audio, per attribuire il parlato
- **Catalogo di template condiviso tra enti** — oggi i template sono interni a un'installazione, e la voce dipende comunque dal punto sui più enti
- **Alta affidabilità del livello Redis** — Redis è già nel percorso realtime (chat, controlli live, stato dei bridge) e degrada senza bloccare le mutazioni, con due percorsi ancora scoperti; diventa un requisito quando ci si appoggia anche il rate-limiting distribuito

## Contribuire

Vedi [CONTRIBUTING.md](../CONTRIBUTING.md) per proporre una funzionalità o segnalare un problema.
