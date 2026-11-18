// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Il formato di un evento nuovo, scelto con quattro domande invece che fra
 * modelli con un nome da indovinare: quante persone, chi parla e si mostra in
 * video, se registrare e per chi, chi puo' partecipare. Le risposte diventano i
 * valori di partenza del wizard (gli stessi campi di un modello); ogni funzione
 * della sala resta attivabile e disattivabile anche durante l'evento.
 *
 * Il formato sceglie solo i valori di partenza, e chi organizza puo' cambiarli
 * tutti. I diritti della persona non dipendono dal formato: la casella del
 * consenso non e' mai spuntata ne' condizione per entrare, e chi la nega resta
 * fuori dalla registrazione senza cambiare nulla al resto della sala.
 *
 * Pura, cosi' la regola si verifica senza montare la pagina.
 */

import type { RecordingAudience } from '@prisma/client';

import type { WizardTemplatePreset } from '@/components/admin/event-wizard/wizard-shell';
import { accessModeDaSalvare } from '@/lib/events/access-mode';
import type { PartecipantiNelVideo } from '@/lib/live/consent-rule';
import { VASTA_SCALA } from '@/lib/live/participant-list';
import { videoDaDestinare } from '@/lib/recording/destination';

export type FormatoPersone = 'piccolo' | 'medio' | 'grande';
export type FormatoVoce = 'tutti' | 'relatori';
/** Se si puo' registrare, e chi vedra' il video. */
export type FormatoRegistra = 'no' | 'riservata' | 'pubblica';
/** Chi partecipa: chiunque si iscrive, o solo chi e' invitato. */
export type FormatoAccesso = 'tutti' | 'invitati';

export interface FormatoGuidato {
  persone: FormatoPersone;
  voce: FormatoVoce;
  registra: FormatoRegistra;
  accesso: FormatoAccesso;
}

export const FORMATO_PREDEFINITO: FormatoGuidato = {
  persone: 'medio',
  voce: 'tutti',
  registra: 'pubblica',
  accesso: 'tutti',
};

const PERSONE: readonly FormatoPersone[] = ['piccolo', 'medio', 'grande'];
const VOCI: readonly FormatoVoce[] = ['tutti', 'relatori'];
const REGISTRA: readonly FormatoRegistra[] = ['no', 'riservata', 'pubblica'];
const ACCESSI: readonly FormatoAccesso[] = ['tutti', 'invitati'];

/** Le persone attese per ciascuna risposta: una stima per dimensionare il
 *  server video, non un limite alle iscrizioni. */
export const PARTECIPANTI_ATTESI: Record<FormatoPersone, number> = {
  piccolo: 20,
  medio: 100,
  grande: 300,
};

/** Le tre famiglie di evento: dalle risposte su persone e voce viene sempre una
 *  sola. Dove la famiglia e' `pubblico` l'elenco dei partecipanti e' nascosto
 *  (lib/live/participant-list), negli altri casi si vede. */
export type ClasseFormato = 'riunione' | 'partecipativo' | 'pubblico';

export function classeFormato(f: Pick<FormatoGuidato, 'persone' | 'voce'>): ClasseFormato {
  if (f.voce === 'relatori' || PARTECIPANTI_ATTESI[f.persone] >= VASTA_SCALA) return 'pubblico';
  return f.persone === 'piccolo' ? 'riunione' : 'partecipativo';
}

/** I valori di partenza di ciascuna famiglia. */
const VALORI_DELLA_CLASSE: Record<
  ClasseFormato,
  {
    registrazione: Exclude<FormatoRegistra, 'no'>;
    /** Il pubblico compare con uno pseudonimo. */
    audienceAnonymous: boolean;
    /** Il testo delle domande resta sulla pagina dopo l'evento. */
    postEventShowQA: boolean;
    /** Il modulo d'iscrizione propone la rubrica. */
    offerAddressBook: boolean;
  }
> = {
  riunione: {
    registrazione: 'riservata',
    audienceAnonymous: false,
    postEventShowQA: false,
    offerAddressBook: false,
  },
  partecipativo: {
    registrazione: 'pubblica',
    audienceAnonymous: false,
    postEventShowQA: true,
    offerAddressBook: true,
  },
  pubblico: {
    registrazione: 'pubblica',
    audienceAnonymous: true,
    postEventShowQA: true,
    offerAddressBook: true,
  },
};

