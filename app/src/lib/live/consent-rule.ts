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
  listenOnlyWithoutConsent: boolean;
}

export interface RegolaConsenso {
  /** Il consenso alla registrazione si chiede a chi partecipa. */
  richiesto: boolean;
  /** Senza, si entra in solo ascolto (altrimenti non si entra). */
  soloAscolto: boolean;
}

export function regolaConsenso(
  event: EventoConsenso,
  registrazioneDisponibile: boolean
): RegolaConsenso {
  // Una chiamata rapida non chiede consensi: la sala non mostra la sua
  // registrazione a chi entra dal link (la pagina della sala la nasconde).
  if (event.eventType === 'INSTANT') return { richiesto: false, soloAscolto: false };
  const r = consensiRichiesti({
    ...event,
    recordingEnabled: event.recordingEnabled && registrazioneDisponibile,
  });
  return { richiesto: r.registrazione, soloAscolto: r.registrazioneFacoltativa };
}
