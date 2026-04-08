import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError, ForbiddenError } from '@/lib/errors';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (_request, context) => {
  const { param } = await context.params;

  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isUuid = UUID_RE.test(param);

  const event = await prisma.event.findFirst({
    where: isUuid
      ? { OR: [{ id: param }, { slug: param }] }
      : { slug: param },
    select: { recordingUrl: true, status: true },
  });

  if (!event?.recordingUrl) throw new NotFoundError('Recording');
  if (event.status !== 'ENDED' && event.status !== 'ARCHIVED') {
    throw new ForbiddenError('Recording not yet available');
  }

  return Response.redirect(event.recordingUrl, 302);
});
