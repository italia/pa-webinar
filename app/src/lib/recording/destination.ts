// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { RecordingAudience } from '@prisma/client';

import { AppError } from '@/lib/errors';
import type { PartecipantiNelVideo } from '@/lib/live/consent-rule';

/**
 * La destinazione della registrazione di un evento: cio' a cui acconsente chi
 * spunta la casella, dichiarato prima della sala (Event.recordingDestination).
 *
 *  - PUBLIC: il video si puo' pubblicare, per chiunque.
 *  - REGISTRANTS: riservata a iscritti e staff. `Event.recordingAudience` resta
 *    REGISTRANTS, e niente video esterno.
 *  - Null: l'evento non l'ha mai dichiarata. Niente blocco, un avviso a chi
 *    pubblica. Una destinazione dichiarata non si toglie piu'.
 *
 * La destinazione si congela all'apertura della sala: da li' si puo' solo
 * restringere (`puoCambiareDestinazione`).
 *
 * La guardia di pubblicazione guarda l'evento, mai le singole prove: chi non ha
 * un consenso che copre la destinazione (`consensoCopre`) viene richiesto in
 * sala, e se non acconsente resta fuori dal video. Tutte le persone nel video
 * hanno quindi un consenso che copre l'evento, la guardia regge anche dopo la
 * pulizia che toglie le prove, e un consenso negato tocca solo chi lo nega.
 *
 * Il modulo e' puro: lo importano anche i componenti client, per il testo
 * della casella. Niente Prisma, se non per i tipi.
 */

/** La destinazione di un evento o di un consenso. Null: non dichiarata. */
export type Destinazione = RecordingAudience | null;

/** La destinazione di un evento che registra, se nessuno ne sceglie una. */
export const DESTINAZIONE_DI_PARTENZA = 'REGISTRANTS' satisfies RecordingAudience;

/**
 * Se c'e' un video della sala a cui dare una destinazione. Senza un video completo
 * ('assente') quel video non c'e', e il testo della casella lo dice
 * (`destinazioneDelTesto`): la scelta tra riservata e pubblica non si propone.
 * Dove chi partecipa non entra mai nel video ('esclusi') il video c'e', con chi
 * conduce, e la destinazione conta per loro.
 *
 * Decide solo cosa si chiede a chi organizza. L'evento parte riservato comunque
 * (`destinazioneDiPartenza`): un file caricato dopo e' un video come gli altri, e
 * se l'installazione aggiunge il video chi ha letto quel testo va richiesto in
 * sala, perche' il suo consenso non dichiara una destinazione (`consensoCopre`).
 */
export function videoDaDestinare(partecipanti: PartecipantiNelVideo | undefined): boolean {
  return partecipanti !== 'assente';
}

/**
 * La destinazione di un evento quando nessuno ne sceglie una: quella dichiarata,
 * o riservata se comincia a registrare adesso (`registra`, e prima non registrava).
 * Un evento nuovo o una copia cominciano sempre: `recordingEnabled` falso.
 *
 * E' l'unica regola per chi non sceglie: creazione, copia, modifica, caricamento
 * di un file e cio' che il wizard annuncia. Vale per chiunque accenda la
 * registrazione: un link di conduzione non puo' scegliere la destinazione, quindi
 * il suo salvataggio non si blocca e il video parte dalla scelta piu' stretta.
 * Allargarla resta allo staff, finche' la sala non si apre.
 *
 * Un file caricato conta come «comincia» solo a sala mai aperta: dopo non si
 * potrebbe piu' allargare (`puoCambiareDestinazione`), e un evento gia' concluso
 * che pubblicava per tutti diventerebbe riservato per sempre. Quell'evento resta
 * senza destinazione e pubblica con un avviso, come chi registrava gia'.
 *
 * Resta null chi registrava gia' senza averla dichiarata: sono gli eventi nati
 * prima di questa scelta, che pubblicano con un avviso. Restano null anche le
 * chiamate rapide e gli archivi storici importati (LEGACY), con le loro copie:
 * non hanno iscritti a cui riservare il video. Senza registrazione non si dichiara
 * niente: la destinazione deciderebbe da sola sulle domande dopo l'evento
 * (`domandePubbliche`).
 */
export function destinazioneDiPartenza(
  evento: {
    recordingEnabled: boolean;
    recordingDestination?: Destinazione;
    eventType?: string;
  },
  registra: boolean
): Destinazione {
  const comincia = registra && !evento.recordingEnabled;
  const senzaDestinazione = evento.eventType === 'INSTANT' || evento.eventType === 'LEGACY';
  return (
    evento.recordingDestination ??
    (comincia && !senzaDestinazione ? DESTINAZIONE_DI_PARTENZA : null)
  );
}

