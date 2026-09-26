import { NextResponse } from 'next/server';

import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { generateEventICal } from '@/lib/ical/generate';
import { getSettings } from '@/lib/settings';
import { resolveLocale, localiseEvent } from '@/lib/utils/locale';
import { getPublicEnv } from '@/lib/env';
import { localizedUrl } from '@/lib/utils/localized-url';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const event = await prisma.event.findUnique({ where: { slug } });

  if (!event || event.status === 'DRAFT') {
    throw new NotFoundError('Event');
  }

  const locale = resolveLocale(request);
  const { title, description } = localiseEvent(event, locale);
  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');
  const eventUrl = localizedUrl(baseUrl, `/events/${slug}`, locale);

  const settings = await getSettings();

  // Stesso UID degli allegati email: chi ha gia' importato la conferma non si
  // ritrova una seconda voce. L'ORGANIZER e' l'indirizzo di piattaforma, mai
  // l'email personale del moderatore (vedi calendarOrganizerEmail).
  const ics = generateEventICal({
    eventId: event.id,
    updatedAt: event.updatedAt,
    title,
    description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    url: eventUrl,
    organizerName: event.moderatorName ?? (settings.siteName || 'PA Webinar'),
  });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="evento-${slug}.ics"`,
      'Cache-Control': 'public, max-age=3600',
    },
  });
});
