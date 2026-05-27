/**
 * Helper per aggiornare i gauge della pipeline postprod a partire dallo
 * stato corrente del DB. Chiamato dal cron `postprod-reclaim` (ogni
 * minuto) e dall'endpoint `/api/status/postprod` per garantire che la
 * scrape Prometheus prenda valori freschi anche se la pipeline è idle.
 *
 * **Graceful degradation**: se `SiteSetting.aiPipelineEnabled = false`
 * azzeriamo i gauge invece di sospenderli — Prometheus continua a
 * scrappare e vede esplicitamente "0 jobs in tutti gli stati + pipeline
 * disabled" invece di un'assenza di metriche che sarebbe ambigua.
 */

import { prisma } from '@/lib/db';
import {
  postprodJobsByStatusGauge,
  postprodPipelineEnabledGauge,
} from '@/lib/metrics';

interface QueueStats {
  pipelineEnabled: boolean;
  byStatus: Record<string, number>;
  total: number;
}

const ALL_STATUSES = ['PENDING', 'CLAIMED', 'RUNNING', 'DONE', 'FAILED'] as const;

/**
 * Read queue counts grouped by status. Single round-trip via raw SQL —
 * Prisma's groupBy works too but raw SQL keeps the dependency surface
 * smaller for a metrics path that runs on every scrape.
 */
export async function readPostprodQueueStats(): Promise<QueueStats> {
  const site = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { aiPipelineEnabled: true },
  });
  const enabled = site?.aiPipelineEnabled ?? false;

  // Even when disabled we still query the DB so an admin who recently
  // toggled it off sees the trailing queue state — useful when
  // troubleshooting "perché ho ancora dei job DONE in DB?".
  const rows = await prisma.$queryRaw<
    Array<{ status: string; count: bigint }>
  >`SELECT status::text, COUNT(*)::bigint FROM postprod_jobs GROUP BY status`;

  const byStatus: Record<string, number> = {};
  for (const s of ALL_STATUSES) byStatus[s] = 0;
  for (const row of rows) byStatus[row.status] = Number(row.count);

  return {
    pipelineEnabled: enabled,
    byStatus,
    total: rows.reduce((acc, r) => acc + Number(r.count), 0),
  };
}

/**
 * Refresh Prometheus gauges from current queue state. Idempotent —
 * setting the same value twice is fine. Callers don't need to await
 * other observers; this is fire-and-forget metrics-only.
 */
export async function refreshPostprodGauges(): Promise<QueueStats> {
  const stats = await readPostprodQueueStats();
  postprodPipelineEnabledGauge.set(stats.pipelineEnabled ? 1 : 0);
  for (const status of ALL_STATUSES) {
    postprodJobsByStatusGauge.labels(status).set(stats.byStatus[status] ?? 0);
  }
  return stats;
}