/**
 * Il pubblico della registrazione dopo un cambio di destinazione. Una
 * destinazione riservata lo porta sempre a REGISTRANTS: restringere vince su cio'
 * che chiede la stessa richiesta, e non produce mai un rifiuto. Da riservata a
 * pubblica torna per tutti, se la richiesta non dice altro: quel pubblico l'aveva
 * imposto la destinazione. Altrimenti resta quello scelto.
 */
export function pubblicoAllineato(
  prima: Destinazione,
  dopo: Destinazione,
  chiesto: RecordingAudience | undefined,
  attuale: RecordingAudience,
): RecordingAudience {
  if (dopo === 'REGISTRANTS' && prima !== 'REGISTRANTS') return 'REGISTRANTS';
  if (chiesto) return chiesto;
  return prima === 'REGISTRANTS' && dopo === 'PUBLIC' ? 'PUBLIC' : attuale;
}

/**
 * La registrazione non e' per tutti: la riserva la destinazione o il pubblico
 * scelto dopo, che puo' restringere anche una destinazione pubblica. Decide cio'
 * che esce fuori dalle rotte che riconoscono l'iscritto: le domande sulla pagina
 * (`domandePubbliche`) e il recupero in diretta (`recuperoAperto`).
 */
export function registrazioneRiservata(evento: {
  recordingAudience: RecordingAudience;
  recordingDestination: Destinazione;
}): boolean {
  return (
    evento.recordingDestination === 'REGISTRANTS' || evento.recordingAudience === 'REGISTRANTS'
  );
}

/**
 * Il recupero esiste solo in diretta e il suo indirizzo arriva grezzo a chi lo
 * legge: nessuna rotta riconosce l'iscritto, quindi una registrazione riservata
 * non lo offre. Lo stesso per la GET pubblica e per la sala.
 */
export function recuperoAperto(evento: {
  status: string;
  recordingAudience: RecordingAudience;
  recordingDestination: Destinazione;
}): boolean {
  return evento.status === 'LIVE' && !registrazioneRiservata(evento);
}

/**
 * La versione del testo del consenso alla registrazione. Si salva con il
 * consenso, accanto alla destinazione letta (Registration.consentRecordingVersion,
 * RecordingConsent.textVersion), come dice `versioneDellaProva`:
 *   1. il testo che dice dove va il video (gdpr.consent.recordingReserved,
 *      gdpr.consent.recordingPublic), con nome, voce e immagine di chi acconsente;
 *   2. lo stesso testo per la sola voce: nel video compare solo chi conduce, e di
 *      chi acconsente si registra la voce quando interviene (lib/live/consent-rule).
 * Un consenso dato con il testo 1 copre anche il 2, che chiede meno: non si
 * richiede. Dove l'installazione non tiene chi partecipa fuori dal video
 * ('visibili') la casella mostra di nuovo il testo 1, con le sue parole, la
 * prova salva 1 (`versioneDellaProva`), e un consenso dato sul testo 2 non copre
 * piu' (`provaCopre`): prometteva che volto e nome restavano fuori.
 * Due testi non dicono la destinazione, che resta null come sui consensi dati
 * prima: gdpr.consent.recording (o recordingVisible), su un evento senza
 * destinazione, e gdpr.consent.recordingNoVideo, dove non c'e' un video da
 * pubblicare. La versione si salva comunque, tranne per il testo senza video
 * (`versioneDellaProva`): una prova senza versione e' stata data prima che i
 * testi la dichiarassero, quando ogni testo diceva audio e video. Per
 * questo i consensi si confrontano con `destinazioneDelTesto`, non con la colonna
 * dell'evento: dove non c'e' un video un consenso senza destinazione copre. Se
 * poi l'installazione registra il video, su un evento con destinazione non copre
 * piu', perche' quel testo diceva che il video non c'era, e si richiede in sala.
 * Si cambia insieme al testo, quando il suo scopo cambia.
 */
export const VERSIONE_TESTO_REGISTRAZIONE = 2;

/**
 * La versione da salvare con la prova di un consenso dato ora, con o senza
 * destinazione: il testo 1, nome, voce e immagine, dove chi partecipa puo'
 * comparire nel video ('visibili'), altrove il testo per la sola voce. Il testo
 * senza video (gdpr.consent.recordingNoVideo) non ha versione: null.
 */
