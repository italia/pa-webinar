import { cookies } from 'next/headers';

import {
  computeOverallReliability,
  computeStageReliability,
  computeTranscriptReliability,
  type ReliabilityTranscript,
  type StageStatus,
} from '@/lib/ai/reliability';
import { parseInlineTranscriptJson } from '@/lib/ai/transcript-format';
import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError } from '@/lib/errors';
import { presignArtifactDownload } from '@/lib/storage/postprod';

export const dynamic = 'force-dynamic';

type TranscriptState = 'analyzed' | 'notProduced' | 'unavailable';

/**
 * Resolve the TRANSCRIPT_JSON for reliability analysis. Small transcripts are
 * mirrored inline (encrypted); larger ones live only in blob storage, so we
 * best-effort fetch them via a presigned URL. Distinguishes "no transcript
 * yet" from "transcript exists but we couldn't read it" so neither is
 * mistaken for the silent-audio failure (a genuinely empty transcript).
 */
async function resolveTranscript(
  artifact: { inlineBody: string | null; blobKey: string | null } | undefined,
): Promise<{ json: ReliabilityTranscript | null; state: TranscriptState }> {
  if (!artifact) return { json: null, state: 'notProduced' };

  if (artifact.inlineBody) {
    const json = parseInlineTranscriptJson<ReliabilityTranscript>(artifact.inlineBody);
    return json ? { json, state: 'analyzed' } : { json: null, state: 'unavailable' };
  }

  if (artifact.blobKey) {
    try {
      const url = await presignArtifactDownload({ blobKey: artifact.blobKey });
      const res = await fetch(url);
      if (res.ok) {
        const json = (await res.json()) as ReliabilityTranscript;
        return { json, state: 'analyzed' };
      }
    } catch {
      // fall through to unavailable
    }
    return { json: null, state: 'unavailable' };
  }

  return { json: null, state: 'unavailable' };
}

export const GET = withErrorHandling(async (_request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await (context as { params: Promise<{ id: string }> }).params;

  // The two reads share no data dependency (both keyed only by id) — run them
  // concurrently so the panel doesn't pay two serial round-trips.
  const [recording, jobs] = await Promise.all([
    prisma.recording.findUnique({
      where: { id },
      select: {
        id: true,
        durationSec: true,
        sourceLanguage: true,
        artifacts: {
          where: { type: 'TRANSCRIPT_JSON' },
          select: { inlineBody: true, blobKey: true },
        },
      },
    }),
    prisma.postprodJob.findMany({
      where: { recordingId: id },
      select: {
        kind: true,
        status: true,
        startedAt: true,
        completedAt: true,
        attempts: true,
        lastError: true,
        artifacts: {
          select: {
            type: true,
            language: true,
            modelId: true,
            modelVersion: true,
            sizeBytes: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  if (!recording) throw new NotFoundError('Recording');

  const { json: transcriptJson, state: transcriptState } = await resolveTranscript(
    recording.artifacts[0],
  );
  const analyzed = transcriptState === 'analyzed';
  const transcript = computeTranscriptReliability(analyzed ? transcriptJson : null);

  const stages = jobs.map((j) =>
    computeStageReliability({
      kind: j.kind,
      status: j.status as StageStatus,
      startedAt: j.startedAt ? j.startedAt.toISOString() : null,
      completedAt: j.completedAt ? j.completedAt.toISOString() : null,
      attempts: j.attempts,
      lastError: j.lastError,
      artifacts: j.artifacts.map((a) => ({
        type: a.type,
        language: a.language,
        modelId: a.modelId,
        modelVersion: a.modelVersion,
        sizeBytes: a.sizeBytes != null ? Number(a.sizeBytes) : null,
      })),
    }),
  );

  const overall = computeOverallReliability(stages, transcript, {
    transcriptAnalyzed: analyzed,
  });

  return Response.json({
    recordingId: recording.id,
    durationSec: recording.durationSec ?? null,
    sourceLanguage: recording.sourceLanguage ?? transcriptJson?.language ?? 'it',
    transcriptState,
    transcript: analyzed ? transcript : null,
    stages,
    overall,
    hasData: stages.length > 0 || analyzed,
  });
});
