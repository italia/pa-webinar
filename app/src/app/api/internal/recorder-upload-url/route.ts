/**
 * POST /api/internal/recorder-upload-url  (ADR-013 Fase 3)
 *
 * Il recorder, a fine evento, presigna l'upload di OGNI traccia just-in-time
 * (i partecipanti non sono noti al claim). Scope minimo: un PUT firmato per
 * singolo blob (riusa `presignArtifactUpload`), path-confinato sotto
 * `recordings/multitrack/{eventId}/{recordingId}/` — un recorder compromesso
 * non può presignare blob arbitrari.
 *
 * Auth: CRON_API_KEY (header x-api-key).
 */

import { z } from 'zod';

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { presignArtifactUpload } from '@/lib/storage/postprod';
import { isConfinedBlobKey } from '@/lib/recorder/blob-key';
import { MULTITRACK_PREFIX } from '@/lib/recorder/lifecycle';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  recordingId: z.string().uuid(),
  blobKey: z.string().min(1).max(1_024),
  contentType: z.string().min(1).max(120).default('audio/ogg'),
});

export const POST = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const { recordingId, blobKey, contentType } = bodySchema.parse(
    await request.json(),
  );

  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    select: { id: true, eventId: true, status: true },
  });
  if (!recording) throw new NotFoundError('Recording');

  // ARCHIVED = la retention è già passata (cron/postprod-retention ha
  // cancellato tracce e artefatti) e NON ripasserà: le sue query di purge
  // escludono `status: ARCHIVED`. Firmare ancora un PUT qui farebbe
  // ricomparire audio per-partecipante che nessuno cancellerebbe mai più.
  if (recording.status === 'ARCHIVED') {
    throw new ConflictError(
      `Recording ${recordingId} è ARCHIVED (retention già eseguita): nessun upload`,
    );
  }

  // Confinamento: non `startsWith` (confronto fra stringhe, non fra path) —
  // vedi isConfinedBlobKey per i casi che lascerebbe passare (`..`, `%2e%2e`,
  // doppie barre). Questa rotta consegna un permesso di SCRITTURA su storage
  // condiviso: la key deve stare dentro la cartella di QUESTA registrazione.
  const prefix = `${MULTITRACK_PREFIX}${recording.eventId}/${recordingId}/`;
  if (!isConfinedBlobKey(blobKey, prefix)) {
    throw new ValidationError(
      `blobKey "${blobKey}" non confinata sotto il prefisso atteso "${prefix}"`,
    );
  }

  const { uploadUrl } = await presignArtifactUpload({ blobKey, contentType });
  return Response.json({ uploadUrl });
});
