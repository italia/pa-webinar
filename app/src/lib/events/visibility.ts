import type { EventStatus, Prisma } from '@prisma/client';

/**
 * Visibilità pubblica degli eventi per stato.
 *
 * PROVISIONING e IDLE sono fasi di vita NORMALI di un evento schedulato:
 * il pre-warm del bridge prima dell'inizio (PROVISIONING, anche 30' prima
 * via scaler) e la pausa senza traffico (IDLE, torna LIVE alla prima
 * visita). In quelle fasi la pagina evento, i listing, la sitemap, i
 * reminder e la registrazione devono continuare a funzionare: un
 * partecipante che apre il link pubblico 10 minuti prima dell'inizio non
 * deve trovare un 404.
 *
 * Due guardie sugli stati di warm-up:
 * - le instant call (eventType INSTANT) restano fuori dalle superfici
 *   pubbliche quando sono parcheggiate: sono chiamate link-only, non
 *   eventi a calendario;
 * - endsAt deve essere nel futuro: la transizione IDLE→ENDED la fa lo
 *   scaler, e se lo scaler è giù o sospeso (successo in prod il 12 giu)
 *   un evento FINITO ma incagliato in IDLE non deve tornare "in arrivo"
 *   e registrabile — prima di questo rollout era semplicemente
 *   invisibile, e quella garanzia va mantenuta.
 */

/** Stati sempre visibili pubblicamente, per qualunque tipo di evento. */
export const ALWAYS_PUBLIC_STATUSES: EventStatus[] = ['PUBLISHED', 'LIVE', 'ENDED'];

/** Stati di warm-up/pausa: pubblici SOLO per eventi schedulati non finiti. */
export const WARMUP_STATUSES: EventStatus[] = ['PROVISIONING', 'IDLE'];

/**
 * Stati in cui la registrazione può essere aperta. Per le superfici CLIENT,
 * che ricevono solo eventi già passati dal filtro server (eventType/endsAt
 * inclusi): lato server usare SEMPRE isEventOpenForRegistration.
 */
export const REGISTRABLE_STATUSES: EventStatus[] = [
  'PUBLISHED',
  'PROVISIONING',
  'IDLE',
  'LIVE',
];

interface EventLike {
  status: string;
  eventType: string | null;
  endsAt: Date | string;
}

function isWarmupPubliclyVisible(event: EventLike): boolean {
  return (
    (WARMUP_STATUSES as string[]).includes(event.status) &&
    event.eventType !== 'INSTANT' &&
    new Date(event.endsAt).getTime() > Date.now()
  );
}

/** True se la pagina pubblica dell'evento deve essere raggiungibile. */
export function isEventPubliclyVisible(event: EventLike): boolean {
  return (
    (ALWAYS_PUBLIC_STATUSES as string[]).includes(event.status) ||
    isWarmupPubliclyVisible(event)
  );
}

/** True se l'evento accetta nuove registrazioni (pagina + POST API). */
export function isEventOpenForRegistration(event: EventLike): boolean {
  if (event.status === 'PUBLISHED' || event.status === 'LIVE') return true;
  return isWarmupPubliclyVisible(event);
}

/**
 * Frammento Prisma `where` per le superfici pubbliche (listing, home,
 * sitemap, calendario, API pubblica). `includeEnded: false` per le
 * superfici solo-futuro (home). Da combinare con altre condizioni via
 * spread: le chiavi extra vanno in AND con l'OR restituito.
 */
export function publicEventStatusWhere(opts?: {
  includeEnded?: boolean;
}): Prisma.EventWhereInput {
  const base: EventStatus[] =
    opts?.includeEnded === false ? ['PUBLISHED', 'LIVE'] : ALWAYS_PUBLIC_STATUSES;
  return {
    OR: [
      { status: { in: base } },
      {
        status: { in: WARMUP_STATUSES },
        eventType: { not: 'INSTANT' },
        endsAt: { gt: new Date() },
      },
    ],
  };
}
