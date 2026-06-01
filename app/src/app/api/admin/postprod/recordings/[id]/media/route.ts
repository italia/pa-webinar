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
 * NOT require `recordingPublished` — the operator edits transcripts
 * before publishing. Access is gated purely on the admin session.
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError } from '@/lib/errors';
import {
  isPostprodStorageConfigured,
  presignArtifactDownload,
} from '@/lib/storage/postprod';

export const dynamic = 'force-dynamic';

const PLAYBACK_SAS_EXPIRY_MINUTES = 120;

export const GET = withErrorHandling(async (_request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await (context as { params: Promise<{ id: string }> }).params;

  const recording = await prisma.recording.findUnique({
    where: { id },
    select: { blobKey: true },
  });
  if (!recording?.blobKey) throw new NotFoundError('Recording media');
  if (!isPostprodStorageConfigured()) throw new NotFoundError('Recording storage');

  const url = await presignArtifactDownload({
    blobKey: recording.blobKey,
    expiresInMinutes: PLAYBACK_SAS_EXPIRY_MINUTES,
  });
  return Response.redirect(url, 302);
});