/** Chi conduce e' sempre nella registrazione, di partenza, negli eventi pubblici.
 *  Spento: chi conduce sceglie come tutti. Acceso, vale per gli eventi creati dalle
 *  domande; i modelli di sistema tengono il valore della loro colonna. */
const CHI_CONDUCE_SEMPRE_REGISTRATO: boolean = false;

/** La destinazione del video per ciascuna risposta. */
const DESTINAZIONE: Record<FormatoRegistra, RecordingAudience | null> = {
  no: null,
  riservata: 'REGISTRANTS',
  pubblica: 'PUBLIC',
};

/** La risposta proposta a chi vuole registrare: quella della famiglia, e riservata
 *  su invito. Vale anche per gli indirizzi salvati quando la risposta era solo
 *  «si'». */
export function registrazioneProposta(
  f: Pick<FormatoGuidato, 'persone' | 'voce' | 'accesso'>,
): Exclude<FormatoRegistra, 'no'> {
  return f.accesso === 'invitati' ? 'riservata' : VALORI_DELLA_CLASSE[classeFormato(f)].registrazione;
}

/** Il formato da cui partono le domande, per chi partecipa come dice il sito. */
export function formatoPredefinito(accesso: FormatoAccesso): FormatoGuidato {
  const formato = { ...FORMATO_PREDEFINITO, accesso };
  return { ...formato, registra: registrazioneProposta(formato) };
}

/** Il formato quando chi partecipa cambia dopo le domande. Passando agli inviti un
 *  video pubblico torna alla proposta: chi rilegge le domande vede una risposta
 *  come scelta, e nessuno ha scelto un video pubblico per un evento su invito.
 *  Il passaggio inverso non allarga mai: la risposta resta quella che era. */
export function formatoConAccesso(f: FormatoGuidato, accesso: FormatoAccesso): FormatoGuidato {
  const dopo = { ...f, accesso };
  return f.accesso !== 'invitati' && accesso === 'invitati' && f.registra === 'pubblica'
    ? { ...dopo, registra: registrazioneProposta(dopo) }
    : dopo;
}

/** Il formato nell'indirizzo (`?formato=medio.tutti.pubblica.tutti`): si ritrova
 *  dopo un ricaricamento o col pulsante «indietro». */
export function codificaFormato(f: FormatoGuidato): string {
  return `${f.persone}.${f.voce}.${f.registra}.${f.accesso}`;
}

export function decodificaFormato(valore: unknown): FormatoGuidato | null {
  if (typeof valore !== 'string') return null;
  const [persone, voce, registra, accesso] = valore.split('.');
  if (
    !(PERSONE as readonly string[]).includes(persone ?? '') ||
    !(VOCI as readonly string[]).includes(voce ?? '') ||
    !(ACCESSI as readonly string[]).includes(accesso ?? '')
  ) {
    return null;
  }
  const risposte = { persone, voce, accesso } as Omit<FormatoGuidato, 'registra'>;
  // Un indirizzo salvato quando la risposta era solo «si'» resta valido.
  if (registra === 'si') return { ...risposte, registra: registrazioneProposta(risposte) };
  if (!(REGISTRA as readonly string[]).includes(registra ?? '')) return null;
  return { ...risposte, registra: registra as FormatoRegistra };
}

/** Dove l'installazione non puo' registrare il formato non promette una
 *  registrazione, neanche se arriva da un indirizzo salvato altrove. `conVideo`:
 *  `videoDaDestinare` dell'installazione. Senza un video della sala non c'e' un
 *  video da aprire a tutti, e l'evento parte riservato: la risposta lo dice. */
export function formatoPossibile(
  f: FormatoGuidato,
  puoRegistrare: boolean,
  conVideo = true,
): FormatoGuidato {
  if (!puoRegistrare) return { ...f, registra: 'no' };
  return !conVideo && f.registra === 'pubblica' ? { ...f, registra: 'riservata' } : f;
}

