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
  getPostprodStorage,
  isPostprodStorageConfigured,
} from '@/lib/storage/postprod';

export const dynamic = 'force-dynamic';

/**
 * Purge a recording's per-participant audio tracks: blobKey points at
 * isolated-voice audio (quasi-biometric) and displayName is encrypted PII.
 * For RETAINED (retainParticipantTracks=true) recordings, cron/multitrack-purge
 * never fires — it waits on a retentionUntil that no app code ever sets — so
 * the raw audio would otherwise outlive retention. Deletes any surviving track
 * blobs, then the rows (RecordingTrack has no FK dependents). Idempotent.
 *
 * This is deliberately independent of the published/library artifact exemption:
 * subtitles/transcripts are a public video's accessibility layer worth keeping,
 * but the raw per-participant audio is never a public asset and must always be
 * minimized at retention.
 */
async function purgeRecordingTracks(
  recordingId: string
): Promise<{ blobsDeleted: number; blobsFailed: number }> {
  let blobsDeleted = 0;
  let blobsFailed = 0;
  const tracks = await prisma.recordingTrack.findMany({
    where: { recordingId },
    select: { blobKey: true, audioPurgedAt: true },
  });
  const storage = getPostprodStorage();
  for (const tr of tracks) {
    if (tr.audioPurgedAt) continue; // blob already gone
    try {
      await storage.delete(tr.blobKey);
      blobsDeleted += 1;
    } catch (err) {
      blobsFailed += 1;
      console.warn('[postprod-retention] track blob delete failed', {
        key: tr.blobKey,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  await prisma.recordingTrack.deleteMany({ where: { recordingId } });
  return { blobsDeleted, blobsFailed };
}

/**
 * Purge every postprod artifact of a recording: delete the blobs, delete the
 * artifact rows, delete Speaker rows (full PII), purge the raw tracks, scrub
 * PostprodJob payloads, then archive the recording. Shared by the override and
 * the (non-published) event-bound regimes so the two never drift.
 */
async function purgeRecordingArtifacts(
  recordingId: string
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

  const tp = await purgeRecordingTracks(recordingId);
  blobsDeleted += tp.blobsDeleted;
  blobsFailed += tp.blobsFailed;

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

/**
 * True if the recording has a postprod job that still needs its raw inputs
 * (tracks/artifacts). Mirrors cron/multitrack-purge's guard: a re-run of the
 * multitrack transcription or a pending/running ARCHIVE reads the tracks, so
 * purging mid-job would yield an empty transcript or a degraded archive. We
 * defer the whole purge one tick when such a job is in flight.
 */
async function hasActivePostprodJob(recordingId: string): Promise<boolean> {
  const job = await prisma.postprodJob.findFirst({
    where: {
      recordingId,
      kind: { in: ['TRANSCRIBE_MULTITRACK', 'ARCHIVE'] },
      status: { in: ['PENDING', 'CLAIMED', 'RUNNING'] },
    },
    select: { id: true },
  });
  return job !== null;
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

  let deferredActiveJob = 0;
  for (const rec of expired) {
    if (await hasActivePostprodJob(rec.id)) {
      deferredActiveJob += 1;
      continue;
    }
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
      // EXEMPT the PUBLISHED video: a published recording is a kept public
      // record, and its AI artifacts (subtitles, multilingual dubbing,
      // transcript) are its accessibility layer — they must live as long as the
      // video, not be purged at the event's default 30-day retention (their
      // lifetime is governed by recordingDeleteAfterDays / an explicit
      // Recording.retentionUntil override). `recordingPublished` is the single
      // "kept public video" signal (same as cleanup Phase 3); a
      // library-listed-but-unpublished recording is invisible, so it correctly
      // falls through here and gets fully purged. Pass 3 below still minimizes
      // the raw tracks of the exempted (published) recordings.
      event: {
        status: { in: ['ENDED', 'ARCHIVED'] },
        recordingPublished: false,
      },
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
    if (await hasActivePostprodJob(rec.id)) {
      deferredActiveJob += 1;
      continue;
    }
    const r = await purgeRecordingArtifacts(rec.id);
    blobsDeleted += r.blobsDeleted;
    blobsFailed += r.blobsFailed;
    artifactsDeleted += r.artifactsDeleted;
    eventBoundRecordings += 1;
  }

  // Published recordings are exempt from the artifact purge above (their
  // subtitles/transcript are the video's accessibility layer). But their RAW
  // per-participant track audio is never a public asset and still must be
  // minimized at retention — otherwise a published event with
  // retainParticipantTracks=true keeps quasi-biometric audio forever (the
  // artifact exemption would otherwise skip the whole recording). Purge ONLY the
  // tracks here, leaving artifacts + status intact. Keyed on recordingPublished
  // (same signal as the exemption); library-listed-but-unpublished recordings
  // are handled by pass 2. `tracks: { some: {} }` makes this self-terminating:
  // once the rows are deleted the recording stops matching.
  let publishedTracksPurged = 0;
  const publishedWithTracks = await prisma.recording.findMany({
    where: {
      retentionUntil: null,
      tracks: { some: {} },
      event: {
        status: { in: ['ENDED', 'ARCHIVED'] },
        recordingPublished: true,
      },
    },
    select: {
      id: true,
      event: { select: { endsAt: true, dataRetentionDays: true } },
    },
    take: 50,
  });
  for (const rec of publishedWithTracks) {
    if (!rec.event) continue;
    const expiry = rec.event.endsAt.getTime() + rec.event.dataRetentionDays * 86_400_000;
    if (expiry >= now.getTime()) continue;
    // Same active-job guard as the artifact passes: an in-flight ARCHIVE /
    // multitrack re-run still reads these tracks — defer a tick.
    if (await hasActivePostprodJob(rec.id)) {
      deferredActiveJob += 1;
      continue;
    }
    const tp = await purgeRecordingTracks(rec.id);
    blobsDeleted += tp.blobsDeleted;
    blobsFailed += tp.blobsFailed;
    publishedTracksPurged += 1;
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
    publishedTracksPurged,
    deferredActiveJob,
    blobsDeleted,
    blobsFailed,
    artifactsDeleted,
    globalBlobsDeleted,
    globalArtifactsDeleted,
  });
});
