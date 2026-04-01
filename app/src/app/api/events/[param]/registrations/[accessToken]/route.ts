import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ── GET /api/events/[slug]/registrations/[accessToken] ───────

export const GET = withErrorHandling(async (_request, context) => {
  const { param: slug, accessToken } = await context.params;

  const registration = await prisma.registration.findUnique({
    where: { accessToken },
    include: { event: { select: { slug: true, titleIt: true, titleEn: true, status: true } } },
  });

  if (!registration || registration.event.slug !== slug) {
    throw new NotFoundError('Registration');
  }

  return Response.json({
    id: registration.id,
    displayName: registration.displayName,
    eventSlug: registration.event.slug,
    eventTitle: registration.event.titleIt,
    eventTitleEn: registration.event.titleEn,
    eventStatus: registration.event.status,
    joinedAt: registration.joinedAt?.toISOString() ?? null,
  });
});
