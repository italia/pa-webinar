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
  /** I mezzi seguono il consenso: conta chi ne ha uno valido. */
  registra: boolean;
  /** Il consenso alla registrazione si chiede a chi partecipa. */
  richiesto: boolean;
  /** Senza consenso, solo ascolto: la voce non si potrebbe togliere dal video. */
  soloAscolto: boolean;
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