export function versioneDellaProva(partecipanti: PartecipantiNelVideo): number | null {
  if (partecipanti === 'assente') return null;
  return partecipanti === 'visibili' ? 1 : VERSIONE_TESTO_REGISTRAZIONE;
}

/**
 * Una prova di consenso gia' data copre il testo in vigore: la destinazione
 * (`consensoCopre`) e, dove chi partecipa puo' comparire nel video ('visibili'),
 * il testo che diceva nome, voce e immagine. Li' copre la versione 1, e una prova
 * senza versione, data prima che il testo per la sola voce esistesse, quando ogni
 * testo diceva audio e video. Un consenso dato sul testo per la sola voce non
 * copre: prometteva che volto e nome restavano fuori, e chi l'ha dato entra in
 * solo ascolto e lo si richiede in sala, sul testo che dice cosa riprende il video.
 */
export function provaCopre(
  prova: { destination: Destinazione | undefined; textVersion?: number | null },
  inVigore: Destinazione | undefined,
  partecipanti: PartecipantiNelVideo
): boolean {
  if (!consensoCopre(prova.destination, inVigore)) return false;
  return partecipanti !== 'visibili' || prova.textVersion == null || prova.textVersion === 1;
}

/**
 * Un elemento di RecordingConsent.earlierPeriods, il periodo di un consenso
 * sostituito da uno successivo: porta anche il testo di quel periodo, perche'
 * la prova deve dire a cosa si era acconsentito allora. Gli elementi scritti
 * prima che il testo dichiarasse la destinazione hanno solo le date, e chi li
 * legge tollera l'assenza degli altri campi.
 *
 * Il ritiro dalla pagina dei propri dati segue la stessa prova:
 * POST /api/gdpr/consents accetta esattamente uno tra `registrationId`
 * (l'iscrizione che esiste ancora) e `proofId` (la prova conservata dopo la
 * cancellazione dell'iscrizione).
 */
export interface PeriodoConsenso {
  consentedAt: string;
  withdrawnAt: string | null;
  destination?: Destinazione;
  textVersion?: number | null;
}

/**
 * Un consenso gia' dato vale per la destinazione dell'evento. Riceve la
 * destinazione del consenso: che il consenso ci sia, e non sia ritirato, lo
 * dicono le sue colonne.
 *
 * Su un evento senza destinazione vale ogni consenso. Altrimenti un consenso
 * senza destinazione non copre, perche' quel testo non diceva dove va il video,
 * e chi ha acconsentito a un video pubblico ha acconsentito anche a uno
 * riservato, non il contrario. Quindi restringere non chiede niente, e allargare
 * fa richiedere il consenso in sala.
 */
export function consensoCopre(
  consenso: Destinazione | undefined,
  evento: Destinazione | undefined
): boolean {
  if (evento == null) return true;
  if (consenso == null) return false;
  return evento === 'REGISTRANTS' || consenso === 'PUBLIC';
}

/**
 * La destinazione che il testo della casella dichiara: quella con cui si
 * confrontano i consensi e che si salva nella prova. E' quella dell'evento,
 * salvo dove non c'e' un video ('assente'): quel testo non dice dove va,
 * perche' non c'e' niente da pubblicare.
 */
export function destinazioneDelTesto(
  destinazione: Destinazione | undefined,
  partecipanti: PartecipantiNelVideo
): Destinazione {
  return partecipanti === 'assente' ? null : (destinazione ?? null);
}

/**
 * Il testo letto da chi acconsente, dal campo che la pagina manda con il
 * consenso: la destinazione del testo mostrato, null se non ne dichiara una.
 * Solo una pagina aperta da prima che il campo esistesse lo omette: vale il
 * testo in vigore (`destinazioneDelTesto`). E' la destinazione che si salva con
 * la prova, anche quando quella in vigore e' piu' stretta.
 */
export function testoLetto(
  letta: Destinazione | undefined,
  inVigore: Destinazione | undefined
): Destinazione {
  return letta === undefined ? (inVigore ?? null) : letta;
}

/**
 * Il testo letto e' quello in vigore (`destinazioneDelTesto`). E' la regola del
 * modulo d'iscrizione: chi lo compila puo' ancora rileggere, e se la destinazione
 * e' cambiata mentre la pagina era aperta, in qualunque direzione, la rotta
 * risponde 422 (registration.errors.recordingDestinationChanged).
 */
export function testoInVigore(
  letta: Destinazione | undefined,
  inVigore: Destinazione | undefined
): boolean {
  return testoLetto(letta, inVigore) === (inVigore ?? null);
}

