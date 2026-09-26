import { jibriRecordingExpected } from '@/lib/infrastructure';

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
