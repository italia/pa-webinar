/**
 * Quando una stanza è aperta a chi arriva senza token.
 *
 * La finestra è una sola per tutta la sala live — chat, Q&A, sondaggi — perché
 * la domanda è una sola: «questa persona è dentro la stanza?». Duplicare la
 * condizione per pannello è il modo in cui un pannello finisce per rispondere
 * 401 a un ospite che sta guardando la diretta accanto agli altri.
 *
 * Una chiamata istantanea si apre già in preparazione: chi ha il link entra e
 * aspetta nella sala d'attesa mentre il bridge si accende. Un evento a
 * calendario si apre solo quando è in diretta; prima si passa dalla
 * registrazione, che consegna un token personale.
 */
export function guestWindowOpen(event: { status: string; eventType: string }): boolean {
  return (
    event.status === 'LIVE' ||
    (event.eventType === 'INSTANT' &&
      (event.status === 'PROVISIONING' || event.status === 'IDLE'))
  );
}
