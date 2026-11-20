// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * GET /api/admin/postprod/recordings/[id]/media
 *
 * Admin-only playback source for the transcript editor. 302-redirects
 * to a short-lived signed URL of the recording's source MP4 (the same
 * `Recording.blobKey` the worker transcribes), so the editor's audio
 * element can seek against the exact timeline the transcript timestamps
 * refer to.
 *
 * Unlike the public `/api/events/[param]/recording` endpoint this does
 * NOT require `recordingPublished` — the organizer edits transcripts
 * before publishing. Access: the event organizers only, never an admin who
 * does not organize the event (lib/recording/content-access); every read
 * is written to the event's GDPR audit log.
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { requireRecordingContent, tracciaLetturaContenuto } from '@/lib/recording/content-access';
import { registrazioneConVideo } from '@/lib/captions/transcript';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import {
  isPostprodStorageConfigured,
  presignArtifactDownload,
} from '@/lib/storage/postprod';

export const dynamic = 'force-dynamic';

const PLAYBACK_SAS_EXPIRY_MINUTES = 120;

export const GET = withErrorHandling(async (_request, context) => {
  const { id } = await (context as { params: Promise<{ id: string }> }).params;
  // Il contenuto e' di chi organizza l'evento, non dell'admin che non lo
  // organizza (lib/recording/content-access); la lettura si traccia.
  const accesso = await requireRecordingContent(await cookies(), id, 'video');
  await tracciaLetturaContenuto({ ...accesso, recordingId: id, superficie: 'video' });

  const recording = await prisma.recording.findUnique({
    where: { id },
    select: { blobKey: true },
  });
  // Il segnaposto multitraccia è un prefisso, non un file: firmato darebbe un
  // errore dello storage invece del 404.
  if (!recording || !registrazioneConVideo(recording)) throw new NotFoundError('Recording media');
  if (!isPostprodStorageConfigured()) throw new NotFoundError('Recording storage');

  const url = await presignArtifactDownload({
    blobKey: recording.blobKey,
    expiresInMinutes: PLAYBACK_SAS_EXPIRY_MINUTES,
  });
  return Response.redirect(url, 302);
});
