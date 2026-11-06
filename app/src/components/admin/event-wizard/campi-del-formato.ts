// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { tracceConfigurate } from '@/lib/live/capture-state';
import type { VoceNelVideo } from '@/lib/live/consent-rule';
import {
  destinazioneDiPartenza,
  videoDaDestinare,
  type Destinazione,
} from '@/lib/recording/destination';

import type { WizardForm, WizardTemplatePreset } from './wizard-shell';

/**
 * I cinque valori che il formato o il modello scelgono per un evento: dove va la
 * registrazione, se si propone la rubrica, i nomi del pubblico, chi conduce e le
 * domande dopo l'evento. Sono valori di partenza: chi organizza li cambia nel
 * wizard, e ogni formato li ricalcola («Cambia formato» non se li porta dietro).
 */
export interface CampiDelFormato {
  recordingDestination: Destinazione;
  offerAddressBook: boolean;
  audienceAnonymous: boolean;
  hostsAlwaysRecorded: boolean;
  postEventShowQA: boolean;
}

/**
 * I valori di partenza di un evento nuovo. `registra`: l'evento registra davvero
 * (il modello lo chiede, l'installazione puo' farlo). Solo un evento che registra
 * parte con una destinazione se il modello non ne dice una, e solo lui puo'
 * tenere chi conduce nel video: la dichiarazione non riguarda altri eventi.
 * `conVideo`: `videoDaDestinare` dell'installazione. Senza, il modulo non ha una
 * scelta da proporre, nemmeno quella del modello, e la destinazione la decide il
 * salvataggio (`destinazioneDiPartenza`).
 */
export function campiDaModello(
  tpl: WizardTemplatePreset | null | undefined,
  registra: boolean,
  conVideo = true
): CampiDelFormato {
  const destinazione =
    tpl?.recordingDestination ?? destinazioneDiPartenza({ recordingEnabled: false }, registra);
  return {
    recordingDestination: conVideo ? destinazione : null,
    offerAddressBook: tpl?.offerAddressBook ?? true,
    audienceAnonymous: tpl?.audienceAnonymous ?? false,
    hostsAlwaysRecorded: registra && (tpl?.hostsAlwaysRecorded ?? false),
    postEventShowQA: tpl?.postEventShowQA ?? true,
  };
}

/**
 * La destinazione di un evento su invito: un video pubblico che nessuno ha scelto
 * per questo evento torna alla proposta, riservata, come fa `formatoConAccesso`
 * nelle domande. `scelta`: chi organizza l'ha indicata, e resta. Il passaggio
 * inverso non allarga mai: la destinazione resta quella che era.
 */
export function destinazioneSuInvito(
  destinazione: Destinazione,
  suInvito: boolean,
  scelta: boolean
): Destinazione {
  return suInvito && !scelta && destinazione === 'PUBLIC' ? 'REGISTRANTS' : destinazione;
}

/** Una registrazione accesa non produce nulla: l'installazione non ha il video
 *  della sala, e l'evento ha spento le tracce per persona. */
export function registrazioneVuota(
  form: Pick<
    WizardForm,
    'recordingEnabled' | 'aiTranscriptEnabled' | 'multitrackRecordingEnabled'
  >,
  voce: VoceNelVideo | undefined,
  recordingAvailable: boolean,
): boolean {
  return (
    form.recordingEnabled &&
    !videoDaDestinare(voce) &&
    !tracceConfigurate(form, recordingAvailable)
  );
}

/** Il video dell'evento e' pubblico: la destinazione conta solo se l'evento registra. */
export function videoPubblico(
  form: Pick<WizardForm, 'recordingEnabled' | 'recordingDestination'>,
): boolean {
  return form.recordingEnabled && form.recordingDestination === 'PUBLIC';
}

/**
 * La pagina dopo l'evento quando accesso e destinazione cambiano, finche' chi
 * organizza non tocca il suo interruttore. `partenza`: il modulo appena aperto.
 *
 * Un video che diventa pubblico senza esserlo alla partenza apre la pagina: con la
 * pagina privata non lo vedrebbe nessuno, nemmeno chi si e' iscritto. Un video che
 * smette di esserlo la riporta al valore di partenza, cosi' un'andata e ritorno non
 * cambia nulla, e su invito la chiude. Un evento che diventa su invito la chiude,
 * come fanno le domande, salvo che il video resti pubblico. Tornando aperto la
 * pagina resta com'era: quel passaggio non allarga mai.
 */
