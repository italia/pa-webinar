/**
 * GET /api/cron/postprod-reclaim
 *
 * Janitor cron — runs every ~1 min. Three responsibilities:
 *
 *   1. **Reclaim expired leases**: any PostprodJob with status='CLAIMED'
 *      whose `next_attempt_at` is in the past lost its worker (pod
 *      evicted, OOM, network split). We push it back to PENDING with
 *      the lease cleared. The `attempts` counter is already bumped by
 *      the claim endpoint, so we just reset the lease metadata.
 *
 *   2. **Terminal-fail**: any job that exceeded `aiJobMaxAttempts` is
 *      transitioned to FAILED with a synthetic `last_error`. Once a
 *      job is FAILED its recording is moved to POSTPROD_PARTIAL (other
 *      jobs may still succeed; the orchestrator's overall view is
 *      built by the artifact register endpoint).
 *
 *   3. **Traduzione dei testi senza motore**: senza il motore di traduzione
 *      su CPU configurato (AI_MT_BASE_URL, tolto dall'installazione dopo la
 *      richiesta) un lavoro di MT_JOB_KINDS in coda non lo esegue nessun
 *      worker, e senza claim i suoi tentativi non crescono mai: si chiude
 *      come fallito, con il motivo in `last_error`.
 *
 * Protected by CRON_API_KEY.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';
import { MT_JOB_KINDS } from '@/lib/ai/job-classes';
import { refreshPostprodGauges } from '@/lib/ai/metrics';
import { resolveMtProvider } from '@/lib/ai/providers';
import { postprodJobsCompletedTotal } from '@/lib/metrics';

export const dynamic = 'force-dynamic';

interface ReclaimedRow {
  id: string;
  /** Nulla per i lavori dell'evento (resoconto, traduzione dei testi), senza registrazione. */
  recording_id: string | null;
  attempts: number;
}

/** Lo stesso motivo della chiusura al claim (api/internal/postprod-claim). */
const MOTORE_ASSENTE = 'The CPU translation engine is not configured (AI_MT_BASE_URL)';

export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const site = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { aiJobMaxAttempts: true },
  });
  const maxAttempts = site?.aiJobMaxAttempts ?? 5;

  // Step 1 — reclaim expired CLAIMED leases. We don't reset attempts
  // because the worker might have done partial work; the next claim
  // will re-bump it.
  const reclaimed = await prisma.$queryRaw<ReclaimedRow[]>`
    UPDATE postprod_jobs
    SET status = 'PENDING',
        leased_at = NULL,
        leased_by = NULL,
        next_attempt_at = NOW(),
        updated_at = NOW()
    WHERE status IN ('CLAIMED', 'RUNNING')
      AND next_attempt_at <= NOW() - INTERVAL '1 minute'
    RETURNING id, recording_id, attempts
  `;

  // Step 2 — terminal-fail anything that exhausted retries. We
  // intentionally don't touch jobs that are CLAIMED — those have a
  // live worker possibly about to finish. Only PENDING (post-backoff)
  // jobs whose `attempts > maxAttempts` are killed.
  const failed = await prisma.$queryRaw<ReclaimedRow[]>`
    UPDATE postprod_jobs
    SET status = 'FAILED',
        completed_at = NOW(),
        -- Un resoconto fallito non tiene la copia dei suoi numeri.
        payload = CASE WHEN kind = 'REPORT' THEN payload - 'metrics' ELSE payload END,
        last_error = COALESCE(last_error, 'exceeded max attempts'),
        updated_at = NOW()
    WHERE status = 'PENDING'
      AND attempts >= ${maxAttempts}
    RETURNING id, recording_id, attempts
  `;

  // Cascade FAILED → Recording.POSTPROD_PARTIAL for the recordings we
  // just terminal-failed. Done as a separate update because
  // CASE WHEN inside the UPDATE above complicates the syntax.
  if (failed.length > 0) {
    // I lavori dell'evento non hanno registrazione: non cambiano lo stato di nessuna.
    const recordingIds = Array.from(
      new Set(failed.map((r) => r.recording_id).filter((id): id is string => id !== null)),
    );
    await prisma.recording.updateMany({
      where: {
        id: { in: recordingIds },
        status: { in: ['POSTPROD_QUEUED', 'POSTPROD_RUNNING'] },
      },
      data: { status: 'POSTPROD_PARTIAL' },
    });
  }

  // Step 3 — la traduzione dei testi senza motore. Solo i lavori in coda,
  // anche quelli appena ripresi dal passo 1: uno preso ha un worker vivo, che
  // lo chiude da se' o lo rimanda in coda, e al giro dopo si chiude qui.
  let senzaMotore = 0;
  if (!resolveMtProvider()) {
    const chiusi = await prisma.$queryRaw<Array<{ kind: string }>>`
      UPDATE postprod_jobs
      SET status = 'FAILED',
          completed_at = NOW(),
          last_error = ${MOTORE_ASSENTE},
          updated_at = NOW()
      WHERE status = 'PENDING'
        AND kind::text = ANY(${[...MT_JOB_KINDS]}::text[])
      RETURNING kind::text AS kind
    `;
    for (const { kind } of chiusi) postprodJobsCompletedTotal.labels(kind, 'FAILED').inc();
    senzaMotore = chiusi.length;
  }

  // Refresha i gauge della coda — il cron è il "battito" canonico,
  // garantisce che Prometheus veda valori freschi anche se la app non
  // riceve richieste utenti (es. orari di basso traffico). Il refresh
  // è graceful: setta i gauge a 0 quando aiPipelineEnabled è false.
  await refreshPostprodGauges().catch((err) => {
    console.warn('[postprod-reclaim] refreshPostprodGauges failed', err);
  });

  return Response.json({
    ok: true,
    reclaimed: reclaimed.length,
    failed: failed.length,
    failedNoMtEngine: senzaMotore,
  });
});
