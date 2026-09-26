/**
 * Quali eventi contano come «in corso» e «in arrivo» sulle pagine di stato e
 * nel monitoraggio. Una regola sola per l'elenco e per ogni contatore.
 *
 * - LIVE conta sempre, anche oltre `endsAt`: una sala in diretta finisce
 *   quando qualcuno (il moderatore, il ciclo di vita automatico) la chiude,
 *   non quando scade l'orario in calendario. Nasconderla mentre ha ancora
 *   gente dentro faceva divergere l'elenco dai contatori.
 * - PROVISIONING, IDLE e PUBLISHED contano solo finché `endsAt` non è
 *   passato: oltre, sono eventi rimasti indietro, non sale in arrivo.
 *
 * L'elenco pubblico dei prossimi eventi applica in più le regole di
 * visibilità delle altre superfici pubbliche (lib/events/visibility): niente
 * chiamate istantanee, che sono link-only.
 */

import type { Prisma } from '@prisma/client';

/** Stati di un evento «in corso»: in diretta o in allestimento. */
export const RUNNING_STATUSES = ['LIVE', 'PROVISIONING'] as const;

/** Un evento `status` che conta ancora a questo istante. */
export function activeStatusWhere(
  status: 'LIVE' | 'PROVISIONING' | 'IDLE' | 'PUBLISHED',
  now: Date,
): Prisma.EventWhereInput {
  if (status === 'LIVE') return { status: 'LIVE' };
  return { status, endsAt: { gte: now } };
}

/** Eventi in corso o in arrivo: LIVE sempre, gli altri finché non sono finiti. */
export function activeOrUpcomingWhere(now: Date): Prisma.EventWhereInput {
  return {
    OR: [
      { status: 'LIVE' },
      { status: { in: ['PUBLISHED', 'PROVISIONING', 'IDLE'] }, endsAt: { gte: now } },
    ],
  };
}

/** L'ordine dell'elenco: prima le dirette, poi gli allestimenti, poi il resto per inizio. */
export function compareForStatusList(
  a: { status: string; startsAt: Date },
  b: { status: string; startsAt: Date },
): number {
  const rank = (s: string) => (s === 'LIVE' ? 0 : s === 'PROVISIONING' ? 1 : 2);
  const byStatus = rank(a.status) - rank(b.status);
  if (byStatus !== 0) return byStatus;
  return a.startsAt.getTime() - b.startsAt.getTime();
}
