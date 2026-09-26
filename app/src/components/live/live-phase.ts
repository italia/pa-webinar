/**
 * Regole di passaggio fra le schermate della sala live, estratte dal
 * componente per poterle verificare da sole.
 */

/**
 * Dove porta un'uscita dalla conferenza. «Evento concluso» solo quando
 * l'evento e' davvero ENDED: chi esce da solo — «Esci dalla sala», «Esci solo
 * tu», una riconnessione abbandonata — trova la sala ancora aperta e deve
 * poterci rientrare.
 */
export function closingPhase(eventStatus: string): 'ended' | 'left' {
  return eventStatus === 'ENDED' ? 'ended' : 'left';
}

/**
 * Dopo un 409 della richiesta del token Jitsi (l'evento non e' piu' in uno
 * stato che ammette ingressi), lo stato letto da /lifecycle dice dove andare:
 * concluso → la chiusura; tornato in attesa (bridge spento dopo
 * l'inattivita', o non ancora avviato) → la sala d'attesa, che sa riaccenderlo.
 * Altrimenti null: resta l'errore com'e'.
 */
export function phaseAfterTokenConflict(status: unknown): 'ended' | 'waiting' | null {
  if (status === 'ENDED') return 'ended';
  if (status === 'PUBLISHED' || status === 'IDLE' || status === 'PROVISIONING') return 'waiting';
  return null;
}

/**
 * L'uscita per chi non ha il pannello di amministrazione. Una chiamata
 * istantanea non ha una pagina pubblica (fa 404 finche' non e' conclusa, e
 * spesso anche dopo): si torna alla home.
 */
export function exitDestination(eventType: string | undefined, slug: string): string {
  return eventType === 'INSTANT' ? '/' : `/events/${slug}`;
}
