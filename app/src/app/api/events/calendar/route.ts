import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { resolveLocale, getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { getSettings } from '@/lib/settings';
import { eventScope, getStaffSession } from '@/lib/auth/staff-session';
import { isEventPageVisible, publicEventStatusWhere } from '@/lib/events/visibility';
import { resolveKickerEnabled, splitTitleKicker } from '@/lib/utils/title-kicker';
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

  // Vista dell'area di amministrazione: tutti gli eventi per l'admin, i
  // propri per l'organizzatore (ADR-014).
  const staff = mode === 'admin' ? await getStaffSession(await cookies()) : null;

  const settings = await getSettings();
  // Senza sessione dello staff vale la regola del calendario pubblico,
  // qualunque `mode` si chieda.
  if (!staff && !settings.calendarPublic) {
    return Response.json([]);
  }

  // Pubblico: stessa regola di visibilità di listing/home/sitemap — un
  // evento in pre-warm (PROVISIONING/IDLE, ~30' prima dell'inizio) non deve
  // sparire dal calendario proprio quando i visitatori lo cercano.
  const where = staff
    ? {
        ...eventScope(staff),
        startsAt: Object.keys(dateFilter).length ? dateFilter : undefined,
      }
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
      parseTitleKicker: true,
      postEventPublic: true,
      postEventPublicUntil: true,
      // Le etichette nell'ordine delle impostazioni: la prima ne da' il
      // colore nel calendario pubblico.
      tagLinks: {
        orderBy: [{ tag: { sortOrder: 'asc' } }, { tag: { slug: 'asc' } }],
        select: { tag: { select: { slug: true, name: true, color: true } } },
      },
      _count: { select: { registrations: true } },
    },
    orderBy: { startsAt: 'asc' },
  });

  const result = events.map((event) => {
    const title = getLocalized(event.title as LocalizedField, locale);
    // Il sopratitolo come sulla pagina: acceso per l'evento o dal sito.
    const { kicker, main } = splitTitleKicker(
      title,
      resolveKickerEnabled(event, settings.parseTitleKicker),
    );
    return {
      id: event.id,
      slug: event.slug,
      title: main,
      kicker,
      // Per lo staff: se la pagina pubblica si apre, con la regola della pagina.
      ...(staff ? { hasPublicPage: isEventPageVisible(event) } : {}),
      tags: event.tagLinks.map(({ tag }) => ({
        slug: tag.slug,
        name: getLocalized(tag.name as LocalizedField, locale) || tag.slug,
        color: tag.color,
      })),
      start: event.startsAt.toISOString(),
      end: event.endsAt.toISOString(),
      status: event.status,
      eventType: event.eventType,
      // Quanti si sono iscritti lo vede solo lo staff.
      ...(staff ? { registrationCount: event._count.registrations } : {}),
    };
  });

  // Il calendario dello staff (bozze comprese) non va in nessuna cache
  // condivisa: l'indirizzo e' lo stesso per tutti, la risposta no.
  return Response.json(result, {
    headers: {
      'Cache-Control':
        mode === 'public'
          ? 'public, s-maxage=30, stale-while-revalidate=60'
          : 'private, no-store',
    },
  });
});
