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
 * valore rimasto su un evento non cambia niente.
 */
export function conduceSempreRegistrato(
  evento: { hostsAlwaysRecorded?: boolean | null },
  voce: VoceNelVideo,
): boolean {
  return !!evento.hostsAlwaysRecorded && voce === 'rimovibile';
}

export function regolaConsenso(
  event: EventoConsenso,
  registrazioneDisponibile: boolean,
  voce: VoceNelVideo,
): RegolaConsenso {
  // Una chiamata rapida non chiede consensi: la sala non mostra la sua
  // registrazione a chi entra dal link (la pagina della sala la nasconde).
  if (event.eventType === 'INSTANT') return { registra: false, richiesto: false, soloAscolto: false };
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
