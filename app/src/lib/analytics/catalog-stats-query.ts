// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * La lettura delle statistiche del catalogo dalla banca dati: gli eventi del
 * periodo (bozze escluse) e le loro sessioni di sala. Le regole sono in
 * catalog-stats.ts.
 */

import { prisma } from '@/lib/db';

import {
  aggregaCatalogo,
  finestraDeiMesi,
  mesiFinoA,
  type MesiCatalogo,
  type RigaCatalogo,
  type StatisticheCatalogo,
} from './catalog-stats';

/** Le statistiche del catalogo degli ultimi `mesi` mesi, nel fuso dell'istanza. */
export async function statisticheCatalogo(
  mesi: MesiCatalogo,
  timezone: string,
  ora = new Date()
): Promise<StatisticheCatalogo> {
  const months = mesiFinoA(ora, mesi, timezone);
  const { since, until } = finestraDeiMesi(months);
  const nelPeriodo = {
    startsAt: { gte: since, lt: until },
    status: { not: 'DRAFT' as const },
  };

  const [eventi, sessioni] = await Promise.all([
    prisma.event.findMany({
      where: nelPeriodo,
      select: {
        id: true,
        eventType: true,
        formatClass: true,
        templateId: true,
        templateName: true,
        template: { select: { name: true } },
        startsAt: true,
        peakParticipants: true,
      },
    }),
    // Una riga per evento, sommata dal database: le sessioni di due anni di
    // chiamate rapide non passano dall'applicazione. Una sessione aperta conta
    // fra le sessioni e non nella durata (SUM ignora i NULL).
    prisma.$queryRaw<
      Array<{ eventId: string; sessions: number; durationSec: number | null }>
    >`
      SELECT cs.event_id AS "eventId",
             COUNT(*)::int AS "sessions",
             SUM(GREATEST(0, EXTRACT(EPOCH FROM (cs.ended_at - cs.started_at))))::float8 AS "durationSec"
      FROM call_sessions cs
      JOIN events e ON e.id = cs.event_id
      WHERE e.starts_at >= ${since} AND e.starts_at < ${until} AND e.status <> 'DRAFT'
      GROUP BY cs.event_id`,
  ]);

  const perEvento = new Map(
    sessioni.map((s) => [
      s.eventId,
      {
        sessions: s.sessions,
        durationSec: s.durationSec == null ? null : Math.round(s.durationSec),
      },
    ])
  );

  const righe: RigaCatalogo[] = eventi.map((e) => ({
    eventType: e.eventType,
    formatClass: e.formatClass,
    templateId: e.templateId,
    templateName: e.templateName,
    templateCurrentName: e.template?.name ?? null,
    startsAt: e.startsAt,
    peakParticipants: e.peakParticipants,
    sessions: perEvento.get(e.id)?.sessions ?? 0,
    durationSec: perEvento.get(e.id)?.durationSec ?? null,
  }));

  return { ...aggregaCatalogo(righe, months, timezone), timezone };
}
