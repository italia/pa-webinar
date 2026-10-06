/**
 * La lettura leggera di «in una parola» (`GET …/wordcloud?lite=1`): c'e' una
 * domanda aperta, e quale. La legge ogni presente per il pallino sulla scheda,
 * quindi resta in caldo qualche secondo; chi apre o chiude una domanda la
 * dimentica, cosi' l'avviso del canale trova subito lo stato nuovo.
 */

import { deleteCache } from '@/lib/cache';

// Breve: con piu' istanze dell'app, quella che risponde dopo un avviso puo'
// avere in caldo lo stato di prima (la dimentica solo chi ha fatto la modifica).
export const WORDCLOUD_LITE_TTL_MS = 2000;

export function wordcloudLiteKey(eventId: string): string {
  return `wordcloud-lite:${eventId}`;
}

/** Da chiamare quando una domanda si apre o si chiude. */
export function forgetWordcloudLite(eventId: string): void {
  deleteCache(wordcloudLiteKey(eventId));
}