/** Se in questa installazione la registrazione di un evento produce qualcosa: il
 *  video della sala o, senza quello, le tracce per persona, che il wizard accende
 *  solo con la pipeline AI. `puoRegistrare` risponde «si'» anche nel dubbio, perche'
 *  decide gli avvisi a chi partecipa: chi organizza non riceve la promessa di una
 *  registrazione che non parte. */
export function registrazioneProponibile(
  puoRegistrare: boolean,
  partecipanti: PartecipantiNelVideo | undefined,
  aiPipelineEnabled: boolean,
): boolean {
  return puoRegistrare && (videoDaDestinare(partecipanti) || aiPipelineEnabled);
}

/** Dove la domanda sulla registrazione non si fa perche' non produrrebbe nulla, la
 *  trascrizione dai sottotitoli funziona lo stesso: non dipende ne' dal video ne'
 *  dalla pipeline AI, e la risposta mancante non la spegne. */
export function trascriveSenzaRegistrare(
  puoRegistrare: boolean,
  partecipanti: PartecipantiNelVideo | undefined,
  aiPipelineEnabled: boolean,
  sottotitoliDisponibili: boolean,
): boolean {
  return (
    puoRegistrare &&
    sottotitoliDisponibili &&
    !registrazioneProponibile(puoRegistrare, partecipanti, aiPipelineEnabled)
  );
}

/** I valori di partenza del wizard per un formato, nella forma di un modello.
 *  `sitoAperto`: l'iscrizione pubblica del sito, per non fissare sull'evento
 *  una scelta che coincide con la sua (vedi accessModeDaSalvare).
 *  `soloSottotitoli`: `trascriveSenzaRegistrare` dell'installazione. */
export function presetDaFormato(
  f: FormatoGuidato,
  nome: string,
  sitoAperto = true,
  soloSottotitoli = false,
) {
  const tutti = f.voce === 'tutti';
  const registra = f.registra !== 'no';
  const suInvito = f.accesso === 'invitati';
  const classe = classeFormato(f);
  const valori = VALORI_DELLA_CLASSE[classe];
  return {
    id: `formato-${codificaFormato(f)}`,
    name: nome,
    // Tutte le funzioni della sala accese: si spengono anche durante l'evento.
    qaEnabled: true,
    chatEnabled: true,
    agendaEnabled: true,
    wordCloudEnabled: true,
    whiteboardEnabled: false,
    liveCaptionsEnabled: true,
    // Chi registra tiene anche la trascrizione dai sottotitoli: c'e' subito a
    // fine evento, anche senza la pipeline AI, e quella AI la sostituisce.
    captionsTranscriptEnabled: registra || soloSottotitoli,
    participantsCanUnmute: tutti,
    participantsCanStartVideo: tutti,
    participantsCanShareScreen: tutti,
    maxParticipants: PARTECIPANTI_ATTESI[f.persone],
    defaultDurationMinutes: 60,
    // La registrazione e' disponibile ma non parte da sola: la avvia chi
    // conduce con REC, e se si registra seguono trascrizione, sintesi,
    // traduzione e le tracce per partecipante.
    recordingEnabled: registra,
    autoStartRecording: false,
    aiTranscriptEnabled: registra,
    aiSummaryEnabled: registra,
    aiTranslationEnabled: registra,
    multitrackRecordingEnabled: registra,
    aiTargetLocales: null,
    // Solo gli invitati si iscrivono, e nessuno entra da ospite.
    accessMode: accessModeDaSalvare(suInvito ? 'INVITATION' : 'OPEN', sitoAperto),
    // Una riunione fra pochi, o un evento su invito, non ha una pagina
    // pubblica dopo l'evento: chi si e' iscritto vede comunque il video
    // riservato. Chi sceglie un video pubblico la apre, altrimenti non
    // potrebbe mai raggiungere il pubblico.
    postEventPublic: f.registra === 'pubblica' || !(suInvito || classe === 'riunione'),
    recordingDestination: DESTINAZIONE[f.registra],
    audienceAnonymous: valori.audienceAnonymous,
    postEventShowQA: valori.postEventShowQA,
    offerAddressBook: valori.offerAddressBook,
    hostsAlwaysRecorded: registra && classe === 'pubblico' && CHI_CONDUCE_SEMPRE_REGISTRATO,
  } satisfies WizardTemplatePreset;
}
