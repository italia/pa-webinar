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
 *     "desiredGpu": 1,      // `desired` diviso fra il worker con la GPU
 *     "desiredCpu": 1,      // e quello senza (lib/ai/job-classes)
 *     "desiredLlm": 1,      // lavori pronti, presi o in esecuzione che
 *                           // usano vLLM (LLM_JOB_KINDS)
 *     "desiredMt": 0,       // lo stesso per il motore di traduzione su CPU
 *                           // (MT_JOB_KINDS)
 *   }
 *
 * `desiredLlm` e `desiredMt` dicono all'orchestratore quale motore tenere
 * acceso: vLLM (la GPU) solo per i lavori che gli chiedono testo, il motore su
 * CPU solo per la traduzione di titolo e descrizione. Contano anche i lavori
 * RUNNING, che `desired` non conta: il motore deve restare acceso finche' il
 * worker lo usa. Un orchestratore che non li legge accende vLLM come prima.
 *
 * The orchestrator's policy is: if `desired > currently-running k8s
 * Jobs`, create more; if less, wait (jobs are one-shot, no scale-down
 * needed).
 *
 * Auth: CRON_API_KEY.
 */

import { Prisma } from '@prisma/client';

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';
import { GPU_WORKER_KINDS, LLM_JOB_KINDS, MT_JOB_KINDS } from '@/lib/ai/job-classes';

export const dynamic = 'force-dynamic';

interface CountRow {
  runnable: bigint;
  claimed: bigint;
  running: bigint;
  gpu_runnable: bigint;
  gpu_claimed: bigint;
  llm_work: bigint;
  mt_work: bigint;
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
      desiredGpu: 0,
      desiredCpu: 0,
      desiredLlm: 0,
      desiredMt: 0,
    });
  }

  // Un lavoro che tiene acceso il suo motore: pronto (come per il claim),
  // preso o in esecuzione.
  const inLavoro = Prisma.sql`(
    j.status IN ('CLAIMED', 'RUNNING')
    OR (j.status = 'PENDING'
        AND j.next_attempt_at <= NOW()
        AND (j.depends_on_id IS NULL
             OR EXISTS (SELECT 1 FROM postprod_jobs dep
                        WHERE dep.id = j.depends_on_id AND dep.status = 'DONE')))
  )`;

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
      COUNT(*) FILTER (WHERE j.status = 'RUNNING') AS running,
      COUNT(*) FILTER (
        WHERE j.kind::text = ANY(${[...GPU_WORKER_KINDS]}::text[])
          AND j.status = 'PENDING'
          AND j.next_attempt_at <= NOW()
          AND (j.depends_on_id IS NULL
               OR EXISTS (SELECT 1 FROM postprod_jobs dep
                          WHERE dep.id = j.depends_on_id AND dep.status = 'DONE'))
      ) AS gpu_runnable,
      COUNT(*) FILTER (
        WHERE j.kind::text = ANY(${[...GPU_WORKER_KINDS]}::text[]) AND j.status = 'CLAIMED'
      ) AS gpu_claimed,
      COUNT(*) FILTER (
        WHERE j.kind::text = ANY(${[...LLM_JOB_KINDS]}::text[]) AND ${inLavoro}
      ) AS llm_work,
      COUNT(*) FILTER (
        WHERE j.kind::text = ANY(${[...MT_JOB_KINDS]}::text[]) AND ${inLavoro}
      ) AS mt_work
    FROM postprod_jobs j
  `;

  const row = rows[0] ?? {
    runnable: 0n,
    claimed: 0n,
    running: 0n,
    gpu_runnable: 0n,
    gpu_claimed: 0n,
    llm_work: 0n,
    mt_work: 0n,
  };
  const runnable = Number(row.runnable);
  const claimed = Number(row.claimed);
  const running = Number(row.running);
  const gpuWork = Number(row.gpu_runnable) + Number(row.gpu_claimed);
  const cpuWork = runnable + claimed - gpuWork;

  // The orchestrator subtracts currently-running k8s Jobs from
  // `desired` to decide how many new ones to spawn. We cap at
  // maxConcurrent here so the cluster doesn't get flooded.
  const desired = Math.min(runnable + claimed, maxConcurrent);
  // `desired` diviso fra i due worker, per l'orchestratore che li distingue:
  // il tetto resta complessivo (i worker senza GPU caricano comunque vLLM) e
  // la trascrizione passa per prima, perche' gli altri job ne dipendono.
  const desiredGpu = Math.min(gpuWork, maxConcurrent);
  const desiredCpu = Math.min(cpuWork, maxConcurrent - desiredGpu);

  return Response.json({
    pipelineEnabled: true,
    runnable,
    claimed,
    running,
    maxConcurrent,
    desired,
    desiredGpu,
    desiredCpu,
    desiredLlm: Number(row.llm_work),
    desiredMt: Number(row.mt_work),
  });
});
