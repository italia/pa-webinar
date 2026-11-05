// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { mediaLockOf, type MediaLock } from '@/lib/auth/jwt';
import type { EventoConsenso, RegolaConsenso } from './consent-rule';

/**
 * Il consenso alla registrazione all'ingresso nella conferenza, e cosa ne
 * segue nel token di Jitsi.
 *
 * Il consenso non e' mai una condizione per entrare, e un consenso negato tocca
 * solo chi lo nega. In un evento che registra, chi non ha un consenso valido in
 * quel momento (pubblico, ospiti, moderatori, relatori, e chi non ha mai visto la
 * casella perche' l'evento si limita ad avvisare) entra con i limiti di tutti e
 * con `voiceExcluded`: in sala fa cio' che l'evento concede, nella registrazione
 * non c'e'. mod_pa_media_lock lo scrive nella presenza, e la sessione del
 * registratore non lo vede affatto (`hidden-from-recorder` di Jitsi); il
 * registratore per persona salta la sua traccia. Blocchi della sala, parola e
 * aspetto del video restano quelli dell'evento, per tutti. La sala glielo dice,
 * con il consenso a un clic.
 *
 * Il segno non va mai nel token come `hidden-from-recorder`: il client di Jitsi,
 * che lo legge dal JWT, spegnerebbe microfono e videocamera di quella persona.
 *
 * Dove la voce non si puo' escludere (lib/recording/availability) il pubblico
 * senza consenso resta in solo ascolto (`listenOnly`): il bridge non apre
 * niente, nemmeno se un moderatore gli da' la parola. Chi conduce resta com'e',
 * con l'avviso che il video lo riprende. Solo qui il blocco della sala riguarda
 * ogni mezzo e ogni token dell'evento (chi entra per primo lo accende), e chi ha
 * dato il consenso e' ammesso per cio' che l'evento concede (`mediaAdmit`).
 */

export { regolaConsenso, type RegolaConsenso } from './consent-rule';

const TUTTO_BLOCCATO: MediaLock = { audio: true, video: true, desktop: true };

export interface MediaDelToken {
  mediaLock: MediaLock;
  /** Dove la voce non si puo' escludere: la sala non toglie i blocchi
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
  const comeLEvento: MediaDelToken = {
    mediaLock: mediaLockOf(event),
    ...(chi === 'relatore' ? { mediaExempt: true } : {}),
  };
  if (!regola.registra) return comeLEvento;
  if (!regola.soloAscolto) {
    return consenso ? comeLEvento : { ...comeLEvento, voiceExcluded: true };
  }
  const base = { mediaLock: TUTTO_BLOCCATO, consentLock: true };
  if (chi === 'moderatore') return base;
  if (chi === 'relatore') return { ...base, mediaExempt: true };
  if (!consenso) return { ...base, listenOnly: true };
  const concesso = mediaLockOf(event);
  return {
    ...base,
    mediaAdmit: {
      audio: !concesso.audio,
      video: !concesso.video,
      desktop: !concesso.desktop,
    },
  };
}
