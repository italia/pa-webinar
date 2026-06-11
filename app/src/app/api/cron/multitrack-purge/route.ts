/**
 * GET /api/cron/multitrack-purge  (ADR-013, Fase 5 — minimizzazione GDPR)
 *
 * Le tracce audio per-partecipante (`RecordingTrack`) sono un input
 * INTERMEDIO ad alta sensibilità (voce isolata del singolo, vedi
 * docs/GDPR.md): servono solo finché il worker trascrive. Appena la
 * trascrizione multi-traccia è completata, l'audio grezzo va cancellato
 * — il transcript attribuito resta, la traccia no.
 *
 * Questo cron, frequente (es. ogni 15 min), trova le tracce non ancora
 * purgate il cui recording ha un job TRANSCRIBE_MULTITRACK DONE, elimina
 * il blob audio e marca `audioPurgedAt`. Idempotente.
 *
 * Protetto da CRON_API_KEY.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';
import { getPostprodStorage, isPostprodStorageConfigured } from '@/lib/storage/postprod';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  if (!isPostprodStorageConfigured()) {
    return Response.json({ ok: true, skipped: true, reason: 'storage not configured' });
  }

  // Tracce ancora presenti il cui recording ha già completato la
  // trascrizione multi-traccia → audio grezzo non più necessario.
  const tracks = await prisma.recordingTrack.findMany({
    where: {
      audioPurgedAt: null,
      recording: {
        AND: [
          // La trascrizione multi-traccia è completata almeno una volta.
          { jobs: { some: { kind: 'TRANSCRIBE_MULTITRACK', status: 'DONE' } } },
          // NESSUN job ATTIVO che consuma ancora le tracce: una re-run di
          // TRANSCRIBE_MULTITRACK o un ARCHIVE in coda/esecuzione le leggono.
          // Senza questo guard il purge poteva cancellare l'audio DURANTE una
          // re-run (transcript vuoto) o prima dell'archivio (archivio degradato).
          {
            jobs: {
              none: {
                kind: { in: ['TRANSCRIBE_MULTITRACK', 'ARCHIVE'] },
                status: { in: ['PENDING', 'CLAIMED', 'RUNNING'] },
              },
            },
          },
        ],
        OR: [
          // Default (minimizzazione): purge appena trascritto.
          { event: { retainParticipantTracks: false } },
          // Opt-in "conserva": purge solo dopo la scadenza di retention.
          {
            event: { retainParticipantTracks: true },
            retentionUntil: { not: null, lte: new Date() },
          },
        ],
      },
    },
    select: { id: true, blobKey: true },
    take: 500,
  });

  const storage = getPostprodStorage();
  let purged = 0;
  let failed = 0;
  for (const t of tracks) {
    try {
      await storage.delete(t.blobKey);
      await prisma.recordingTrack.update({
        where: { id: t.id },
        data: { audioPurgedAt: new Date() },
      });
      purged += 1;
    } catch {
      // best-effort: riproveremo al prossimo tick (audioPurgedAt resta null)
      failed += 1;
    }
  }

  return Response.json({ ok: true, candidates: tracks.length, purged, failed });
});
