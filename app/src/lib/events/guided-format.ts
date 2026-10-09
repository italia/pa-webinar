/**
 * Il formato di un evento nuovo, scelto con quattro domande invece che fra
 * modelli con un nome da indovinare: quante persone, chi parla e si mostra in
 * video, se registrare, chi puo' partecipare. Le risposte diventano i valori
 * di partenza del wizard (gli stessi campi di un modello); ogni funzione della
 * sala resta attivabile e disattivabile anche durante l'evento.
 *
 * Pura, cosi' la regola si verifica senza montare la pagina.
 */

import { accessModeDaSalvare } from '@/lib/events/access-mode';

export type FormatoPersone = 'piccolo' | 'medio' | 'grande';
export type FormatoVoce = 'tutti' | 'relatori';
export type FormatoRegistra = 'si' | 'no';
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
  registra: 'si',
  accesso: 'tutti',
};

const PERSONE: readonly FormatoPersone[] = ['piccolo', 'medio', 'grande'];
const VOCI: readonly FormatoVoce[] = ['tutti', 'relatori'];
const REGISTRA: readonly FormatoRegistra[] = ['si', 'no'];
const ACCESSI: readonly FormatoAccesso[] = ['tutti', 'invitati'];

/** Il formato nell'indirizzo (`?formato=medio.tutti.si.tutti`): si ritrova
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
    !(REGISTRA as readonly string[]).includes(registra ?? '') ||
    !(ACCESSI as readonly string[]).includes(accesso ?? '')
  ) {
    return null;
  }
  return { persone, voce, registra, accesso } as FormatoGuidato;
}

/** Le persone attese per ciascuna risposta: una stima per dimensionare il
 *  server video, non un limite alle iscrizioni. */
export const PARTECIPANTI_ATTESI: Record<FormatoPersone, number> = {
  piccolo: 20,
  medio: 100,
  grande: 300,
};

/** I valori di partenza del wizard per un formato, nella forma di un modello.
 *  `sitoAperto`: l'iscrizione pubblica del sito, per non fissare sull'evento
 *  una scelta che coincide con la sua (vedi accessModeDaSalvare). */
export function presetDaFormato(f: FormatoGuidato, nome: string, sitoAperto = true) {
  const tutti = f.voce === 'tutti';
  const registra = f.registra === 'si';
  const suInvito = f.accesso === 'invitati';
  return {
    id: `formato-${codificaFormato(f)}`,
    name: nome,
    // Tutte le funzioni della sala accese: si spengono anche durante l'evento.
    qaEnabled: true,
    chatEnabled: true,
    agendaEnabled: true,
    wordCloudEnabled: true,
    whiteboardEnabled: false,
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
    // pubblica dopo l'evento.
    postEventPublic: !(suInvito || (tutti && f.persone === 'piccolo')),
  };
}
