/**
 * Orphan recording reconciliation cron.
 *
 * Runs two phases in a single invocation:
 *
 *  1. **Reconcile** — enumerate every blob in the recordings container,
 *     compare against Event.recordingUrl + CallSession.recordingUrl +
 *     CallSession.recordingFilename + the per-participant tracks still
 *     present (and their manifest), and upsert rows in
 *     `orphan_recordings` for blobs that aren't linked anywhere. Each
 *     upsert refreshes `last_seen_at`. Rows whose blob has vanished
 *     from the bucket are removed.
 *
 *  2. **Sweep** — delete blobs for orphan rows whose grace has expired
 *     (`decision = 'pending'` AND `discovered_at < now - graceDays`) or
 *     whose decision is `'delete-now'`. On success, the row is removed
 *     from the table.
 *
 * Operator-facing details:
 *   - The grace period lives in SiteSetting.orphanRecordingGraceDays.
 *     Set it to 0 to disable auto-cleanup (sweep only handles
 *     `decision = 'delete-now'`).
 *   - `decision = 'ignore'` is always preserved: the admin explicitly
 *     opted to keep the blob.
 *
 * Protected by CRON_API_KEY via the standard x-api-key header.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';
import { isEventEligibleForCleanup } from '@/lib/gdpr/cleanup-selection';
import { MULTITRACK_PREFIX, multitrackManifestKey } from '@/lib/recorder/lifecycle';
import {
  isRecordingStorageConfigured,
  listRecordingBlobs,
  deleteRecordingBlobByName,
  recordingBlobNameFromKey,
} from '@/lib/storage/recordings';

export const dynamic = 'force-dynamic';

/** La cartella delle registrazioni multitraccia, nei nomi di `listRecordingBlobs`. */
const MULTITRACK_FOLDER = recordingBlobNameFromKey(MULTITRACK_PREFIX) ?? MULTITRACK_PREFIX;

interface ReconcileResult {
  scanned: number;
  linked: number;
  orphansDiscovered: number;
  orphansStillPresent: number;
  orphansVanished: number;
  sweepDeleted: number;
  sweepFailed: number;
  skipped: boolean;
  reason?: string;
}

function extractBlobNameFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    // URL is /<container>/<blob path>; the blob name is everything after
    // the container segment so nested paths survive.
    return parts.slice(1).join('/');
  } catch {
    return null;
  }
}

export const POST = withErrorHandling(async (request) => {
  assertCronApiKey(request);
  return runReconcile();
});

export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);
  return runReconcile();
});

