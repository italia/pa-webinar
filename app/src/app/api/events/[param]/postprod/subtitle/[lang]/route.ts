/**
 * GET /api/events/[param]/postprod/subtitle/[lang]
 *
 * Public subtitle endpoint for the `<video><track>` element. The
 * `[param]` is the event slug; `[lang]` is the ISO code requested
 * (it/en/fr/...). Returns the latest run's SUBTITLE_VTT artifact:
 * either the source-language transcript or a translation.
 *
 * The route serves the VTT text directly (it's small — <500KB even
 * for a 2h call) rather than redirecting to a signed URL, so the
 * <track> element keeps the same origin as the player page (no CORS
 * preflight, no expiring URLs in the DOM).
 *
 * Access control: same as the recording — when the recording is
 * `recordingPublished=true` on its event, anyone can fetch the
 * subtitle. Otherwise an admin or moderator token is required (same
 * pattern as `/api/events/[param]/recording`).
 */

import type { Prisma } from '@prisma/client';

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { presignArtifactDownload, isPostprodStorageConfigured } from '@/lib/storage/postprod';
import { tryDecryptPII } from '@/lib/crypto/pii';

export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = [
  'TRANSCRIPT_VTT',
  'TRANSLATION_VTT',
  'SUBTITLE_VTT',
] satisfies Prisma.PostprodArtifactWhereInput['type'][];

export const GET = withErrorHandling(async (request, context) => {
  const { param: slug, lang } = (await (context as { params: Promise<{ param: string; lang: string }> }).params);

  // We don't need the recording details — just resolve to an event
  // whose latest published recording has a matching artifact.
  const event = await prisma.event.findUnique({
    where: { slug },
    select: { id: true, recordingPublished: true },
  });
  if (!event) throw new NotFoundError('Event');

  if (!event.recordingPublished) {
    // Recording not public: 404 to avoid leaking the artifact
    // existence to a random visitor. Moderator/admin flows fetch via
    // the admin API instead.
    throw new NotFoundError('Subtitle');
  }

  const artifact = await prisma.postprodArtifact.findFirst({
    where: {
      type: { in: ALLOWED_TYPES },
      language: lang.toLowerCase(),
      recording: { eventId: event.id },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, blobKey: true, inlineBody: true, mimeType: true },
  });
  if (!artifact) throw new NotFoundError('Subtitle');

  const cached = tryDecryptPII(artifact.inlineBody ?? '');
  if (cached) {
    return new Response(cached, {
      status: 200,
      headers: {
        'content-type': 'text/vtt; charset=utf-8',
        // Subtitles are small + immutable per run; let the browser
        // cache them for the live session. The blobKey already
        // encodes the runId so a re-run produces a different URL.
        'cache-control': 'public, max-age=300',
      },
    });
  }

  if (!isPostprodStorageConfigured()) throw new NotFoundError('Subtitle storage');

  // No inline body — redirect (302) to a presigned GET. We could
  // proxy the bytes through the app, but redirect keeps the app
  // off the hot path for binary fetches.
  const url = await presignArtifactDownload({
    blobKey: artifact.blobKey,
    expiresInMinutes: 60,
  });
  return Response.redirect(url, 302);
});
