import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { resolveLocale, getLocalized, type LocalizedField } from '@/lib/utils/locale';

export const dynamic = 'force-dynamic';

// ── GET /api/events/[slug]/registrations/[accessToken] ───────

export const GET = withErrorHandling(async (request, context) => {
  const { param: slug, accessToken } = await context.params;
  const locale = resolveLocale(request);

  const registration = await prisma.registration.findUnique({
    where: { accessToken },
    include: { event: { select: { slug: true, title: true, status: true } } },
  });

  if (!registration || registration.event.slug !== slug) {
    throw new NotFoundError('Registration');
  }

  return Response.json({
    id: registration.id,
    displayName: registration.displayName,
    eventSlug: registration.event.slug,
    eventTitle: getLocalized(registration.event.title as LocalizedField, locale),
    eventStatus: registration.event.status,
    joinedAt: registration.joinedAt?.toISOString() ?? null,
  });
});
