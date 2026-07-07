import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { resolveLocale, getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { getSettings } from '@/lib/settings';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { publicEventStatusWhere } from '@/lib/events/visibility';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

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

  // Pubblico: stessa regola di visibilità di listing/home/sitemap — un
  // evento in pre-warm (PROVISIONING/IDLE, ~30' prima dell'inizio) non deve
  // sparire dal calendario proprio quando i visitatori lo cercano.
  const where = isAdmin
    ? { startsAt: Object.keys(dateFilter).length ? dateFilter : undefined }
    : {
        ...publicEventStatusWhere({ includeEnded: false }),
        startsAt: Object.keys(dateFilter).length ? dateFilter : undefined,
      };

  const events = await prisma.event.findMany({
    where,
    select: {
      id: true,
      slug: true,
      title: true,
      startsAt: true,
      endsAt: true,
      status: true,
      eventType: true,
      _count: { select: { registrations: true } },
    },
    orderBy: { startsAt: 'asc' },
  });

  const result = events.map((event) => {
    const title = getLocalized(event.title as LocalizedField, locale);
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
