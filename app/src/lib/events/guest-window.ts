/**
 * Quando una stanza è aperta a chi arriva senza token.
 *
 * La finestra è una sola per tutta la sala live — ingresso, chat, Q&A,
 * sondaggi — perché la domanda è una sola: «questa persona è dentro la
 * stanza?». Duplicare la condizione per pannello è il modo in cui un pannello
 * finisce per rispondere 401 a un ospite che sta guardando la diretta accanto
 * agli altri, o per lasciare leggere la chat a chi alla sala non può entrare.
 *
 * Due domande, in quest'ordine:
 *
 *   1. L'evento ammette ospiti? Per un evento a calendario lo decide
 *      l'amministrazione (`SiteSetting.guestAccessEnabled`): spento, si entra
 *      solo con un token — iscrizione, link di conduzione. Una chiamata rapida
 *      non ha iscrizione: il link È l'invito, e resta aperta a chi lo riceve
 *      qualunque sia l'impostazione, altrimenti non ci entrerebbe nessuno.
 *   2. La stanza è aperta adesso? Una chiamata rapida si apre già in
 *      preparazione: chi ha il link entra e aspetta nella sala d'attesa mentre
 *      il bridge si accende. Un evento a calendario si apre solo quando è in
 *      diretta; prima si passa dalla registrazione, che consegna un token
 *      personale.
 */

/** L'evento ammette chi arriva senza token, stato a parte (domanda 1). */
export function guestAccessAllowed(
  event: { eventType: string },
  guestAccessEnabled: boolean,
): boolean {
  return event.eventType === 'INSTANT' || guestAccessEnabled;
}

/** La stanza è aperta adesso a chi arriva senza token (domande 1 e 2). */
export function guestWindowOpen(
  event: { status: string; eventType: string },
  guestAccessEnabled: boolean,
): boolean {
  if (!guestAccessAllowed(event, guestAccessEnabled)) return false;
  return (
    event.status === 'LIVE' ||
    (event.eventType === 'INSTANT' &&
      (event.status === 'PROVISIONING' || event.status === 'IDLE'))
  );
}
