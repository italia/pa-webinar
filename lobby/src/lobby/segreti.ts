/**
 * I codici segreti da tastiera, elencati nella legenda della piazza:
 * su su giù giù sinistra destra sinistra destra B A fa festa, «boom» accende
 * i fuochi tricolore sopra il cancello, «polo» fa nevicare per un minuto. Le
 * parole usano solo lettere libere: niente gesti (E H C R I) né movimenti
 * (W A S D) mentre le si scrive.
 */
export const CODICI_SEGRETI = {
  festa: ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'],
  fuochi: ['b', 'o', 'o', 'm'],
  neve: ['p', 'o', 'l', 'o'],
} as const;
