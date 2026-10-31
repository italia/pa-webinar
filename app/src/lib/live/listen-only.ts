import { mediaLockOf, type MediaLock } from '@/lib/auth/jwt';
import type { EventoConsenso, RegolaConsenso } from './consent-rule';

/**
 * Il consenso alla registrazione all'ingresso nella conferenza, e cosa ne
 * segue nel token di Jitsi.
 *
 * Il consenso si chiede a chi partecipa quando l'evento registra e concede ai
 * partecipanti microfono, videocamera o schermo (lib/registration/consents).
 * Senza consenso:
 *   - con il solo ascolto (Event.listenOnlyWithoutConsent) si entra lo stesso,
 *     in solo ascolto: il token lo dice (`listenOnly`) e il bridge non apre
 *     mai microfono, videocamera ne' schermo di quella persona, nemmeno se un
 *     moderatore le da' la parola (mod_pa_media_lock). Per intervenire si
 *     rientra dando il consenso;
 *   - altrimenti non si entra: il server lo verifica, non solo la sala
 *     d'attesa.
 *
 * Perche' il blocco valga per una persona sola, con il solo ascolto il blocco
 * della sala riguarda ogni mezzo, in ogni token dell'evento (chi entra per
 * primo lo accende), e chi ha dato il consenso e' ammesso per cio' che
 * l'evento concede (`mediaAdmit`): per lui non cambia niente.
 */

export { regolaConsenso, type RegolaConsenso } from './consent-rule';

const TUTTO_BLOCCATO: MediaLock = { audio: true, video: true, desktop: true };

export interface MediaDelToken {
  mediaLock: MediaLock;
  /** In ogni token di un evento con il solo ascolto: la sala non toglie i
   *  blocchi (mod_pa_media_lock rifiuta di spegnere la moderazione). */
  consentLock?: boolean;
  mediaExempt?: boolean;
  mediaAdmit?: MediaLock;
  listenOnly?: boolean;
}

/**
 * I limiti dei mezzi nel token di una persona. `consenso` conta solo per chi
 * partecipa: chi conduce e chi interviene per incarico non lo danno qui.
 */
export function mediaDelToken(
  event: EventoConsenso,
  regola: RegolaConsenso,
  chi: 'moderatore' | 'relatore' | 'partecipante',
  consenso: boolean
): MediaDelToken {
  if (!regola.soloAscolto) {
    return {
      mediaLock: mediaLockOf(event),
      ...(chi === 'relatore' ? { mediaExempt: true } : {}),
    };
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