/**
 * Il consenso alla registrazione dato con questa richiesta (il corpo di
 * POST /api/events/[slug]/jitsi/token). Vale se il testo letto copre la
 * destinazione in vigore (`destinazioneDelTesto`), con la regola dei consensi
 * gia' dati (`consensoCopre`): una restrizione a pagina aperta non chiede niente,
 * e chi rientra resta nel video. Se la destinazione si e' allargata, o il testo
 * non la dichiarava, il consenso non c'e'. La persona entra lo stesso, fuori dal
 * video: il consenso non e' mai una condizione per entrare.
 *
 * Una pagina aperta non si aggiorna da sola. La risposta del token riporta la
 * destinazione in vigore (`recordingDestination`, da `destinazioneDelTesto`), e
 * la sala mostra quel testo, cosi' la persona rilegge prima di acconsentire. Il
 * consenso resta legato al testo su cui e' stato dato: se quel testo non copre
 * la destinazione in vigore, la sala lo dimentica e lo richiede sul testo nuovo,
 * invece di rimandarlo come letto.
 */
export function consensoOra(
  corpo: {
    recordingConsent?: boolean;
    recordingConsentDestination?: Destinazione;
  },
  inVigore: Destinazione | undefined
): boolean {
  if (corpo.recordingConsent !== true) return false;
  return consensoCopre(testoLetto(corpo.recordingConsentDestination, inVigore), inVigore);
}

const TESTO_CASELLA = {
  PUBLIC: 'recordingPublic',
  REGISTRANTS: 'recordingReserved',
} as const;

const TESTO_CASELLA_VISIBILI = {
  PUBLIC: 'recordingVisiblePublic',
  REGISTRANTS: 'recordingVisibleReserved',
} as const;

/**
 * Il testo della casella di consenso alla registrazione, come chiave sotto
 * `gdpr.consent`: lo stesso nel modulo, in sala d'attesa e nei punti della sala
 * in cui si da' il consenso. Dove non c'e' un video ('assente') dice questo,
 * qualunque sia la destinazione dell'evento. Dove chi partecipa puo' comparire
 * ('visibili') non promette che volto e nome restano fuori: e' il testo 1, nome,
 * voce e immagine. Si salva come dice `versioneDellaProva`. Dove chi
 * partecipa non entra mai nel video ('esclusi') la casella non si mostra: resta
 * il testo per la sola voce, quello su cui un consenso dato prima si ritira.
 */
export function chiaveConsenso(
  destinazione: Destinazione | undefined,
  partecipanti: PartecipantiNelVideo
) {
  if (partecipanti === 'assente') return 'recordingNoVideo';
  if (partecipanti === 'visibili') {
    return destinazione ? TESTO_CASELLA_VISIBILI[destinazione] : 'recordingVisible';
  }
  return destinazione ? TESTO_CASELLA[destinazione] : 'recording';
}

/**
 * L'informativa sulla registrazione dove non si chiede niente
 * (`consensiRichiesti(...).avvisoRegistrazione`), come chiave sotto
 * `gdpr.consent`: il pubblico non ha microfono, videocamera ne' schermo, oppure
 * nel video non entra mai ('esclusi'). Dove chi partecipa puo' comparire
 * ('visibili') non promette che volto e nome restano fuori, e la pagina aggiunge
 * `gdpr.consent.namesMayAppear`.
 */
export function chiaveAvvisoRegistrazione(partecipanti: PartecipantiNelVideo) {
  if (partecipanti === 'esclusi') return 'recordingHostsOnly';
  return partecipanti === 'visibili' ? 'recordingNotice' : 'recordingNoticeVoice';
}

const TESTO_CHI_CONDUCE = {
  PUBLIC: 'recordingHostAlwaysPublic',
  REGISTRANTS: 'recordingHostAlwaysReserved',
} as const;

/**
 * L'avviso a chi conduce un evento che lo tiene sempre nella registrazione,
 * come chiave sotto `gdpr.consent`. Non e' una casella: dice solo dove va il
 * video.
 */
export function chiaveAvvisoConduce(destinazione: Destinazione | undefined) {
  return destinazione ? TESTO_CHI_CONDUCE[destinazione] : 'recordingHostAlways';
}

/**
 * Cosa dice la destinazione a chi pubblica:
 *  - 'riservata': si pubblica solo per gli iscritti;
 *  - 'senzaDestinazione': i consensi raccolti non dicono dove sarebbe andato il
 *    video. Niente blocco, un avviso;
 *  - 'libera': destinazione pubblica, o un evento storico importato (LEGACY),
 *    che non ha consensi su cui avvisare.
 */
