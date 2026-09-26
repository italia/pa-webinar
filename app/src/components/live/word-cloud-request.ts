/**
 * Cosa manda il pannello della nuvola di parole (WordCloud) quando si scrive
 * una parola, e come legge un rifiuto: fuori dal componente perché si possa
 * verificare senza caricare design-react-kit.
 *
 * L'identità è una sola, come nel voto dei sondaggi: l'`accessToken` di una
 * registrazione, oppure l'identificativo stabile del browser per chi una
 * registrazione non ce l'ha (ospiti, relatori, moderatori). Il token di sala
 * NON è un'identità — il server lo cercherebbe fra le registrazioni e
 * risponderebbe 403 — ma viaggia come `Authorization: Bearer`, prova di
 * presenza di chi conduce anche fuori dalla finestra degli ospiti.
 */

export interface WordCloudVoter {
  voterAccessToken?: string;
  voterGuestId?: string;
}

/** La richiesta di invio, o null se manca un'identità: senza, il server
 *  rifiuterebbe la parola, ed era ciò che accadeva a ogni ospite. */
export function wordSubmitInit(
  word: string,
  token: string,
  { voterAccessToken, voterGuestId }: WordCloudVoter,
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
    body: JSON.stringify({ word, ...identity }),
  };
}

/** Le intestazioni della lettura del giro: il token di sala per chi ce l'ha,
 *  nessuna per l'ospite. La lettura passa dallo stesso cancello di domande e
 *  sondaggi, che senza token ammette solo chi può stare nella stanza. */
export function roomReadHeaders(token: string): HeadersInit | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export type WordSubmitErrorKey =
  | 'errors.limit'
  | 'errors.closed'
  | 'errors.rateLimited'
  | 'errors.send';

/** Perché la parola non è entrata, come chiave del namespace `wordcloud`. La
 *  409 vale sia per il giro chiuso sia per il limite di parole: a
 *  distinguerle è il codice dell'errore. La 429 ha un messaggio suo: «riprova»
 *  subito, davanti a un tetto che conta anche i tentativi respinti, farebbe
 *  solo perdere altre parole. */
export async function wordSubmitErrorKey(res: Response): Promise<WordSubmitErrorKey> {
  if (res.status === 429) return 'errors.rateLimited';
  if (res.status !== 409) return 'errors.send';
  const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
  return body?.code === 'WORD_LIMIT_REACHED' ? 'errors.limit' : 'errors.closed';
}
