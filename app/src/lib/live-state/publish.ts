/**
 * Scorciatoie per notificare la sala live da una rotta che ha appena scritto.
 *
 * Stanno qui e non nelle rotte perché il punto delicato è uno solo e va scritto
 * una volta: **la notifica non deve mai far fallire la mutazione**. Il dato è
 * già salvato; un pannello che si aggiorna un attimo dopo è un fastidio, una
 * scrittura che risponde 500 perché Redis non risponde è un danno.
 *
 * Per questo nessuna di queste funzioni si attende: si chiamano con `void` dopo
 * il commit, non dentro la transazione.
 */

import { publishLiveState, type LiveFlags, type PokeablePanel } from './pubsub';

/** I flag che l'evento pubblica: gli stessi serviti da GET .../flags. */
const CAMPI_FLAG = [
  'qaEnabled',
  'chatEnabled',
  'agendaEnabled',
  'wordCloudEnabled',
  'recordingEnabled',
] as const;

type CampoFlag = (typeof CAMPI_FLAG)[number];

/** Dice «rileggi questo pannello». Non porta contenuto: vedi pubsub. */
export function pokeLivePanel(eventId: string, panel: PokeablePanel): void {
  void publishLiveState(eventId, { op: 'poke', panel, ts: new Date().toISOString() });
}

/** Annuncia il nuovo stato dell'evento (LIVE, ENDED, …). */
export function publishEventStatus(eventId: string, status: string): void {
  void publishLiveState(eventId, { op: 'eventStatus', status, ts: new Date().toISOString() });
}

/**
 * Annuncia i flag SOLO se sono davvero cambiati.
 *
 * La rotta di modifica è generalista: il wizard di modifica le rimanda decine di
 * campi a ogni salvataggio, e pubblicare a ogni passaggio farebbe rileggere i
 * flag a tutta la sala per un cambio di descrizione.
 */
export function publishFlagsIfChanged(
  eventId: string,
  prima: Record<CampoFlag, boolean>,
  dopo: Record<CampoFlag, boolean>,
): boolean {
  const cambiato = CAMPI_FLAG.some((campo) => prima[campo] !== dopo[campo]);
  if (!cambiato) return false;

  const flags: LiveFlags = {
    qaEnabled: dopo.qaEnabled,
    chatEnabled: dopo.chatEnabled,
    agendaEnabled: dopo.agendaEnabled,
    wordCloudEnabled: dopo.wordCloudEnabled,
    recordingEnabled: dopo.recordingEnabled,
  };
  void publishLiveState(eventId, { op: 'flags', flags, ts: new Date().toISOString() });
  return true;
}