export function paginaCheSegue(
  partenza: Pick<WizardForm, 'recordingEnabled' | 'recordingDestination' | 'postEventPublic'>,
  prima: { suInvito: boolean; form: Pick<WizardForm, 'recordingEnabled' | 'recordingDestination'> },
  dopo: {
    suInvito: boolean;
    form: Pick<WizardForm, 'recordingEnabled' | 'recordingDestination' | 'postEventPublic'>;
  },
): boolean {
  const pubblicoDopo = videoPubblico(dopo.form);
  if (pubblicoDopo !== videoPubblico(prima.form)) {
    if (pubblicoDopo) return videoPubblico(partenza) ? partenza.postEventPublic : true;
    return !dopo.suInvito && partenza.postEventPublic;
  }
  return dopo.suInvito && !prima.suInvito && !pubblicoDopo ? false : dopo.form.postEventPublic;
}

/** Cio' che il wizard dice su un evento su invito che registra: il testo sotto
 *  `admin.wizard.step2`. */
export type NotaDestinazione =
  | 'recordingDestinationPublicOnInvitation'
  | 'recordingDestinationReservedOnInvitation';

/** Cio' che il wizard dice della pagina dopo l'evento: passata da sola a seguire
 *  l'accesso o il video, rimasta privata su un evento tornato aperto, o privata con
 *  un video pubblico che cosi' nessuno vede. */
export type NotaPagina =
  | 'postEventPagePrivateOnInvitation'
  | 'postEventPagePublicWithVideo'
  | 'postEventPageStaysPrivate'
  | 'postEventPagePrivateVideoHidden';

/** I valori di un evento salvato. */
export function campiDaEvento(ev: Partial<CampiDelFormato>): CampiDelFormato {
  return {
    recordingDestination: ev.recordingDestination ?? null,
    offerAddressBook: ev.offerAddressBook ?? true,
    audienceAnonymous: ev.audienceAnonymous ?? false,
    hostsAlwaysRecorded: ev.hostsAlwaysRecorded ?? false,
    postEventShowQA: ev.postEventShowQA ?? true,
  };
}

/**
 * La destinazione che l'evento avra' dopo il salvataggio, la stessa che legge
 * `domandePubbliche`. `senzaScelta`: quella che tiene se il modulo non ne sceglie
 * una (`destinazioneDiPartenza`). Un evento che non registra non ne dichiara una
 * nuova: la scelta resta nel modulo per quando la registrazione si riaccende,
 * altrimenti una riservata toglierebbe le domande a un evento senza video. Una
 * destinazione gia' dichiarata resta anche a registrazione spenta, e si puo'
 * cambiare.
 */
export function destinazioneDopoIlSalvataggio(
  form: Pick<WizardForm, 'recordingEnabled' | 'recordingDestination'>,
  senzaScelta: Destinazione
): Destinazione {
  if (senzaScelta === null && !form.recordingEnabled) return null;
  return form.recordingDestination ?? senzaScelta;
}

/**
 * Cio' che il salvataggio manda di questi campi. `undefined` non parte, e il
 * server lascia il valore com'e'.
 *
 *  - Un link di conduzione non cambia destinazione, rubrica e chi conduce: li
 *    decide lo staff dell'evento, e il server rifiuterebbe il salvataggio. Le
 *    domande dopo l'evento le cambia dalla pagina dell'evento.
 *  - In modifica destinazione, rubrica e domande partono solo se cambiati: le
 *    domande hanno un loro interruttore nella pagina dell'evento, e un
 *    salvataggio del wizard non deve rimettere un valore letto prima.
 *  - Null non parte mai: una destinazione dichiarata non si toglie, nemmeno
 *    spegnendo la registrazione, e il server rifiuterebbe il salvataggio. Vale
 *    `destinazioneDopoIlSalvataggio`.
 */
export function campiDaSalvare(
  form: WizardForm,
  salvati: CampiDelFormato | null,
  viaToken: boolean
): Partial<CampiDelFormato> {
  const seCambiato = <K extends keyof CampiDelFormato>(campo: K) =>
    viaToken || (salvati !== null && form[campo] === salvati[campo])
      ? undefined
      : form[campo];
  const salvata = salvati?.recordingDestination ?? null;
  const destinazione = destinazioneDopoIlSalvataggio(form, salvata);
  return {
    recordingDestination:
      viaToken || destinazione === salvata ? undefined : (destinazione ?? undefined),
    offerAddressBook: seCambiato('offerAddressBook'),
    audienceAnonymous: form.audienceAnonymous,
    hostsAlwaysRecorded: viaToken ? undefined : form.hostsAlwaysRecorded,
    postEventShowQA: seCambiato('postEventShowQA'),
  };
}
