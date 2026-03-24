import { getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { Link } from '@/i18n/navigation';
import AdminDashboardClient from '@/components/admin/admin-dashboard-client';
import AdminLogoutButton from '@/components/admin/admin-logout-button';

interface AdminPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const { token } = await searchParams;
  const t = await getTranslations('admin');

  if (!token) {
    const events = await prisma.event.findMany({
      include: { _count: { select: { registrations: true } } },
      orderBy: { startsAt: 'asc' },
    });

    const serialized = events.map((e) => ({
      id: e.id,
      titleIt: e.titleIt,
      titleEn: e.titleEn,
      slug: e.slug,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      status: e.status,
      registrationCount: e._count.registrations,
      maxParticipants: e.maxParticipants,
      moderatorToken: e.moderatorToken,
    }));

    return (
      <div className="container py-5">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <h1>{t('title')}</h1>
          <div className="d-flex gap-2 align-items-center">
            <Link
              href="/admin/eventi/nuovo"
              className="btn btn-primary"
            >
              {t('createEvent')}
            </Link>
            <AdminLogoutButton />
          </div>
        </div>

        {events.length === 0 ? (
          <div className="text-center py-5">
            <p className="lead text-muted">{t('noEvents')}</p>
            <Link
              href="/admin/eventi/nuovo"
              className="btn btn-primary btn-lg mt-3"
            >
              {t('createEvent')}
            </Link>
          </div>
        ) : (
          <AdminDashboardClient events={serialized} />
        )}
      </div>
    );
  }

  const events = await prisma.event.findMany({
    where: { moderatorToken: token },
    include: { _count: { select: { registrations: true } } },
    orderBy: { startsAt: 'asc' },
  });

  const serialized = events.map((e) => ({
    id: e.id,
    titleIt: e.titleIt,
    titleEn: e.titleEn,
    slug: e.slug,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    status: e.status,
    registrationCount: e._count.registrations,
    maxParticipants: e.maxParticipants,
    moderatorToken: e.moderatorToken,
  }));

  return (
    <div className="container py-5">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1>{t('title')}</h1>
        <Link
          href="/admin/eventi/nuovo"
          className="btn btn-primary"
        >
          {t('createEvent')}
        </Link>
      </div>

      {events.length === 0 ? (
        <div className="text-center py-5">
          <p className="lead text-muted">{t('noEvents')}</p>
          <Link
            href="/admin/eventi/nuovo"
            className="btn btn-primary btn-lg mt-3"
          >
            {t('createEvent')}
          </Link>
        </div>
      ) : (
        <AdminDashboardClient events={serialized} token={token} />
      )}
    </div>
  );
}
