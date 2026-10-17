/**
 * Microfono e videocamera di chi partecipa, nella barra di Jitsi.
 *
 * Quando l'evento non li concede, il server tiene chiuso sul bridge chi non è
 * ammesso (mod_pa_media_lock) e la barra non mostra i loro pulsanti. Diventano
 * concessi quando chi conduce dà la parola alla persona (ammessa), o quando
 * toglie il blocco per tutti (moderazione spenta). Se il blocco torna, il
 * componente di Jitsi riparte da un elenco di soli moderatori: chi era stato
 * ammesso non lo è più.
 */

export type Medium = 'audio' | 'video';

export interface StatoMedium {
  /** L'evento lo concede a chi partecipa (o la persona conduce o interviene). */
  concesso: boolean;
  /** La moderazione di Jitsi è accesa per questo mezzo. */
  moderato: boolean;
  /** Chi conduce ha dato la parola alla persona. */
  ammesso: boolean;
}

export type StatoMedia = Record<Medium, StatoMedium>;

const PULSANTE: Record<Medium, string> = { audio: 'microphone', video: 'camera' };

export function statoIniziale(concessi: Record<Medium, boolean>): StatoMedia {
  return {
    audio: { concesso: concessi.audio, moderato: true, ammesso: false },
    video: { concesso: concessi.video, moderato: true, ammesso: false },
  };
}

/** La persona può accendere quel mezzo adesso. */
export function puoAccendere(s: StatoMedium): boolean {
  return s.concesso || s.ammesso || !s.moderato;
}

/** I pulsanti della barra, senza quelli dei mezzi che la persona non può accendere. */
export function barraConConcessi(barra: readonly string[], stato: StatoMedia): string[] {
  const tolti = (Object.keys(PULSANTE) as Medium[])
    .filter((m) => !puoAccendere(stato[m]))
    .map((m) => PULSANTE[m]);
  return barra.filter((b) => !tolti.includes(b));
}

/** Il tipo della moderazione negli eventi di Jitsi, se è uno di quelli della barra. */
export function mediumDi(mediaType: unknown): Medium | null {
  return mediaType === 'audio' || mediaType === 'video' ? mediaType : null;
}

/** La moderazione si accende o si spegne: riaccesa, le ammissioni ripartono da zero. */
export function conModerazione(
  stato: StatoMedia,
  medium: Medium,
  accesa: boolean
): StatoMedia {
  return {
    ...stato,
    [medium]: {
      ...stato[medium],
      moderato: accesa,
      ammesso: accesa ? false : stato[medium].ammesso,
    },
  };
}

/** Chi conduce dà o toglie la parola alla persona. */
export function conAmmissione(
  stato: StatoMedia,
  medium: Medium,
  ammesso: boolean
): StatoMedia {
  return { ...stato, [medium]: { ...stato[medium], ammesso } };
}
