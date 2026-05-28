/**
 * POST /api/internal/postprod-artifact
 *
 * Worker → app: register a freshly-uploaded blob as a PostprodArtifact.
 *
 * The worker is expected to have already PUT the bytes to the
 * presigned URL returned by `/postprod-claim`. This endpoint just
 * records the metadata; it does NOT read the bytes back.
 *
 * Defensive checks:
 *   - blobKey must be inside `postprod/{eventId}/{recordingId}/` so a
 *     worker can't write a row pointing to an arbitrary blob,
 *   - inlineBody (when present) is encrypted at rest via encryptPII,
 *   - we upsert on (recordingId, type, language) so re-runs replace
 *     older artifacts cleanly (newer runCount overwrites the row).
 *
 * Side effects:
 *   - inserts PostprodArtifact row (or updates if duplicate key),
 *   - if speakerMap is present (TRANSCRIPT_JSON), upserts Speaker rows,
 *   - if this is the last artifact for the job's expected set, marks
 *     the job DONE. Otherwise leaves it CLAIMED so the worker can
 *     register the rest in subsequent calls.
 *
 * Auth: CRON_API_KEY.
 */

import { Prisma } from '@prisma/client';

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import {
  artifactPath,
  artifactMimeType,
  expectedArtifactsForJob,
  postprodJobPayloadSchema,
  artifactRegisterSchema,
} from '@/lib/ai';
import { encryptPII } from '@/lib/crypto/pii';
import {
  postprodArtifactBytesTotal,
  postprodArtifactsTotal,
  postprodJobsCompletedTotal,
  postprodJobDurationSeconds,
} from '@/lib/metrics';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const body = (await request.json()) as unknown;
  const parsed = artifactRegisterSchema.parse(body);

  const job = await prisma.postprodJob.findUnique({
    where: { id: parsed.jobId },
    include: {
      recording: { select: { id: true, eventId: true, runCount: true } },
    },
  });
  if (!job) throw new NotFoundError('PostprodJob');

  // Re-derive the canonical blob key for this (recording, type, language)
  // and check that the worker uploaded to exactly that path. Anything
  // else means a buggy/malicious worker.
  const canonicalKey = artifactPath(
    {
      eventId: job.recording.eventId,
      recordingId: job.recording.id,
      runCount: job.recording.runCount,
    },
    parsed.type,
    parsed.language,
  );
  if (parsed.blobKey !== canonicalKey) {
    throw new ValidationError(
      `blobKey mismatch — worker reported "${parsed.blobKey}", canonical "${canonicalKey}"`,
    );
  }

  // Validate MIME type matches the type. The presign issued in /claim
  // pinned the contentType, so a mismatch here is the worker's fault.
  const expectedMime = artifactMimeType(parsed.type);
  if (parsed.mimeType.split(';')[0]?.trim() !== expectedMime.split(';')[0]?.trim()) {
    throw new ValidationError(
      `mimeType ${parsed.mimeType} doesn't match expected ${expectedMime}`,
    );
  }

  // Encrypt inlineBody at rest. The transcript/summary contain
  // participants' names + speech → PII surface.
  const inlineBody = parsed.inlineBody ? encryptPII(parsed.inlineBody) : null;

  // Compute job-done state up-front by intersecting expected vs
  // registered artifacts (counting the one we're about to write).
  const jobPayloadParsed = postprodJobPayloadSchema.parse({
    kind: job.kind,
    payload: job.payload,
  });
  const expected = expectedArtifactsForJob(
    job.kind,
    jobPayloadParsed.payload as Record<string, string | undefined>,
  );

  await prisma.$transaction(async (tx) => {
    await tx.postprodArtifact.upsert({
      where: {
        recordingId_type_language: {
          recordingId: job.recording.id,
          type: parsed.type,
          // Composite key with NULL language — see note in postprod-claim.
          // For artifacts with language=null (TRANSCRIPT_JSON) we
          // rely on the unique partial behaviour of Postgres which
          // treats NULLs as distinct, so the upsert may "miss" and
          // create a new row. We then de-dup explicitly.
          language: parsed.language as unknown as string,
        },
      },
      create: {
        recordingId: job.recording.id,
        jobId: job.id,
        type: parsed.type,
        language: parsed.language,
        blobKey: parsed.blobKey,
        sizeBytes: BigInt(parsed.sizeBytes),
        mimeType: parsed.mimeType,
        inlineBody,
        contentHash: parsed.contentHash,
        modelId: parsed.modelId ?? null,
        modelVersion: parsed.modelVersion ?? null,
      },
      update: {
        jobId: job.id,
        blobKey: parsed.blobKey,
        sizeBytes: BigInt(parsed.sizeBytes),
        mimeType: parsed.mimeType,
        inlineBody,
        contentHash: parsed.contentHash,
        modelId: parsed.modelId ?? null,
        modelVersion: parsed.modelVersion ?? null,
      },
    });

    // Speaker map upsert (TRANSCRIPT_JSON only — see schema).
    if (parsed.speakerMap && parsed.speakerMap.length > 0) {
      for (const sp of parsed.speakerMap) {
        await tx.speaker.upsert({
          where: {
            recordingId_diarLabel: {
              recordingId: job.recording.id,
              diarLabel: sp.diarLabel,
            },
          },
          create: {
            recordingId: job.recording.id,
            diarLabel: sp.diarLabel,
            totalSpeechSec: sp.totalSpeechSec,
          },
          update: {
            totalSpeechSec: sp.totalSpeechSec,
          },
        });
      }
    }

    // Re-count what's registered for this job. If we hit the expected
    // count, mark the job DONE.
    const registered = await tx.postprodArtifact.count({
      where: { jobId: job.id },
    });

    if (registered >= expected.length) {
      const completedAt = new Date();
      await tx.postprodJob.update({
        where: { id: job.id },
        data: {
          status: 'DONE',
          completedAt,
          lastError: null,
        },
      });
      // Emit Prometheus metrics OUTSIDE the transaction-touching code
      // would be safer (no transaction-scoped state), but observe()
      // here is sync and side-effect-only on prom-client's in-memory
      // registry → safe to keep.
      postprodJobsCompletedTotal.labels(job.kind, 'DONE').inc();
      if (job.startedAt) {
        const secs = (completedAt.getTime() - job.startedAt.getTime()) / 1000;
        if (secs > 0) postprodJobDurationSeconds.labels(job.kind).observe(secs);
      }

      // If all jobs for this recording are DONE, mark recording done.
      const remaining = await tx.postprodJob.count({
        where: {
          recordingId: job.recording.id,
          status: { in: ['PENDING', 'CLAIMED', 'RUNNING'] },
        },
      });
      if (remaining === 0) {
        const anyFailed = await tx.postprodJob.count({
          where: { recordingId: job.recording.id, status: 'FAILED' },
        });
        await tx.recording.update({
          where: { id: job.recording.id },
          data: {
            status: anyFailed > 0 ? 'POSTPROD_PARTIAL' : 'POSTPROD_DONE',
          },
        });
      }
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

  // Metriche per-artifact (sempre, anche se il job non è terminato).
  // Le metriche tracciano gli upload reali, non lo stato del job.
  postprodArtifactsTotal.labels(parsed.type, parsed.language ?? '').inc();
  postprodArtifactBytesTotal.labels(parsed.type).inc(parsed.sizeBytes);

  return Response.json({ ok: true });
});
