/**
 * GET /api/cron/postprod-retention
 *
 * Daily cleanup of postprod artifacts whose retention has expired.
 * Two retention regimes coexist:
 *
 *   1. **Event-bound** (default): `Recording.retentionUntil` is null
 *      → the artifact is purged when the parent Event is hard-deleted
 *      by the existing `/api/cron/cleanup` job. We just walk dangling
 *      blobs in `postprod/` that no longer have a backing Recording
 *      row (`OrphanRecording`-like reconciliation, applied to
 *      postprod artifacts).
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
    const artifacts = await prisma.postprodArtifact.findMany({
      where: { recordingId: rec.id },
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

    // Cascade: artifact rows then mark recording archived. The job
    // rows are kept (small) for audit; only the bulk artifacts go.
    const del = await prisma.postprodArtifact.deleteMany({
      where: { recordingId: rec.id },
    });
    artifactsDeleted += del.count;

    await prisma.recording.update({
      where: { id: rec.id },
      data: { status: 'ARCHIVED' },
    });
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
    blobsDeleted,
    blobsFailed,
    artifactsDeleted,
    globalBlobsDeleted,
    globalArtifactsDeleted,
  });
});
