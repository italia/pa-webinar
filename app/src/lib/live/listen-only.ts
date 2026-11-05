// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { mediaLockOf, type MediaLock } from '@/lib/auth/jwt';
import type { EventoConsenso, RegolaConsenso } from './consent-rule';

/**
 * Il consenso alla registrazione all'ingresso nella conferenza, e cosa ne
 * segue nel token di Jitsi.
 *
 * Il consenso non e' mai una condizione per entrare. In un evento che registra,
 * chi non ha un consenso valido in quel momento (pubblico, ospiti, moderatori,
 * relatori, e chi non ha mai visto la casella perche' l'evento si limita ad
 * avvisare) entra con `voiceExcluded`: puo' parlare con le regole di tutti, ma
 * non viene registrato. La sessione del registratore non riproduce la sua voce
 * (il testo della conferenza, `paNoRecording` nella presenza), il registratore
 * per persona salta la sua traccia, e gli altri e il video restano come sono.
 * Videocamera e schermo restano chiusi sul bridge, perche' entrerebbero nel
 * video (mod_pa_media_lock). La sala glielo dice, con il consenso a un clic.
 *
 * Dove la voce non si puo' escludere (lib/recording/availability) il pubblico
 * senza consenso resta in solo ascolto (`listenOnly`): il bridge non apre
 * niente, nemmeno se un moderatore gli da' la parola. Chi conduce resta com'e',
 * con l'avviso che il video lo riprende.
 *
 * Perche' il blocco valga per una persona sola, in un evento che registra il
 * blocco della sala riguarda ogni mezzo, in ogni token dell'evento (chi entra
 * per primo lo accende), e chi ha dato il consenso e' ammesso per cio' che
 * l'evento concede (`mediaAdmit`): per lui non cambia niente.
 */

export { regolaConsenso, type RegolaConsenso } from './consent-rule';

const TUTTO_BLOCCATO: MediaLock = { audio: true, video: true, desktop: true };

export interface MediaDelToken {
  mediaLock: MediaLock;
  /** In ogni token di un evento che registra: la sala non toglie i blocchi
   *  (mod_pa_media_lock rifiuta di spegnere la moderazione). */
  consentLock?: boolean;
  mediaExempt?: boolean;
  mediaAdmit?: MediaLock;
  listenOnly?: boolean;
  voiceExcluded?: boolean;
}

/** I limiti dei mezzi nel token di una persona. */
export function mediaDelToken(
  event: EventoConsenso,
  regola: RegolaConsenso,
  chi: 'moderatore' | 'relatore' | 'partecipante',
  consenso: boolean
): MediaDelToken {
  if (!regola.registra) {
    return {
      mediaLock: mediaLockOf(event),
      ...(chi === 'relatore' ? { mediaExempt: true } : {}),
    };
  }
  const base = { mediaLock: TUTTO_BLOCCATO, consentLock: true };
  const concesso = mediaLockOf(event);
  const ammesso: MediaLock = {
    audio: !concesso.audio,
    video: !concesso.video,
    desktop: !concesso.desktop,
  };
  const conConsenso = () => {
    if (chi === 'moderatore') return base;
    if (chi === 'relatore') return { ...base, mediaExempt: true };
    return { ...base, mediaAdmit: ammesso };
  };
  if (consenso) return conConsenso();
  if (regola.soloAscolto) {
    return chi === 'partecipante' ? { ...base, listenOnly: true } : conConsenso();
  }
  if (chi === 'moderatore') return { ...base, voiceExcluded: true };
  if (chi === 'relatore') return { ...base, mediaExempt: true, voiceExcluded: true };
  return {
    ...base,
    voiceExcluded: true,
    mediaAdmit: { audio: ammesso.audio, video: false, desktop: false },
  };
}
