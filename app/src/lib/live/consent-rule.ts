// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { consensiRichiesti } from '@/lib/registration/consents';

/**
 * La regola del consenso alla registrazione per chi entra nella conferenza,
 * la stessa per il server (il token di Jitsi, lib/live/listen-only) e per la
 * sala (sala d'attesa, pannello dei partecipanti).
 */
export interface EventoConsenso {
  eventType?: string;
  recordingEnabled: boolean;
  multitrackRecordingEnabled: boolean;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
}

/**
 * La voce di chi non ha un consenso valido nel video completo: non c'e' un video
 * completo (`assente`), il registratore non la riproduce (`rimovibile`), oppure
 * resta (`fissa`).
 */
export type VoceNelVideo = 'assente' | 'rimovibile' | 'fissa';

export interface RegolaConsenso {
  /** Conta chi ha un consenso valido: chi non ce l'ha resta fuori dalla
   *  registrazione, e il resto della sala non cambia. */
  registra: boolean;
  /** Il consenso alla registrazione si chiede a chi partecipa. */
  richiesto: boolean;
  /** Senza consenso, solo ascolto: la voce non si potrebbe togliere dal video.
   *  Solo qui i blocchi della sala seguono il consenso. */
  soloAscolto: boolean;
}

/**
 * Chi conduce resta sempre nella registrazione, per dichiarazione di chi
 * organizza. Conta solo dove chi non acconsente puo' restarne fuori: altrove il
 * valore rimasto su un evento non cambia niente. Mai in una chiamata rapida:
 * li' chi conduce risponde alla domanda come tutti (`regolaConsenso`).
 */
export function conduceSempreRegistrato(
  evento: { hostsAlwaysRecorded?: boolean | null; eventType?: string | null },
  voce: VoceNelVideo,
): boolean {
  return !!evento.hostsAlwaysRecorded && voce === 'rimovibile' && evento.eventType !== 'INSTANT';
}

export function regolaConsenso(
  event: EventoConsenso,
  registrazioneDisponibile: boolean,
  voce: VoceNelVideo,
): RegolaConsenso {
  // Una chiamata rapida non chiede niente all'ingresso: tutti, chi conduce
  // compreso, entrano fuori dalla registrazione, e la domanda arriva in sala a
  // ogni avvio (components/live/recording-question). Per questo si registra solo
  // dove chi non acconsente resta davvero fuori dal video: altrove la sala non
  // offre la registrazione, e il solo ascolto non tocca mai una chiamata rapida.
  if (event.eventType === 'INSTANT') {
    const registra = event.recordingEnabled && registrazioneDisponibile && voce === 'rimovibile';
    return { registra, richiesto: registra, soloAscolto: false };
  }
  const recordingEnabled = event.recordingEnabled && registrazioneDisponibile;
  const richiesto = consensiRichiesti({ ...event, recordingEnabled }).registrazione;
  return {
    // Dove la voce resta nel video e l'evento si limita ad avvisare, nessuno ha
    // potuto dire di no: restano i limiti dell'evento, come sempre.
    registra: recordingEnabled && (voce === 'rimovibile' || (voce === 'fissa' && richiesto)),
    richiesto,
    soloAscolto: recordingEnabled && voce === 'fissa' && richiesto,
  };
}

/**
 * Il testo sulla registrazione scelto per l'evento, se si puo' mostrare. Senza un
 * video completo parlerebbe di una registrazione che non c'e' e direbbe il
 * contrario della casella e della scheda privacy: vale quello predefinito.
 */
export function testoConsensoEvento(
  testo: string | null | undefined,
  voce: VoceNelVideo
): string | null {
  return voce === 'assente' ? null : testo?.trim() || null;
}