async function runReconcile() {
  const result: ReconcileResult = {
    scanned: 0,
    linked: 0,
    orphansDiscovered: 0,
    orphansStillPresent: 0,
    orphansVanished: 0,
    sweepDeleted: 0,
    sweepFailed: 0,
    skipped: false,
  };

  if (!isRecordingStorageConfigured()) {
    result.skipped = true;
    result.reason = 'recording storage not configured';
    return Response.json(result);
  }

  const runStartedAt = new Date();

  // Build the "known" set: every blob name the DB knows about.
  // Event.recordingUrl + CallSession.recordingUrl carry absolute URLs,
  // CallSession.recordingFilename carries the bare blob name.
  const [eventLinks, sessionLinks, tracks, deleteNowTracks] = await Promise.all([
    prisma.event.findMany({
      where: { recordingUrl: { not: null } },
      select: { recordingUrl: true },
    }),
    prisma.callSession.findMany({
      where: {
        OR: [
          { recordingUrl: { not: null } },
          { recordingFilename: { not: null } },
        ],
      },
      select: { recordingUrl: true, recordingFilename: true },
    }),
    // Tracce per partecipante con l'audio ancora presente: le cancellano
    // multitrack-purge e postprod-retention, con le regole dell'evento.
    prisma.recordingTrack.findMany({
      where: { audioPurgedAt: null },
      select: {
        blobKey: true,
        recordingId: true,
        recording: {
          select: {
            eventId: true,
            retentionUntil: true,
            // Un lavoro che legge ancora le tracce le tiene conosciute.
            jobs: {
              where: {
                kind: { in: ['TRANSCRIBE_MULTITRACK', 'ARCHIVE'] },
                status: { in: ['PENDING', 'CLAIMED', 'RUNNING'] },
              },
              select: { id: true },
              take: 1,
            },
            event: {
              select: { status: true, endsAt: true, lastActiveAt: true, dataRetentionDays: true },
            },
          },
        },
      },
    }),
    // "Elimina subito" chiesto dall'amministrazione su una traccia vale anche
    // se la traccia e' conosciuta.
    prisma.orphanRecording.findMany({
      where: { decision: 'delete-now', blobName: { startsWith: MULTITRACK_FOLDER } },
      select: { blobName: true },
    }),
  ]);

  const knownBlobNames = new Set<string>();
  for (const row of eventLinks) {
    if (row.recordingUrl) {
      const name = extractBlobNameFromUrl(row.recordingUrl);
      if (name) knownBlobNames.add(name);
    }
  }
  for (const row of sessionLinks) {
    if (row.recordingUrl) {
      const name = extractBlobNameFromUrl(row.recordingUrl);
      if (name) knownBlobNames.add(name);
    }
    if (row.recordingFilename) knownBlobNames.add(row.recordingFilename);
  }

  // Una traccia, e il manifesto della sua registrazione, sono conosciuti
  // finche' qualcosa li tiene: i dati dell'evento in conservazione, la
  // conservazione propria della registrazione, un lavoro che li legge. Oltre,
  // una traccia ancora presente e' sfuggita ai lavori che la cancellano (la
  // conservazione AI spenta, per esempio): diventa orfana, e la tolleranza la
  // cancella.
  const deleteNow = new Set(deleteNowTracks.map((r) => r.blobName));
  for (const track of tracks) {
    const { retentionUntil, jobs, event } = track.recording;
    const sfuggita =
      isEventEligibleForCleanup(event, runStartedAt) &&
      (retentionUntil === null || retentionUntil <= runStartedAt) &&
      jobs.length === 0;
    if (sfuggita) continue;
    const name = recordingBlobNameFromKey(track.blobKey);
    if (name && !deleteNow.has(name)) knownBlobNames.add(name);
    const manifest = recordingBlobNameFromKey(
      multitrackManifestKey(track.recording.eventId, track.recordingId),
    );
    if (manifest) knownBlobNames.add(manifest);
  }

  const blobs = await listRecordingBlobs();
  result.scanned = blobs.length;

  const presentOrphanNames = new Set<string>();
  for (const blob of blobs) {
    if (knownBlobNames.has(blob.name)) {
      result.linked += 1;
      continue;
    }
    presentOrphanNames.add(blob.name);

    const upsert = await prisma.orphanRecording.upsert({
      where: { blobName: blob.name },
      create: {
        blobName: blob.name,
        sizeBytes: blob.sizeBytes !== null ? BigInt(blob.sizeBytes) : null,
        lastModified: blob.lastModified,
        lastSeenAt: runStartedAt,
      },
      update: {
        sizeBytes: blob.sizeBytes !== null ? BigInt(blob.sizeBytes) : null,
        lastModified: blob.lastModified,
        lastSeenAt: runStartedAt,
      },
    });
    // discoveredAt was set on first insert only (DB default); Prisma
    // returns the row so we can tell new from existing by comparing
    // discoveredAt ≥ runStartedAt.
    if (upsert.discoveredAt.getTime() >= runStartedAt.getTime() - 1000) {
      result.orphansDiscovered += 1;
    } else {
      result.orphansStillPresent += 1;
    }
  }

  // Any orphan row whose blob no longer exists in the bucket is
  // tombstoned from the table — the cleanup already happened out of
  // band (manual az storage blob delete, another operator, etc.).
  const vanished = await prisma.orphanRecording.deleteMany({
    where: {
      blobName: { notIn: Array.from(presentOrphanNames) },
    },
  });
  // Skip the deleteMany entirely when presentOrphanNames is empty and
  // there were no blobs scanned at all — we'd otherwise wipe every row.
  if (blobs.length > 0 || presentOrphanNames.size > 0) {
    result.orphansVanished = vanished.count;
  }

  // ── Sweep ─────────────────────────────────────────────────────────
  const settings = await prisma.siteSetting.findFirst({
    select: { orphanRecordingGraceDays: true },
  });
  const graceDays = settings?.orphanRecordingGraceDays ?? 30;

  const sweepWhere: {
    OR: Array<{
      decision: string;
      discoveredAt?: { lt: Date };
    }>;
  } = {
    OR: [{ decision: 'delete-now' }],
  };
  if (graceDays > 0) {
    const cutoff = new Date(Date.now() - graceDays * 86400_000);
    sweepWhere.OR.push({
      decision: 'pending',
      discoveredAt: { lt: cutoff },
    });
  }

  const toSweep = await prisma.orphanRecording.findMany({
    where: sweepWhere,
    select: { id: true, blobName: true },
    take: 200,
  });

  for (const row of toSweep) {
    try {
      const deleted = await deleteRecordingBlobByName(row.blobName);
      if (deleted) {
        await prisma.orphanRecording.delete({ where: { id: row.id } });
        result.sweepDeleted += 1;
      } else {
        // Blob was already gone; drop the row anyway.
        await prisma.orphanRecording.delete({ where: { id: row.id } });
        result.sweepDeleted += 1;
      }
      // Una traccia tolta qui risulta cancellata come quelle dei lavori di
      // cancellazione: la riga resta senza audio, e la pulizia la toglie.
      if (row.blobName.startsWith(MULTITRACK_FOLDER)) {
        await prisma.recordingTrack.updateMany({
          where: {
            blobKey: MULTITRACK_PREFIX + row.blobName.slice(MULTITRACK_FOLDER.length),
            audioPurgedAt: null,
          },
          data: { audioPurgedAt: new Date() },
        });
      }
    } catch (e) {
      console.error('[recordings-reconcile] failed to delete', row.blobName, e);
      result.sweepFailed += 1;
    }
  }

  return Response.json(result);
}
