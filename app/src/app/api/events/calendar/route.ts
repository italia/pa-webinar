import type { EventStatus } from '@prisma/client';

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { resolveLocale } from '@/lib/utils/locale';
import { getSettings } from '@/lib/settings';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

const PUBLIC_STATUSES: EventStatus[] = ['PUBLISHED', 'LIVE'];

export const GET = withErrorHandling(async (request) => {
  const url = new URL(request.url);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const mode = url.searchParams.get('mode') ?? 'public';
  const locale = resolveLocale(request);

  const dateFilter: Record<string, Date> = {};
  if (start) dateFilter.gte = new Date(start);
  if (end) dateFilter.lte = new Date(end);

  const isAdmin =
    mode === 'admin' &&
    (await isAdminAuthenticated(await cookies()));

  if (mode === 'public') {
    const settings = await getSettings();
    if (!settings.calendarPublic) {
      return Response.json([]);
    }
  }

  const where = isAdmin
    ? { startsAt: Object.keys(dateFilter).length ? dateFilter : undefined }
    : {
        status: { in: PUBLIC_STATUSES },
        startsAt: Object.keys(dateFilter).length ? dateFilter : undefined,
      };

  const events = await prisma.event.findMany({
    where,
    select: {
      id: true,
      slug: true,
      titleIt: true,
      titleEn: true,
      startsAt: true,
      endsAt: true,
      status: true,
      eventType: true,
      _count: { select: { registrations: true } },
    },
    orderBy: { startsAt: 'asc' },
  });

  const result = events.map((event) => {
    const title =
      locale === 'en' && event.titleEn ? event.titleEn : event.titleIt;
    return {
      id: event.id,
      slug: event.slug,
      title,
      start: event.startsAt.toISOString(),
      end: event.endsAt.toISOString(),
      status: event.status,
      eventType: event.eventType,
      registrationCount: event._count.registrations,
    };
  });

  return Response.json(result, {
    headers: {
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
    },
  });
});
