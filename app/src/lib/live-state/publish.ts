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

import {
  publishLiveState,
  LIVE_FLAG_FIELDS,
  type LiveFlagField,
  type LiveFlags,
  type PokeablePanel,
} from './pubsub';

// L'elenco dei flag vive in un posto solo, nel modulo del canale.

/**
 * Finestra di accorpamento degli avvisi, per processo. Venti voti in due
 * secondi sono un solo cambiamento dal punto di vista di chi guarda: senza
 * questo, ogni voto diventerebbe una scrittura su OGNI connessione aperta
 * dell'evento, e il client li scarterebbe comunque per via del proprio freno.
 */
const ACCORPAMENTO_MS = 1_000;

interface Finestra {
  timer: ReturnType<typeof setTimeout>;
  /** Qualcosa è cambiato ancora dopo l'avviso già partito. */
  arretrato: boolean;
}

const finestre = new Map<string, Finestra>();

function annuncia(eventId: string, panel: PokeablePanel): void {
  void publishLiveState(eventId, { op: 'poke', panel, ts: new Date().toISOString() });
}

/**
 * Dice «rileggi questo pannello». Non porta contenuto: vedi pubsub.
 *
 * Il primo avviso parte subito — chi guarda deve vedere la cosa arrivare — e
 * quelli della finestra successiva vengono accorpati in UNO, emesso alla fine.
 * Accorpare senza quel secondo avviso perderebbe l'ultima modifica della
 * raffica: il client, col polling spento, non avrebbe nessun altro motivo per
 * rileggere.
 */
export function pokeLivePanel(eventId: string, panel: PokeablePanel): void {
  const chiave = `${eventId}:${panel}`;
  const aperta = finestre.get(chiave);
  if (aperta) {
    aperta.arretrato = true;
    return;
  }

  annuncia(eventId, panel);
  const timer = setTimeout(() => {
    const finestra = finestre.get(chiave);
    finestre.delete(chiave);
    if (finestra?.arretrato) annuncia(eventId, panel);
  }, ACCORPAMENTO_MS);
  // Non deve tenere sveglio il processo in chiusura.
  if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  finestre.set(chiave, { timer, arretrato: false });
}

/** Solo per i test: svuota la finestra di accorpamento. */
export function __resetPokeCoalescing(): void {
  for (const finestra of finestre.values()) clearTimeout(finestra.timer);
  finestre.clear();
}

/** Annuncia il nuovo stato dell'evento (LIVE, ENDED, …). */
export function publishEventStatus(eventId: string, status: string): void {
  void publishLiveState(eventId, {
    op: 'eventStatus',
    status,
    ts: new Date().toISOString(),
  });
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
  prima: Record<LiveFlagField, boolean>,
  dopo: Record<LiveFlagField, boolean>
): boolean {
  const cambiato = LIVE_FLAG_FIELDS.some((campo) => prima[campo] !== dopo[campo]);
  if (!cambiato) return false;

  const flags = Object.fromEntries(
    LIVE_FLAG_FIELDS.map((campo) => [campo, dopo[campo]])
  ) as LiveFlags;
  void publishLiveState(eventId, { op: 'flags', flags, ts: new Date().toISOString() });
  return true;
}
