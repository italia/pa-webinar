/**
 * GET /api/cron/postprod-retention
 *
 * Daily cleanup of postprod artifacts whose retention has expired.
 * Two retention regimes coexist:
 *
 *   1. **Event-bound** (default): `Recording.retentionUntil` is null
 *      → the artifact follows the parent event's retention. Since
 *      `/api/cron/cleanup` only ARCHIVES the event (it never hard-
 *      deletes the row), we purge here once the event is past
 *      `endsAt + dataRetentionDays` — otherwise transcripts/summaries
 *      (which can carry names) would survive forever.
 *
 *   2. **Override** (`Recording.retentionUntil != null` OR
 *      `SiteSetting.aiArtifactRetentionDays > 0`): artifacts past
 *      their override expiry are purged independently of the event
 *      retention. Useful for "verbale come atto pubblico" cases
 *      that should outlive the chat/Q&A.
 *
 * Protected by CRON_API_KEY.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';
import {
  deletePostprodBlob,
  isPostprodStorageConfigured,
} from '@/lib/storage/postprod';

export const dynamic = 'force-dynamic';

/**
 * Purge every postprod artifact of a recording: delete the blobs, delete the
 * artifact rows, delete Speaker rows (full PII), scrub PostprodJob payloads,
 * then archive the recording. Shared by the override and the event-bound
 * regimes so the two never drift.
 */
async function purgeRecordingArtifacts(
  recordingId: string,
): Promise<{ blobsDeleted: number; blobsFailed: number; artifactsDeleted: number }> {
  let blobsDeleted = 0;
  let blobsFailed = 0;
  const artifacts = await prisma.postprodArtifact.findMany({
    where: { recordingId },
    select: { id: true, blobKey: true },
  });
  for (const a of artifacts) {
    try {
      await deletePostprodBlob(a.blobKey);
      blobsDeleted += 1;
    } catch (err) {
      blobsFailed += 1;
      console.warn('[postprod-retention] blob delete failed', {
        key: a.blobKey,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const del = await prisma.postprodArtifact.deleteMany({ where: { recordingId } });
  await prisma.speaker.deleteMany({ where: { recordingId } });
  await prisma.postprodJob.updateMany({
    where: { recordingId },
    data: { payload: { scrubbed: true }, lastError: null },
  });
  await prisma.recording.update({
    where: { id: recordingId },
    data: { status: 'ARCHIVED' },
  });
  return { blobsDeleted, blobsFailed, artifactsDeleted: del.count };
}

export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  if (!isPostprodStorageConfigured()) {
    return Response.json({ ok: true, skipped: true, reason: 'storage not configured' });
  }

  const now = new Date();

  // Per-recording override expiry takes precedence.
  const expired = await prisma.recording.findMany({
    where: {
      retentionUntil: { not: null, lt: now },
      status: { not: 'ARCHIVED' },
    },
    select: { id: true, eventId: true },
    take: 50, // bound the per-tick work
  });

  let blobsDeleted = 0;
  let blobsFailed = 0;
  let artifactsDeleted = 0;

  for (const rec of expired) {
    const r = await purgeRecordingArtifacts(rec.id);
    blobsDeleted += r.blobsDeleted;
    blobsFailed += r.blobsFailed;
    artifactsDeleted += r.artifactsDeleted;
  }

  // Event-bound default (retentionUntil == null): follow the parent event's
  // retention. `/api/cron/cleanup` only ARCHIVES the event (never hard-deletes),
  // so WITHOUT this branch these artifacts — transcripts/summaries that can
  // carry names — would live forever. Purge once the event is past
  // endsAt + dataRetentionDays. Prisma can't do that date arithmetic in a
  // `where`, so filter in JS (same pattern as cron/cleanup Phase 3).
  let eventBoundRecordings = 0;
  const eventBoundCandidates = await prisma.recording.findMany({
    where: {
      retentionUntil: null,
      status: { not: 'ARCHIVED' },
      event: { status: { in: ['ENDED', 'ARCHIVED'] } },
    },
    select: {
      id: true,
      event: { select: { endsAt: true, dataRetentionDays: true } },
    },
    take: 50,
  });
  for (const rec of eventBoundCandidates) {
    if (!rec.event) continue;
    const expiry = rec.event.endsAt.getTime() + rec.event.dataRetentionDays * 86_400_000;
    if (expiry >= now.getTime()) continue;
    const r = await purgeRecordingArtifacts(rec.id);
    blobsDeleted += r.blobsDeleted;
    blobsFailed += r.blobsFailed;
    artifactsDeleted += r.artifactsDeleted;
    eventBoundRecordings += 1;
  }

  // Also walk the global aiArtifactRetentionDays override (a single
  // site-wide N-days from artifact creation). 0 = disabled.
  const site = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { aiArtifactRetentionDays: true },
  });
  const days = site?.aiArtifactRetentionDays ?? 0;
  let globalBlobsDeleted = 0;
  let globalArtifactsDeleted = 0;
  if (days > 0) {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const old = await prisma.postprodArtifact.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true, blobKey: true },
      take: 200,
    });
    for (const a of old) {
      try {
        await deletePostprodBlob(a.blobKey);
        globalBlobsDeleted += 1;
      } catch (err) {
        console.warn('[postprod-retention] global delete failed', {
          key: a.blobKey,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const del = await prisma.postprodArtifact.deleteMany({
      where: { id: { in: old.map((a) => a.id) } },
    });
    globalArtifactsDeleted = del.count;
  }

  return Response.json({
    ok: true,
    expiredRecordings: expired.length,
    eventBoundRecordings,
    blobsDeleted,
    blobsFailed,
    artifactsDeleted,
    globalBlobsDeleted,
    globalArtifactsDeleted,
  });
});
