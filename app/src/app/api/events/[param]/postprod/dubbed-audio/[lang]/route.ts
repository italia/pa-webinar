/**
 * GET /api/events/[param]/postprod/dubbed-audio/[lang]
 *
 * Pubblico (recording-published only). Redirige a un signed URL del
 * blob DUBBED_AUDIO per la lingua richiesta. Browser usa il <audio>
 * element del VideoPlayer per riprodurlo in sincrono col video.
 *
 * 302 redirect — semplice e CDN-friendly. Il blob è binario (m4a AAC)
 * e non lo proxiamo per non trasformare l'app in un transcoder.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import {
  isPostprodStorageConfigured,
  presignArtifactDownload,
} from '@/lib/storage/postprod';
import { assertPostprodAccessible } from '@/lib/ai/access';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (_request, context) => {
  const { param: slug, lang } = (await (
    context as { params: Promise<{ param: string; lang: string }> }
  ).params);

  const { eventId } = await assertPostprodAccessible(slug);

  const artifact = await prisma.postprodArtifact.findFirst({
    where: {
      type: 'DUBBED_AUDIO',
      language: lang.toLowerCase(),
      recording: { eventId },
    },
    orderBy: { createdAt: 'desc' },
    select: { blobKey: true },
  });
  if (!artifact) throw new NotFoundError('Dubbed audio');

  if (!isPostprodStorageConfigured()) throw new NotFoundError('Storage');

  const url = await presignArtifactDownload({
    blobKey: artifact.blobKey,
    expiresInMinutes: 60,
  });
  return Response.redirect(url, 302);
});
