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
 * Le instant call (eventType INSTANT) restano fuori dalle superfici
 * pubbliche quando sono parcheggiate in IDLE/PROVISIONING: sono chiamate
 * link-only, non eventi a calendario.
 */

/** Stati sempre visibili pubblicamente, per qualunque tipo di evento. */
export const ALWAYS_PUBLIC_STATUSES: EventStatus[] = ['PUBLISHED', 'LIVE', 'ENDED'];

/** Stati di warm-up/pausa: pubblici SOLO per eventi schedulati (non INSTANT). */
export const WARMUP_STATUSES: EventStatus[] = ['PROVISIONING', 'IDLE'];

interface EventLike {
  status: string;
  eventType?: string | null;
}

/** True se la pagina pubblica dell'evento deve essere raggiungibile. */
export function isEventPubliclyVisible(event: EventLike): boolean {
  if ((ALWAYS_PUBLIC_STATUSES as string[]).includes(event.status)) {
    return true;
  }
  return (
    (WARMUP_STATUSES as string[]).includes(event.status) &&
    event.eventType !== 'INSTANT'
  );
}

/** True se l'evento accetta nuove registrazioni (pagina + POST API). */
export function isEventOpenForRegistration(event: EventLike): boolean {
  if (event.status === 'PUBLISHED' || event.status === 'LIVE') return true;
  return (
    (WARMUP_STATUSES as string[]).includes(event.status) &&
    event.eventType !== 'INSTANT'
  );
}

/**
 * Frammento Prisma `where` per le superfici pubbliche (listing, home,
 * sitemap). `includeEnded: false` per le superfici solo-futuro (home).
 * Da combinare con altre condizioni via spread: le chiavi extra vanno in
 * AND con l'OR restituito.
 */
export function publicEventStatusWhere(opts?: {
  includeEnded?: boolean;
}): Prisma.EventWhereInput {
  const base: EventStatus[] =
    opts?.includeEnded === false ? ['PUBLISHED', 'LIVE'] : ALWAYS_PUBLIC_STATUSES;
  return {
    OR: [
      { status: { in: base } },
      { status: { in: WARMUP_STATUSES }, eventType: { not: 'INSTANT' } },
    ],
  };
}
