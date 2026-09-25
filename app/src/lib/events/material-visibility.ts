/**
 * Quando un materiale dell'evento è visibile al pubblico.
 *
 * Ogni materiale porta una `visibility` scelta da chi lo carica: ALWAYS
 * (sempre), BEFORE (solo prima dell'evento), DURING (solo durante), AFTER
 * (solo dopo). La regola si applica LATO SERVER su ogni superficie che elenca
 * i materiali al pubblico — scheda dell'evento prima dell'inizio, pannello
 * della sala live, scheda post-evento, elenco dei file — perché un filtro nel
 * client non nasconde niente: la risposta dell'API resta leggibile da
 * chiunque. Chi conduce la sala (token moderatore) vede tutto: deve poter
 * preparare e controllare anche quello che il pubblico non vede ancora.
 *
 * Il filtro governa gli ELENCHI, non l'accesso all'oggetto: un link resta un
 * indirizzo esterno, e un file caricato resta scaricabile dal suo URL
 * `/api/assets/…` (pubblico, cache lunga) da chiunque lo abbia già. Non è un
 * controllo di riservatezza: un materiale che non deve circolare non va
 * caricato come materiale dell'evento.
 *
 * La fase si ricava prima dallo stato, che quando è decisivo è il segnale
 * autorevole: LIVE è «durante» anche se la sala è stata aperta in anticipo o
 * va oltre l'orario; ENDED e ARCHIVED sono «dopo». Negli altri stati (bozza,
 * pubblicato, preparazione, pausa) decide l'orario: prima di `startsAt` è
 * «prima», da `endsAt` in poi è «dopo», nel mezzo è «durante». Così una sala
 * in pausa a metà evento resta «durante», e un evento finito ma rimasto
 * incagliato in pausa (scaler giù) non torna a mostrare i materiali del
 * «prima».
 */

export type MaterialPhase = 'BEFORE' | 'DURING' | 'AFTER';

interface MaterialPhaseEvent {
  status: string;
  startsAt: Date | string;
  endsAt: Date | string;
}

/** La fase dell'evento rispetto a cui filtrare i materiali. */
export function materialPhase(
  event: MaterialPhaseEvent,
  now: Date = new Date(),
): MaterialPhase {
  if (event.status === 'LIVE') return 'DURING';
  if (event.status === 'ENDED' || event.status === 'ARCHIVED') return 'AFTER';
  const t = now.getTime();
  if (t < new Date(event.startsAt).getTime()) return 'BEFORE';
  if (t >= new Date(event.endsAt).getTime()) return 'AFTER';
  return 'DURING';
}

/**
 * True se un materiale con questa `visibility` va mostrato al pubblico nella
 * fase indicata. Un valore sconosciuto (la colonna è una stringa libera nel
 * DB) resta nascosto: nel dubbio non si pubblica.
 */
export function isMaterialVisibleInPhase(visibility: string, phase: MaterialPhase): boolean {
  return visibility === 'ALWAYS' || visibility === phase;
}

/**
 * Lo stesso filtro come frammento `where` di Prisma, da combinare con
 * `eventId`: la selezione avviene nel DB, non dopo.
 */
export function materialVisibilityWhere(phase: MaterialPhase): {
  visibility: { in: string[] };
} {
  return { visibility: { in: ['ALWAYS', phase] } };
}
