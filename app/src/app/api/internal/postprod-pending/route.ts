/**
 * GET /api/internal/postprod-pending
 *
 * Orchestrator → app: returns how many worker Jobs the cron should
 * keep running on the GPU pool. Output:
 *
 *   {
 *     "pipelineEnabled": true,
 *     "runnable": 4,        // jobs ready to be claimed right now
 *     "claimed": 1,         // jobs already leased by a worker
 *     "running": 0,         // jobs reported RUNNING (subset of CLAIMED)
 *     "maxConcurrent": 2,   // SiteSetting.aiMaxConcurrentJobs
 *     "desired": 2,         // min(runnable + claimed, maxConcurrent)
 *   }
 *
 * The orchestrator's policy is: if `desired > currently-running k8s
 * Jobs`, create more; if less, wait (jobs are one-shot, no scale-down
 * needed).
 *
 * Auth: CRON_API_KEY.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface CountRow {
  runnable: bigint;
  claimed: bigint;
  running: bigint;
}

export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const site = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: {
      aiPipelineEnabled: true,
      aiMaxConcurrentJobs: true,
    },
  });
  const pipelineEnabled = site?.aiPipelineEnabled ?? false;
  const maxConcurrent = site?.aiMaxConcurrentJobs ?? 2;

  if (!pipelineEnabled) {
    return Response.json({
      pipelineEnabled: false,
      runnable: 0,
      claimed: 0,
      running: 0,
      maxConcurrent,
      desired: 0,
    });
  }

  // One query for all three counts — cheap (indexed by status). The
  // "runnable" set checks dependency-DONE in the same way the claim
  // endpoint does so the orchestrator and the claim see the same view.
  const rows = await prisma.$queryRaw<CountRow[]>`
    SELECT
      COUNT(*) FILTER (
        WHERE j.status = 'PENDING'
          AND j.next_attempt_at <= NOW()
          AND (j.depends_on_id IS NULL
               OR EXISTS (SELECT 1 FROM postprod_jobs dep
                          WHERE dep.id = j.depends_on_id AND dep.status = 'DONE'))
      ) AS runnable,
      COUNT(*) FILTER (WHERE j.status = 'CLAIMED') AS claimed,
      COUNT(*) FILTER (WHERE j.status = 'RUNNING') AS running
    FROM postprod_jobs j
  `;

  const row = rows[0] ?? { runnable: 0n, claimed: 0n, running: 0n };
  const runnable = Number(row.runnable);
  const claimed = Number(row.claimed);
  const running = Number(row.running);

  // The orchestrator subtracts currently-running k8s Jobs from
  // `desired` to decide how many new ones to spawn. We cap at
  // maxConcurrent here so the cluster doesn't get flooded.
  const desired = Math.min(runnable + claimed, maxConcurrent);

  return Response.json({
    pipelineEnabled: true,
    runnable,
    claimed,
    running,
    maxConcurrent,
    desired,
  });
});
