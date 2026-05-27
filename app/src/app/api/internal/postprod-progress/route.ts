/**
 * POST /api/internal/postprod-progress
 *
 * Worker → app: push intermediate status. The body shape is
 * `progressPayloadSchema` from `lib/ai/schemas`.
 *
 * Side effects:
 *   - status=RUNNING: bumps `started_at` (first transition) and
 *     refreshes the lease so a long-running job isn't reclaimed.
 *   - status=FAILED: stores `last_error`, computes the next backoff,
 *     and either re-enqueues (attempts < max) or transitions to FAILED
 *     terminally. Mirrors EmailOutbox `nextAttemptDelayMs`.
 *   - status=DONE: marked here for convenience but the artifact
 *     register endpoint is the authoritative signal of completion;
 *     workers typically post DONE only after all artifacts are
 *     registered.
 *
 * Auth: CRON_API_KEY.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { progressPayloadSchema } from '@/lib/ai/schemas';
import {
  postprodJobDurationSeconds,
  postprodJobsCompletedTotal,
} from '@/lib/metrics';

export const dynamic = 'force-dynamic';

/**
 * Exponential backoff with cap. Mirrors lib/email/outbox.ts so the
 * behaviour is consistent across all queues in the project.
 *   attempt 1 → 30s
 *   attempt 2 → 2m
 *   attempt 3 → 10m
 *   attempt 4 → 30m
 *   attempt 5 → 2h (cap)
 */
function nextAttemptDelayMs(attempt: number): number {
  switch (attempt) {
    case 1:
      return 30_000;
    case 2:
      return 2 * 60_000;
    case 3:
      return 10 * 60_000;
    case 4:
      return 30 * 60_000;
    default:
      return 2 * 60 * 60_000;
  }
}

export const POST = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const body = (await request.json()) as unknown;
  const parsed = progressPayloadSchema.parse(body);

  const job = await prisma.postprodJob.findUnique({
    where: { id: parsed.jobId },
    select: {
      id: true,
      kind: true,
      status: true,
      attempts: true,
      startedAt: true,
      recordingId: true,
    },
  });
  if (!job) throw new NotFoundError('PostprodJob');

  if (parsed.status === 'RUNNING') {
    await prisma.postprodJob.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING',
        startedAt: job.startedAt ?? new Date(),
        // Refresh lease so we don't reclaim during a long stage.
        nextAttemptAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    return Response.json({ ok: true, status: 'RUNNING' });
  }

  if (parsed.status === 'FAILED') {
    // Fetch the cap from SiteSetting (default 5) so an operator can
    // tune retries without a code change.
    const site = await prisma.siteSetting.findUnique({
      where: { id: 'singleton' },
      select: { aiJobMaxAttempts: true },
    });
    const maxAttempts = site?.aiJobMaxAttempts ?? 5;
    const terminal = job.attempts >= maxAttempts;

    await prisma.postprodJob.update({
      where: { id: job.id },
      data: {
        status: terminal ? 'FAILED' : 'PENDING',
        lastError: parsed.error ?? parsed.message ?? null,
        leasedAt: null,
        leasedBy: null,
        nextAttemptAt: terminal
          ? new Date()
          : new Date(Date.now() + nextAttemptDelayMs(job.attempts)),
        completedAt: terminal ? new Date() : null,
      },
    });

    if (terminal) {
      // Propagate to recording status: if any job for this recording
      // is FAILED, the recording is marked PARTIAL (some artifacts
      // may still be ok) or FAILED (no artifacts produced). We pick
      // PARTIAL conservatively here; the orchestrator's reconcile
      // tick re-aggregates.
      await prisma.recording.update({
        where: { id: job.recordingId },
        data: { status: 'POSTPROD_PARTIAL' },
      });
      postprodJobsCompletedTotal.labels(job.kind, 'FAILED').inc();
      if (job.startedAt) {
        const secs = (Date.now() - job.startedAt.getTime()) / 1000;
        if (secs > 0) postprodJobDurationSeconds.labels(job.kind).observe(secs);
      }
    }

    return Response.json({ ok: true, status: terminal ? 'FAILED' : 'PENDING' });
  }

  // DONE — see route comment: workers typically signal DONE via the
  // artifact-register endpoint. We still allow the explicit ping so
  // the worker can release its lease early when there's nothing to
  // register (degenerate edge case).
  await prisma.postprodJob.update({
    where: { id: job.id },
    data: {
      status: 'DONE',
      completedAt: new Date(),
      lastError: null,
    },
  });
  return Response.json({ ok: true, status: 'DONE' });
});
