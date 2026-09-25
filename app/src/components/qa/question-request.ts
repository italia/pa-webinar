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
