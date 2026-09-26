/**
 * Con quale identità si vota nei sondaggi e si scrive nella nuvola di parole,
 * fuori dalla sala live perché si possa verificare senza caricarla.
 *
 * Chi si è iscritto ha un `accessToken` di registrazione, ed è quella la sua
 * identità. Ospiti, relatori e moderatori non ce l'hanno: il loro token di
 * sala è un link di conduzione, e il server — che cerca l'`accessToken` fra le
 * registrazioni — lo rifiuterebbe con un 403. Per loro l'identità è
 * l'identificativo stabile del browser. Mandare a tutti il token di sala era
 * esattamente il difetto per cui relatori e moderatori non potevano scrivere.
 */

export interface RoomSeat {
  /** Il token con cui si è entrati in sala: registrazione, grant o link
   *  moderatore; vuoto per l'ospite. */
  token: string;
  isGuest: boolean;
  isModerator: boolean;
  isSpeaker: boolean;
}

export interface VoterIdentity {
  voterAccessToken?: string;
  voterGuestId?: string;
}

/** L'`accessToken` di una registrazione, o undefined per chi non ne ha una. */
export function registrationAccessToken({
  token,
  isGuest,
  isModerator,
  isSpeaker,
}: RoomSeat): string | undefined {
  return !isGuest && !isModerator && !isSpeaker && token ? token : undefined;
}

/** Esattamente una delle due identità: la registrazione se c'è, altrimenti
 *  l'identificativo del browser. */
export function voterIdentity(
  registeredAccessToken: string | undefined,
  guestId: string,
): VoterIdentity {
  return registeredAccessToken
    ? { voterAccessToken: registeredAccessToken }
    : { voterGuestId: guestId };
}

/**
 * Dove il browser tiene l'identificativo di chi non è iscritto: una chiave per
 * ruolo. Chi conduce apre spesso, nello stesso browser, la sala come la vede un
 * ospite («Entra come partecipante» dalla pagina di gestione): con la stessa
 * chiave quell'anteprima si sarebbe trovata i voti, le parole della nuvola e i
 * limiti del moderatore, e non quello che vede davvero un ospite.
 */
export function voterIdStorageKey({ isModerator, isSpeaker }: Pick<RoomSeat, 'isModerator' | 'isSpeaker'>): string {
  if (isModerator) return 'paw_moderator_voter_id';
  if (isSpeaker) return 'paw_speaker_voter_id';
  return 'paw_guest_id';
}
