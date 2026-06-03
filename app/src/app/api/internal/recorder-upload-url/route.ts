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
import { NotFoundError, ValidationError } from '@/lib/errors';
import { presignArtifactUpload } from '@/lib/storage/postprod';
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
    select: { id: true, eventId: true },
  });
  if (!recording) throw new NotFoundError('Recording');

  const prefix = `${MULTITRACK_PREFIX}${recording.eventId}/${recordingId}/`;
  if (!blobKey.startsWith(prefix)) {
    throw new ValidationError(
      `blobKey "${blobKey}" fuori dal prefisso atteso "${prefix}"`,
    );
  }

  const { uploadUrl } = await presignArtifactUpload({ blobKey, contentType });
  return Response.json({ uploadUrl });
});
