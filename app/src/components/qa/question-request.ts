/**
 * Il corpo con cui il modulo del Q&A (QuestionForm) invia una domanda, fuori
 * dal componente perché si possa verificare senza caricare design-react-kit.
 *
 * Con un token di sala la domanda è firmata dal server: il nome della
 * registrazione o del grant del relatore. Senza token è un ospite, che manda
 * il nome scelto in sala d'attesa e l'identificativo stabile del browser:
 * quest'ultimo è la chiave del limite di una domanda ogni trenta secondi, a
 * persona. Senza, il server ricade sull'indirizzo IP, che dietro lo stesso NAT
 * condivide un ufficio intero.
 */
export function questionSubmitBody(
  text: string,
  token: string,
  guest: { guestName?: string; guestId?: string },
): Record<string, unknown> {
  // Un identificativo vuoto non si manda: il server lo rifiuterebbe insieme
  // alla domanda, mentre la sua assenza ricade sul limite per indirizzo.
  return token
    ? { text, accessToken: token }
    : { text, guestName: guest.guestName, guestId: guest.guestId || undefined };
}

/** Il messaggio (`qa.errors.*`) per una domanda che il server non ha accettato. */
export type QuestionSubmitError = 'rateLimit' | 'busy' | 'generic';

/**
 * Due 429 diversi: il limite della persona (una domanda ogni trenta secondi),
 * a cui si risponde «attendi prima di inviarne un'altra», e il tetto della
 * rete da cui arrivano molte domande insieme (`NETWORK_RATE_LIMIT`), che
 * ferma anche chi non ha ancora chiesto nulla: a lui si dice di riprovare fra
 * qualche secondo, non di aspettare prima di un'«altra» domanda.
 */
export function questionSubmitError(status: number, code?: string): QuestionSubmitError {
  if (status === 429) return code === 'NETWORK_RATE_LIMIT' ? 'busy' : 'rateLimit';
  return 'generic';
}

/**
 * Con quale identità si sostiene una domanda col pollice in su: la stessa del
 * voto nei sondaggi e della nuvola di parole (live/voter-identity). Chi si è
 * iscritto usa la propria registrazione; ospiti, relatori e moderatori
 * l'identificativo stabile del browser. Esattamente uno dei due.
 */
export interface QaVoter {
  voterAccessToken?: string;
  voterGuestId?: string;
}

/**
 * L'indirizzo della lettura delle domande. Chi vota col browser ci aggiunge il
 * proprio identificativo: è così che il server sa quali domande ha già
 * sostenuto e gli dice che il pulsante può usarlo (`canUpvote`). La chiave
 * resta un prefisso dell'elenco, quindi il canale della sala la rinfresca
 * comunque (hooks/use-live-state).
 */
export function questionsReadUrl(apiUrl: string, { voterGuestId }: QaVoter): string {
  return voterGuestId ? `${apiUrl}?guestId=${encodeURIComponent(voterGuestId)}` : apiUrl;
}

/**
 * La richiesta del pollice in su, o null se manca un'identità: senza, il
 * server risponderebbe 401. Il token di sala non è un'identità di voto — il
 * server lo cercherebbe fra le registrazioni — ma viaggia come
 * `Authorization: Bearer`, prova di presenza di chi conduce o parla anche
 * fuori dalla finestra degli ospiti.
 */
export function upvoteInit(
  token: string,
  { voterAccessToken, voterGuestId }: QaVoter,
): RequestInit | null {
  const identity = voterAccessToken
    ? { accessToken: voterAccessToken }
    : voterGuestId
      ? { guestId: voterGuestId }
      : null;
  if (!identity) return null;
  return {
    method: 'POST',
    headers: token
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      : { 'Content-Type': 'application/json' },
    body: JSON.stringify(identity),
  };
}
