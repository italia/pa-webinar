/**
 * La regola della descrizione di un evento, condivisa fra lo schema del server
 * (`schemas.ts`) e il wizard di creazione.
 *
 * Il wizard deve fermare l'operatore sul campo, nella sua lingua, prima che il
 * server risponda 422: per farlo deve conoscere la stessa soglia. Tenerla in
 * un modulo senza dipendenze evita di portare lo schema Zod nel bundle client.
 */

/** Lunghezza minima della descrizione nella lingua richiesta. */
export const EVENT_DESCRIPTION_MIN_LENGTH = 10;

/**
 * La lingua in cui lo schema del server esige la descrizione.
 *
 * E' fissa e non segue la lingua predefinita del sito: lo schema e' statico,
 * mentre la lingua del sito sta in `SiteSetting` e si legge dal database a
 * ogni richiesta. Per seguirla, le rotte di creazione e modifica dovrebbero
 * costruire lo schema per richiesta; cambiare la lingua richiesta cambierebbe
 * anche il contratto per i client dell'API che mandano oggi solo `it`. Il
 * wizard controlla in piu' la lingua predefinita del sito, che e' quella che
 * l'operatore vede come obbligatoria.
 */
export const EVENT_DESCRIPTION_REQUIRED_LOCALE = 'it';
