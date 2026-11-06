// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { jibriRecordingExpected } from '@/lib/infrastructure';
import { tracceConfigurate } from '@/lib/live/capture-state';
import type { VoceNelVideo } from '@/lib/live/consent-rule';

/**
 * Se questa installazione puo' registrare un evento. Decide cosa si dice a chi
 * partecipa: l'avviso «questo evento puo' essere registrato» e il consenso prima di
 * entrare. Sbagliare per eccesso costa un avviso inutile; sbagliare per difetto
 * vuol dire registrare senza consenso. Per questo la risposta e' «no» solo
 * quando l'assenza e' certa:
 *   - Jitsi e' quello del chart (il chart imposta JITSI_WEB_INTERNAL_URL solo
 *     quando lo installa): con un Jitsi esterno non sappiamo se c'e' un Jibri;
 *   - il chart non ha reso JIBRI_HEALTH_URL, che scrive solo con Jibri acceso
 *     o dichiarato a mano;
 *   - non c'e' il registratore per partecipante (RECORDER_CONTROLLER_URL);
 *   - lo storage delle registrazioni non e' dichiarato
 *     (lib/infrastructure#jibriRecordingExpected).
 * E' una regola di configurazione, non una sonda: un registratore che si sta
 * ancora accendendo conta come presente.
 */
export function recordingAvailable(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const jitsiDelChart = !!env.JITSI_WEB_INTERNAL_URL?.trim();
  if (!jitsiDelChart) return true;
  return (
    jibriRecordingExpected(env) ||
    !!env.JIBRI_HEALTH_URL?.trim() ||
    !!env.RECORDER_CONTROLLER_URL?.trim()
  );
}

/**
 * Se questa installazione puo' registrare una traccia audio per persona: con il
 * registratore per partecipante collegato. `recordingAvailable` non basta, perche'
 * e' vera anche con il solo Jibri, che di tracce non ne fa. Con un Jitsi esterno
 * non si sa chi registra: vale la risposta prudente, come sopra.
 */
export function tracceDisponibili(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const jitsiDelChart = !!env.JITSI_WEB_INTERNAL_URL?.trim();
  return !jitsiDelChart || !!env.RECORDER_CONTROLLER_URL?.trim();
}

/**
 * La voce di chi non ha un consenso valido nel video completo. La sessione del
 * registratore (Jibri) non la riproduce: il testo della conferenza del chart, che
 * lo dichiara con RECORDING_VOICE_EXCLUSION. Senza Jibri non c'e' un video
 * completo, e le tracce per persona non contengono chi non ha acconsentito. Con
 * un Jitsi esterno non si sa chi registra: vale la risposta prudente, come sopra.
 */
export function voceNelVideo(env: Record<string, string | undefined> = process.env): VoceNelVideo {
  const jitsiDelChart = !!env.JITSI_WEB_INTERNAL_URL?.trim();
  const conJibri = !jitsiDelChart || jibriRecordingExpected(env) || !!env.JIBRI_HEALTH_URL?.trim();
  if (!conJibri) return 'assente';
  return env.RECORDING_VOICE_EXCLUSION?.trim() === 'true' ? 'rimovibile' : 'fissa';
}

/**
 * Se c'e' qualcosa che possa registrare questo evento: la regola unica di scheda
 * privacy, modulo d'iscrizione, sala d'attesa, sala e token. Senza un video
 * completo restano solo le tracce per persona, quindi senza tracce non si
 * registra niente, e non c'e' niente da annunciare ne' a cui acconsentire. Non
 * dice se l'evento vuole registrare: quello e' `recordingEnabled`.
 */
export function eventoRegistrabile(
  evento: {
    recordingEnabled: boolean;
    aiTranscriptEnabled: boolean;
    multitrackRecordingEnabled: boolean;
  },
  ambiente: {
    registrazioneDisponibile: boolean;
    voce: VoceNelVideo;
    tracceDisponibili: boolean;
  },
): boolean {
  return (
    ambiente.registrazioneDisponibile &&
    (ambiente.voce !== 'assente' || tracceConfigurate(evento, ambiente.tracceDisponibili))
  );
}

/** `eventoRegistrabile` con i fatti dell'installazione letti dall'ambiente. */
export function recordingAvailableFor(
  evento: Parameters<typeof eventoRegistrabile>[0],
  env: Record<string, string | undefined> = process.env,
): boolean {
  return eventoRegistrabile(evento, {
    registrazioneDisponibile: recordingAvailable(env),
    voce: voceNelVideo(env),
    tracceDisponibili: tracceDisponibili(env),
  });
}
