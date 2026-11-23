// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

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
 *      solo con un token — iscrizione, link di conduzione. Un evento solo su
 *      invito (`Event.accessMode` = `INVITATION`) non ne ammette comunque:
 *      altrimenti chi non è invitato entrerebbe senza iscriversi. Una chiamata rapida
 *      non ha iscrizione: il link È l'invito, e resta aperta a chi lo riceve
 *      qualunque sia l'impostazione, altrimenti non ci entrerebbe nessuno.
 *   2. La stanza è aperta adesso? Lo è da quando si apre la sala d'attesa:
 *      in allestimento, quando il bridge si accende (un evento a calendario
 *      poco prima dell'inizio, una chiamata rapida appena creata), in diretta
 *      e in pausa, quando la sala si è svuotata e chi arriva la riaccende. È
 *      la stessa regola per i due tipi di evento. Chi aspetta non è ancora
 *      nella conferenza: il token della sala lo dà solo la diretta (rotta del
 *      token). Prima che la sala si apra, su un evento a calendario si passa
 *      dall'iscrizione, che consegna un token personale.
 */

/** Gli stati in cui la sala d'attesa è aperta. */
const STANZA_APERTA = new Set(['PROVISIONING', 'LIVE', 'IDLE']);

/**
 * In diretta la stanza c'e'. In allestimento e in pausa invece va ancora
 * accesa, e lo fa `/wake` — che rifiuta un evento oltre la sua fine, di
 * qualunque tipo. Lo scaler chiude quell'evento al giro successivo; se e'
 * fermo, l'evento resta in pausa e chi entrasse aspetterebbe una sala che non
 * si apre piu', leggendo intanto la chat di un evento finito. Per questo in
 * quegli stati la stanza e' aperta solo prima della fine.
 */
export function roomCanStillOpen(
  event: { status: string; endsAt: Date | string },
  now: number = Date.now(),
): boolean {
  return event.status === 'LIVE' || new Date(event.endsAt).getTime() > now;
}

/** L'evento ammette chi arriva senza token, stato a parte (domanda 1). */
export function guestAccessAllowed(
  event: { eventType: string; accessMode: string | null },
  guestAccessEnabled: boolean,
): boolean {
  if (event.eventType === 'INSTANT') return true;
  if (event.accessMode === 'INVITATION') return false;
  return guestAccessEnabled;
}

/** La stanza è aperta adesso a chi arriva senza token (domande 1 e 2). */
export function guestWindowOpen(
  event: { status: string; eventType: string; accessMode: string | null; endsAt: Date | string },
  guestAccessEnabled: boolean,
  now: number = Date.now(),
): boolean {
  if (!guestAccessAllowed(event, guestAccessEnabled)) return false;
  return STANZA_APERTA.has(event.status) && roomCanStillOpen(event, now);
}
