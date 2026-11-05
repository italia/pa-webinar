import { jibriRecordingExpected } from '@/lib/infrastructure';
import type { VoceNelVideo } from '@/lib/live/consent-rule';

/**
 * Se questa installazione puo' registrare un evento. Decide cosa si dice a chi
 * partecipa: l'avviso «questo evento viene registrato» e il consenso prima di
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
