import { getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { Link } from '@/i18n/navigation';
import AdminDashboardClient from '@/components/admin/admin-dashboard-client';
import AdminLogoutButton from '@/components/admin/admin-logout-button';

interface EventsListPageProps {
  searchParams: Promise<{ token?: string }>;
}

async function loadEvents(token?: string) {
  const where = token ? { moderatorToken: token } : {};
  const events = await prisma.event.findMany({
    where,
    include: {
      _count: {
        select: {
          registrations: true,
          additionalMods: true,
          organizers: true,
        },
      },
      tagLinks: { include: { tag: true } },
    },
    orderBy: { startsAt: 'asc' },
  });

  return events.map((e) => ({
    id: e.id,
    title: e.title as Record<string, string>,
    slug: e.slug,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    createdAt: e.createdAt.toISOString(),
    status: e.status,
    eventType: e.eventType,
    registrationCount: e._count.registrations,
    maxParticipants: e.maxParticipants,
    peakParticipants: e.peakParticipants,
    moderatorToken: e.moderatorToken,
    coverImageUrl: e.coverImageUrl,
    imageUrl: e.imageUrl,
    organizerName: e.organizerName,
    parseTitleKicker: e.parseTitleKicker,
    moderatorCount: e._count.additionalMods,
    organizerCount: e._count.organizers,
    tags: e.tagLinks.map((link) => ({
      slug: link.tag.slug,
      name: link.tag.name as Record<string, string>,
      color: link.tag.color,
    })),
  }));
}

async function loadAvailableTags() {
  const tags = await prisma.tag.findMany({
    orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
  });
  return tags.map((t) => ({
    slug: t.slug,
    name: t.name as Record<string, string>,
    color: t.color,
  }));
}

export default async function EventsListPage({
  searchParams,
}: EventsListPageProps) {
  const { token } = await searchParams;
  const t = await getTranslations('admin');
  const [events, availableTags, settings] = await Promise.all([
    loadEvents(token),
    loadAvailableTags(),
    getSettings(),
  ]);
  const showLogout = !token;

  return (
    <div className="container py-5">
      <div className="d-flex justify-content-between align-items-start mb-5 flex-wrap gap-3">
        <div>
          <h1 className="mb-1 fw-bold" style={{ color: '#17324D' }}>
            {t('title')}
          </h1>
          <p className="text-secondary mb-0">{t('subtitle')}</p>
        </div>
        <div className="d-flex gap-2 align-items-center flex-shrink-0">
          <Link
            href="/admin/events/new"
            className="btn btn-primary d-inline-flex align-items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            {t('createEvent')}
          </Link>
          {showLogout && <AdminLogoutButton />}
        </div>
      </div>

      {events.length === 0 ? (
        <div
          className="text-center py-5 px-4 rounded-3"
          style={{ backgroundColor: '#F5F7FB' }}
        >
          <div
            className="mx-auto mb-3 d-flex align-items-center justify-content-center rounded-circle"
            style={{
              width: 64,
              height: 64,
              backgroundColor: 'rgba(0,102,204,0.1)',
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0066CC" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <p className="lead text-muted mb-3">{t('noEvents')}</p>
          <Link
            href="/admin/events/new"
            className="btn btn-primary btn-lg"
          >
            {t('createEvent')}
          </Link>
        </div>
      ) : (
        <AdminDashboardClient
          events={events}
          token={token}
          availableTags={availableTags}
          siteDefaultParseTitleKicker={settings.parseTitleKicker}
        />
      )}
    </div>
  );
}
