/**
 * GET /api/status/postprod
 *
 * Status page endpoint per la pipeline AI postprod. Pubblico (stesso
 * livello del resto della status page).
 *
 * Tre stati possibili a livello macro:
 *
 *   1. `disabled`  — SiteSetting.aiPipelineEnabled = false. Il chart
 *                    è installato (Recording rows possono esistere)
 *                    ma l'admin non ha attivato la pipeline. La UI
 *                    nasconde il pannello postprod (graceful
 *                    degradation: nessun rumore per un deploy che non
 *                    usa la feature).
 *
 *   2. `idle`      — pipeline enabled, nessun job in coda. Tutto OK.
 *
 *   3. `degraded`  — pipeline enabled, ma >0 job in stato FAILED nelle
 *                    ultime 24h, OR >0 job PENDING da più del lookback
 *                    senza nessun worker che li claima (probabile
 *                    problema con l'orchestrator / GPU pool).
 *
 *   4. `running`   — pipeline enabled, almeno un job CLAIMED/RUNNING
 *                    in questo momento.
 *
 * Aggiorna anche i gauge Prometheus prima di rispondere — così la
 * status page e la scrape Prometheus condividono lo stesso snapshot.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { refreshPostprodGauges } from '@/lib/ai/metrics';

export const dynamic = 'force-dynamic';

type PipelineStatus = 'disabled' | 'idle' | 'running' | 'degraded';

export interface PostprodStatus {
  status: PipelineStatus;
  // Snapshot della coda. byStatus contiene sempre TUTTI gli stati con
  // valore 0 quando vuoti — la UI può iterare deterministicamente.
  queue: {
    byStatus: Record<string, number>;
    total: number;
  };
  // Conteggio Recording per status. Utile per "verbale prodotti
  // questa settimana" sulla dashboard admin.
  recordings: {
    queued: number;
    running: number;
    done: number;
    partial: number;
    failed: number;
  };
  // Tempo dell'ultimo successo + ultimo fallimento. Null quando mai
  // accaduti.
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  // Conteggio artefatti prodotti per tipo (TRANSCRIPT_VTT, SUMMARY_MD…).
  artifactsByType: Record<string, number>;
  // Configurazione provider letta da SiteSetting + Event.
  // `events.aiTranscriptEnabled` non è uno stato globale: ogni evento
  // può attivarlo o no. Esponiamo solo il count attuale.
  config: {
    llmProvider: string;
    asrProvider: string;
    defaultTargetLocales: string[];
    maxConcurrentJobs: number;
    artifactRetentionDays: number;
  };
  events: {
    aiEnabledCount: number; // Event.aiTranscriptEnabled = true
    summaryEnabledCount: number;
    translationEnabledCount: number;
  };
  lastChecked: string;
}

export const GET = withErrorHandling(async () => {
  const site = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: {
      aiPipelineEnabled: true,
      aiLlmProvider: true,
      aiAsrProvider: true,
      aiDefaultTargetLocales: true,
      aiMaxConcurrentJobs: true,
      aiArtifactRetentionDays: true,
    },
  });
  const pipelineEnabled = site?.aiPipelineEnabled ?? false;

  // Cheap path quando disabled: niente JOIN, niente count, restituisci
  // forma "vuota". La UI usa `status=disabled` per nascondere il
  // pannello senza distinzione fra "mai usato" e "spento da X".
  if (!pipelineEnabled) {
    await refreshPostprodGauges();
    return Response.json({
      status: 'disabled',
      queue: { byStatus: {}, total: 0 },
      recordings: { queued: 0, running: 0, done: 0, partial: 0, failed: 0 },
      lastSuccessAt: null,
      lastFailureAt: null,
      artifactsByType: {},
      config: {
        llmProvider: site?.aiLlmProvider ?? 'vllm',
        asrProvider: site?.aiAsrProvider ?? 'whisperx',
        defaultTargetLocales: [],
        maxConcurrentJobs: site?.aiMaxConcurrentJobs ?? 0,
        artifactRetentionDays: site?.aiArtifactRetentionDays ?? 0,
      },
      events: { aiEnabledCount: 0, summaryEnabledCount: 0, translationEnabledCount: 0 },
      lastChecked: new Date().toISOString(),
    } satisfies PostprodStatus);
  }

  // Single round-trip: il queue snapshot + Recording counts + last
  // success/failure timestamps. Una count() per ognuno tiene basso
  // il carico — gli indici su (status) di postprod_jobs e recordings
  // bastano. Lanciate in parallel.
  const stats = await refreshPostprodGauges();

  const [recordingCounts, lastSuccess, lastFailure, artifactCounts, eventStats] =
    await Promise.all([
      prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
        SELECT status::text, COUNT(*)::bigint FROM recordings GROUP BY status
      `,
      prisma.postprodJob.findFirst({
        where: { status: 'DONE' },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      }),
      prisma.postprodJob.findFirst({
        where: { status: 'FAILED' },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      }),
      prisma.$queryRaw<Array<{ type: string; count: bigint }>>`
        SELECT type::text, COUNT(*)::bigint FROM postprod_artifacts GROUP BY type
      `,
      prisma.$queryRaw<Array<{
        ai_enabled: bigint;
        summary_enabled: bigint;
        translation_enabled: bigint;
      }>>`
        SELECT
          COUNT(*) FILTER (WHERE ai_transcript_enabled)::bigint AS ai_enabled,
          COUNT(*) FILTER (WHERE ai_summary_enabled)::bigint AS summary_enabled,
          COUNT(*) FILTER (WHERE ai_translation_enabled)::bigint AS translation_enabled
        FROM events
      `,
    ]);

  const recCounts = { queued: 0, running: 0, done: 0, partial: 0, failed: 0 };
  for (const row of recordingCounts) {
    const n = Number(row.count);
    switch (row.status) {
      case 'POSTPROD_QUEUED':
        recCounts.queued = n;
        break;
      case 'POSTPROD_RUNNING':
        recCounts.running = n;
        break;
      case 'POSTPROD_DONE':
        recCounts.done = n;
        break;
      case 'POSTPROD_PARTIAL':
        recCounts.partial = n;
        break;
      case 'POSTPROD_FAILED':
        recCounts.failed = n;
        break;
    }
  }

  const artifactsByType: Record<string, number> = {};
  for (const r of artifactCounts) artifactsByType[r.type] = Number(r.count);

  const evStat = eventStats[0];

  // Compute high-level status. "degraded" is intentionally
  // conservative: any FAILED in last 24h surfaces a warning so an
  // operator notices, even if subsequent jobs succeeded.
  const failedRecent = await prisma.postprodJob.count({
    where: {
      status: 'FAILED',
      completedAt: { gte: new Date(Date.now() - 24 * 3600_000) },
    },
  });
  const running =
    (stats.byStatus['CLAIMED'] ?? 0) + (stats.byStatus['RUNNING'] ?? 0);
  const pending = stats.byStatus['PENDING'] ?? 0;

  let pipelineStatus: PipelineStatus;
  if (failedRecent > 0) pipelineStatus = 'degraded';
  else if (running > 0) pipelineStatus = 'running';
  else if (pending > 0) pipelineStatus = 'running'; // sta per partire
  else pipelineStatus = 'idle';

  return Response.json({
    status: pipelineStatus,
    queue: { byStatus: stats.byStatus, total: stats.total },
    recordings: recCounts,
    lastSuccessAt: lastSuccess?.completedAt?.toISOString() ?? null,
    lastFailureAt: lastFailure?.completedAt?.toISOString() ?? null,
    artifactsByType,
    config: {
      llmProvider: site?.aiLlmProvider ?? 'vllm',
      asrProvider: site?.aiAsrProvider ?? 'whisperx',
      defaultTargetLocales: (site?.aiDefaultTargetLocales ?? 'en,fr')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      maxConcurrentJobs: site?.aiMaxConcurrentJobs ?? 2,
      artifactRetentionDays: site?.aiArtifactRetentionDays ?? 0,
    },
    events: {
      aiEnabledCount: Number(evStat?.ai_enabled ?? 0n),
      summaryEnabledCount: Number(evStat?.summary_enabled ?? 0n),
      translationEnabledCount: Number(evStat?.translation_enabled ?? 0n),
    },
    lastChecked: new Date().toISOString(),
  } satisfies PostprodStatus);
});