export type EsitoPubblicazione = 'riservata' | 'senzaDestinazione' | 'libera';

export function esitoPubblicazione(stato: {
  recordingDestination: Destinazione | undefined;
  eventType: string | null;
}): EsitoPubblicazione {
  if (stato.recordingDestination === 'REGISTRANTS') return 'riservata';
  if (stato.recordingDestination == null && stato.eventType !== 'LEGACY') {
    return 'senzaDestinazione';
  }
  return 'libera';
}

/** Cio' che decide quanto e' esposto il video di un evento. */
export interface EsposizioneVideo {
  recordingDestination: Destinazione;
  recordingAudience: RecordingAudience;
  recordingPublished: boolean;
  transcriptPublished: boolean;
  youtubeUrl: string | null;
  tempRecordingUrl: string | null;
}

/** L'errore con cui si ferma una modifica che la destinazione non consente. */
export function erroreDestinazioneNonCoperta(): AppError {
  return new AppError(
    'The consents of this event cover a reserved recording: it cannot be shown to everyone or linked to an external video.',
    409,
    'RECORDING_DESTINATION_NOT_COVERED'
  );
}

const indirizzoNuovo = (prima: string | null | undefined, dopo: string | null): boolean =>
  !!dopo && dopo !== prima;

/**
 * Rifiuta con un 409 una modifica che espone di piu' un evento riservato.
 * `dopo` e' lo stato che la richiesta scriverebbe, con `recordingAudience` gia'
 * allineata alla destinazione; `prima` quello attuale, null alla creazione.
 *
 * Aumenta l'esposizione:
 *  - rendere la registrazione per tutti, anche prima di pubblicarla: il
 *    caricamento di un file pubblica da solo, senza passare da questa guardia;
 *  - pubblicare il video o la trascrizione per tutti;
 *  - un indirizzo nuovo di video esterno o del recupero in diretta, che nessuna
 *    regola di accesso protegge.
 *
 * Il confronto e' tra prima e dopo perche' restringere non si rifiuta mai: un
 * evento che diventa riservato tenendo il suo video esterno o il video gia'
 * pubblicato riduce l'esposizione. Non guarda `libraryListed`, `postEventPublic`,
 * lo stato e `recordingUrl`: la chiusura di un evento e un file gia' nello
 * storage non si fermano qui, e pagina e videoteca filtrano su `recordingAudience`.
 * Se il file sta davvero nello storage lo dice `assertVideoNelloStorage`
 * (lib/storage/recordings), che legge la configurazione del server.
 */
export function assertEsposizioneConsentita(
  prima: EsposizioneVideo | null,
  dopo: EsposizioneVideo
): void {
  if (dopo.recordingDestination !== 'REGISTRANTS') return;
  const piuPubblicata =
    (dopo.recordingPublished && !prima?.recordingPublished) ||
    (dopo.transcriptPublished && !prima?.transcriptPublished);
  const perTutti =
    dopo.recordingAudience === 'PUBLIC' &&
    (prima?.recordingAudience !== 'PUBLIC' || piuPubblicata);
  if (
    perTutti ||
    indirizzoNuovo(prima?.youtubeUrl, dopo.youtubeUrl) ||
    indirizzoNuovo(prima?.tempRecordingUrl, dopo.tempRecordingUrl)
  ) {
    throw erroreDestinazioneNonCoperta();
  }
}

/**
 * Se la destinazione di un evento puo' passare da `prima` a `dopo`.
 * `salaGiaAperta`: la sala si e' aperta almeno una volta, anche se ora e' chiusa.
 *
 * Una destinazione dichiarata non si toglie, in nessun momento: su un evento
 * senza destinazione ogni consenso copre e la guardia non ferma niente, quindi
 * chi ha acconsentito a un video riservato non verrebbe richiesto, e il video si
 * potrebbe pubblicare. Null resta agli eventi che non l'hanno mai dichiarata.
 *
 * Prima della sala gli altri cambi sono liberi: chi ha un consenso che non copre
 * piu' viene richiesto in sala. Dopo, le persone gia' nel video hanno letto quel
 * testo: si puo' solo restringere, a riservata, anche su un evento che non
 * l'aveva dichiarata.
 */
export function puoCambiareDestinazione(
  prima: Destinazione | undefined,
  dopo: Destinazione,
  salaGiaAperta: boolean
): boolean {
  const attuale = prima ?? null;
  if (dopo === null) return attuale === null;
  return attuale === dopo || !salaGiaAperta || dopo === 'REGISTRANTS';
}
