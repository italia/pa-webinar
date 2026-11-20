// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { mediaLockOf, type MediaLock } from '@/lib/auth/jwt';
import type { EventoConsenso, RegolaConsenso } from './consent-rule';

/**
 * Il consenso alla registrazione all'ingresso nella conferenza, e cosa ne
 * segue nel token di Jitsi.
 *
 * Il consenso non e' mai una condizione per entrare, e un consenso negato tocca
 * solo chi lo nega. In un evento che registra, chi partecipa senza un consenso
 * valido in quel momento (pubblico, ospiti, e chi non ha mai visto la casella
 * perche' l'evento si limita ad avvisare) entra con i limiti di tutti e con
 * `voiceExcluded`: in sala fa cio' che l'evento concede, nella registrazione non
 * c'e' nemmeno la sua voce. mod_pa_media_lock lo scrive nella presenza, e la
 * sessione del registratore non lo vede affatto (`hidden-from-recorder` di
 * Jitsi); il registratore per persona salta la sua traccia. Blocchi della sala,
 * parola e aspetto del video restano quelli dell'evento, per tutti. La sala
 * glielo dice, con il consenso a un clic.
 *
 * Chi conduce (moderatori e relatori) non da' questo consenso: e' sempre nel
 * video (lib/live/consent-rule), e il suo token porta `paInVideo`. Solo il suo:
 * il registratore mostra immagine e nome di chi ha il segno, e degli altri al
 * massimo la voce. Il segno lo scrive nella presenza Prosody, non il browser.
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
 *
 * Dove chi partecipa non entra mai nel video, nemmeno con la voce ('esclusi',
 * `voceDallaTrascrizione`), il consenso alla registrazione non si chiede: la
 * voce di chi partecipa la registrano solo le tracce per persona e la
 * trascrizione dai sottotitoli, e il segno segue il consenso alla trascrizione.
 * Chi non l'ha dato ha `voiceExcluded`, come sempre; chi l'ha dato ha il segno
 * della voce (pa-recorder-voice), che il testo della conferenza di questa
 * installazione non riproduce nel video.
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
  /** Chi conduce: nel video con nome e immagine (`context.user.paInVideo`). */
  paInVideo?: boolean;
}

/**
 * I limiti dei mezzi nel token di una persona. `consenso` e' quello di chi
 * partecipa alla registrazione della propria voce: chi conduce non lo da'. Con
 * `regola.voceDallaTrascrizione` e' il consenso alla trascrizione dei propri
 * interventi.
 */
export function mediaDelToken(
  event: EventoConsenso,
  regola: RegolaConsenso,
  chi: 'moderatore' | 'relatore' | 'partecipante',
  consenso: boolean
): MediaDelToken {
  const conduce = chi !== 'partecipante';
  const comeLEvento: MediaDelToken = {
    mediaLock: mediaLockOf(event),
    ...(chi === 'relatore' ? { mediaExempt: true } : {}),
    ...(conduce ? { paInVideo: true } : {}),
  };
  if (!regola.registra) return comeLEvento;
  if (!regola.soloAscolto) {
    return conduce || consenso ? comeLEvento : { ...comeLEvento, voiceExcluded: true };
  }
  const base = { mediaLock: TUTTO_BLOCCATO, consentLock: true };
  if (chi === 'moderatore') return { ...base, paInVideo: true };
  if (chi === 'relatore') return { ...base, mediaExempt: true, paInVideo: true };
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
