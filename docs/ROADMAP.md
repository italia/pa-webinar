# Roadmap — pa-webinar

Questo documento elenca **solo ciò che manca**. Cosa la piattaforma fa già è nel [README](../README.md#funzionalità); cosa è stato rilasciato e quando è nel [CHANGELOG](../CHANGELOG.md) e sulla pagina pubblica `/changelog`.

Le voci non hanno un numero di versione: un numero è una promessa con una data implicita, e quando slitta il documento inizia a mentire. Al suo posto ogni voce porta **da quando è aperta**, così uno slittamento resta visibile invece di essere riassorbito in silenzio.

## Prossimo

| Voce | Dove siamo |
|---|---|
| **Batteria E2E Playwright**<br/>*aperta da marzo* | Oggi c'è un solo file di test end-to-end. Copre in browser la sala d'attesa e l'ingresso in sala di moderatore e partecipante; la parte admin (login, creazione, pubblicazione) è esercitata solo via API. Restano scoperti: Q&A, sondaggi, cambio lingua, cancellazione GDPR, download del `.ics`, chat su più repliche. Il job è `continue-on-error`: un rosso non blocca il merge, quindi oggi non protegge da regressioni |
| **SSE per i pannelli live**<br/>*aperta da giugno* | Q&A, sondaggi, agenda e word cloud si aggiornano interrogando il server ogni 3 secondi. Il trasporto push esiste già ed è in produzione per la chat e per le mani alzate: va esteso agli altri pannelli |
| **Conservare la trascrizione originale**<br/>*aperta da aprile* | Quando un segmento viene corretto nell'editor, l'artefatto viene sovrascritto: non resta una copia del testo prodotto dalla macchina accanto alla versione rivista. Per un verbale di un ente pubblico le due cose vanno distinte, ed era un requisito dichiarato fin da aprile — poi sparito dal documento senza essere né fatto né rinviato |

## Dopo

| Voce | Dove siamo |
|---|---|
| **Controllo d'accesso sugli allegati in chat** | Oggi un allegato è protetto da un URL non indovinabile (vedi "Limiti noti"). Il controllo vero richiede un cookie con ambito sulla rotta degli allegati, riletto a ogni richiesta: così una password aggiunta o un evento chiuso hanno effetto subito. Un token nell'URL non basta ed è già stato scartato |
| **Rate-limiting distribuito** | Il contatore dei limiti di frequenza vive nella memoria del singolo processo: con più repliche dell'app ognuna conta per conto suo. Serve un contatore condiviso su Redis — che è già nel percorso realtime, quindi la scelta si porta dietro il punto sull'alta affidabilità in "Condizionale" |
| **Export del report di evento**<br/>*aperta da marzo* | Statistiche, Q&A, sondaggi e partecipanti in un documento scaricabile. Oggi l'export esiste solo come CSV delle registrazioni; per il PDF non c'è ancora nessuna libreria nel progetto |
| **Ricerca nel testo delle trascrizioni** | Oggi la libreria video cerca solo su titolo e descrizione, e dentro una trascrizione si cerca lato client. Non è solo questione di aggiungere un indice: il testo sta nell'object storage e, quando è replicato in banca dati, è cifrato — un indice in chiaro sarebbe una nuova superficie di dati personali. Prima serve la decisione di disegno |
| **Marker e capitoli del moderatore** | I capitoli generati dall'AI ci sono; mancano quelli decisi da chi conduce, durante l'evento. I segnalibri personali esistono già ma vivono nel browser di chi li mette: i marker del moderatore sono un'altra cosa, condivisi e persistiti |
| **API pubblica documentata**<br/>*aperta da marzo* | Lo spec OpenAPI è servito e navigabile da fuori, ma copre circa un terzo delle rotte e la sua versione coincide con quella dell'applicazione. Prima di pubblicare una interfaccia di documentazione servono copertura e una politica di versionamento: un'API dichiarata pubblica è un impegno di stabilità |

## Serie ed eventi ricorrenti

Due casi tipici con esigenze diverse: una serie a **cadenza fissa** (giorno stabile, data da confermare volta per volta) e una serie a **data mobile** (periodica, spesso riprogrammata di qualche giorno).

Oggi un'occorrenza si crea duplicando la precedente: il clone eredita la configurazione e, se l'evento ha una cadenza, la data viene proiettata in avanti. Manca il pezzo centrale — **la serie non esiste come entità**: nessuno possiede la configurazione canonica, e la cadenza non viene consumata da nessuno schedulatore.

L'idea portante è che la **serie possieda la configurazione** (flag di cattura, retention, lingue, permessi) e ogni occorrenza la erediti, con la possibilità di scostarsene puntualmente: così i flag non si perdono per dimenticanza. La cadenza resta un *suggerimento*, non una schedulazione rigida — l'occorrenza successiva nasce come bozza con una data proposta, che chi organizza conferma, sposta o salta.

Registrazione e post-produzione restano per-occorrenza: la serie aggiunge ereditarietà della configurazione e una vista aggregata, non cambia il modello di cattura.

## Limiti noti di ciò che è già spedito

Funzionalità complete e in uso, ognuna con un confine che conviene conoscere prima di appoggiarcisi.

| Sottosistema | Il limite |
|---|---|
| **Allegati in chat** | La protezione è l'indirizzo non indovinabile più la cancellazione del file alla moderazione o alla scadenza, non un controllo d'accesso valutato a ogni richiesta: chi ha il link vede l'allegato anche a evento chiuso |
| **Registrazione multi-traccia** | Se la conferenza cade a metà evento la cattura si chiude con quello che ha già raccolto, senza riconnessione. La registrazione troncata viene poi elaborata come una normale: nel pannello si vede una registrazione parziale **senza alcun segnale** che sia stata interrotta |
| **Spegnimento automatico dei bridge video** | Le statistiche dei bridge sono aggregate per processo: due eventi in diretta sullo stesso bridge tengono acceso il nodo anche quando uno dei due si è svuotato |
| **Interfaccia in 24 lingue** | Se una chiave di traduzione manca, il testo ricade sull'**italiano**, non sull'inglese |
| **Piazza della sala d'attesa** | Posizioni ed emote viaggiano sul battito di presenza, non su un canale push dedicato: chi le usa vede subito la propria animazione, gli altri la vedono al battito successivo |
| **Copertura dei test** | Concentrata sulla logica di libreria. Poche rotte hanno test propri e i componenti non ne hanno: le soglie in `app/vitest.config.ts` sono un cricchetto sul valore misurato — impediscono che scenda, non dichiarano che vada bene |

## Più avanti

| Voce | Nota |
|---|---|
| **Sottotitoli in diretta** | Oggi i sottotitoli sono solo post-evento, per scelta: in diretta richiedono un motore di riconoscimento in streaming accanto alla conferenza |
| **Più enti su una sola installazione** | Oggi l'istanza è di un ente solo, personalizzabile a fondo; ospitare più enti separati chiede isolamento dei dati e branding per ente |
| **Questionario post-evento assistito** | Precompilare le domande dai temi emersi nella trascrizione. I due pezzi (questionari e trascrizione) ci sono già |
| **Guida operativa consolidata** | Oggi il troubleshooting è sparso tra le guide di sviluppo, deploy e post-produzione |

## Condizionale

Voci reali ma non pianificate: grandi, di nicchia, o attivate solo da un evento preciso.

- **SPID/CIE** — identità digitale italiana per i partecipanti
- **Outlook e calendario Microsoft** — RSVP che diventa registrazione, sincronizzazione degli inviti
- **Stanze separate** — i sottogruppi nativi di Jitsi sono nascosti nell'interfaccia, non disattivati sul server: esporli è una scelta di prodotto, non uno sviluppo da zero
- **Offuscamento di volti e voci** prima della pubblicazione di una registrazione
- **Diretta in sola visione** per un pubblico illimitato, senza caricare i bridge video
- **App mobile** — oggi il web è responsive e funziona da telefono
- **Registrazione multi-camera** — relatore e slide separati; la multi-traccia attuale è solo audio, per attribuire il parlato
- **Catalogo di template condiviso tra enti** — oggi i template sono interni a un'installazione
- **Alta affidabilità del livello Redis** — Redis è già nel percorso realtime (chat, controlli live, stato dei bridge) con degrado graceful; diventa un requisito quando ci si appoggia anche il rate-limiting distribuito

## Contribuire

Vedi [CONTRIBUTING.md](../CONTRIBUTING.md) per proporre una funzionalità o segnalare un problema.
