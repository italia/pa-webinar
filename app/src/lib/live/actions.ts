/**
 * La cronologia della sala: ogni azione dal vivo si scrive qui, con l'ora del
 * server come unica base dei tempi. La post-produzione la mette accanto alla
 * trascrizione (lib/postprod/live-timeline.ts), cosi' la sintesi sa quando
 * e' cominciato un argomento, quando si e' chiuso un sondaggio e con che
 * risultati, quante mani si sono alzate.
 *
 * Scrivere non deve mai far fallire l'azione: un errore si registra nel log
 * e basta. Nei dati vanno id, contenuti di chi conduce e conteggi; mai nomi o
 * dati di chi partecipa (le domande del pubblico la cronologia le legge dalle
 * loro tabelle, che il cleanup gia' cancella).
 */

import { after } from 'next/server';

import { prisma } from '@/lib/db';

export const LIVE_ACTION_KINDS = [
  'agenda.topic',
  'poll.opened',
  'poll.closed',
  'poll.published',
  'poll.reopened',
  'poll.deleted',
  'wordcloud.opened',
  'wordcloud.closed',
  'wordcloud.word_removed',
  'question.status',
  'chat.question.status',
  'chat.hidden',
  'feature.toggled',
  'recording.started',
  'recording.stopped',
  'timer.started',
  'timer.stopped',
  'hand.raised',
  'event.ended',
] as const;
export type LiveActionKind = (typeof LIVE_ACTION_KINDS)[number];

export type LiveActor = 'moderator' | 'speaker' | 'participant' | 'guest' | 'system';

export interface LiveActionInput {
  eventId: string;
  kind: LiveActionKind;
  actor?: LiveActor;
  data?: Record<string, unknown>;
  /** Ora dell'azione, se non e' adesso (una domanda chiusa allo scadere, una
   *  mano alzata riferita dal browser qualche secondo dopo). */
  at?: Date;
}

function riga(a: LiveActionInput) {
  return {
    eventId: a.eventId,
    kind: a.kind,
    actor: a.actor ?? null,
    data: (a.data ?? {}) as object,
    ...(a.at && { at: a.at }),
  };
}

/**
 * Registra un'azione senza farla aspettare a chi l'ha fatta: la scrittura va
 * dopo la risposta (`after` di Next, che la tiene viva fino alla fine anche
 * durante lo spegnimento ordinato del pod) e la promessa si risolve subito.
 * Con il database lento o le connessioni esaurite, una risposta all'utente
 * non resta appesa a una riga di cronologia. Non solleva mai; un errore va
 * nel log. Fuori da una richiesta (script, test) la scrittura parte subito.
 */
export function recordLiveAction(a: LiveActionInput): Promise<void> {
  avvia(() => prisma.liveAction.create({ data: riga(a) }), a.kind);
  return Promise.resolve();
}

/** Registra piu' azioni in una scrittura, come recordLiveAction. */
export function recordLiveActions(azioni: readonly LiveActionInput[]): Promise<void> {
  if (azioni.length === 0) return Promise.resolve();
  avvia(() => prisma.liveAction.createMany({ data: azioni.map(riga) }), azioni[0]?.kind);
  return Promise.resolve();
}

/** Fa partire una scrittura senza aspettarla; un errore, anche immediato,
 *  finisce nel log e non a chi ha fatto l'azione. */
function avvia(scrivi: () => Promise<unknown>, kind: string | undefined): void {
  const log = (err: unknown) => console.error('[live-actions] scrittura non riuscita', kind, err);
  const esegui = async () => {
    try {
      await scrivi();
    } catch (err) {
      log(err);
    }
  };
  try {
    after(esegui);
  } catch {
    // Nessuna richiesta in corso: `after` non si puo' usare.
    void esegui();
  }
}

/**
 * L'ora del server di un fatto avvenuto nel browser. Il browser manda l'ora
 * del fatto e quella di invio del lotto, entrambe dal suo orologio: la
 * differenza con l'orologio del server, misurata all'arrivo, si toglie. Un
 * browser con l'orologio avanti di un minuto non sposta niente.
 * Senza le due ore, o con valori senza senso, l'ora di arrivo.
 */
export function serverTimeOf(
  atEpochMs: number | undefined,
  sentAt: number | undefined,
  arrivedAt: number = Date.now(),
): Date {
  if (atEpochMs === undefined || sentAt === undefined) return new Date(arrivedAt);
  const t = atEpochMs + (arrivedAt - sentAt);
  // Un fatto nel futuro, o vecchio di oltre un giorno, e' un dato rotto.
  if (!Number.isFinite(t) || t > arrivedAt || arrivedAt - t > 86_400_000) {
    return new Date(arrivedAt);
  }
  return new Date(t);
}
