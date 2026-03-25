import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/db';
import AdminDashboardClient from '@/components/admin/admin-dashboard-client';
import AdminLogoutButton from '@/components/admin/admin-logout-button';

interface AdminPageProps {
  searchParams: Promise<{ token?: string }>;
}

async function loadEvents(token?: string) {
  const where = token ? { moderatorToken: token } : {};
  const events = await prisma.event.findMany({
    where,
    include: { _count: { select: { registrations: true } } },
    orderBy: { startsAt: 'asc' },
  });

  return events.map((e) => ({
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
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const { token } = await searchParams;
  const t = await getTranslations('admin');
  const events = await loadEvents(token);
  const showLogout = !token;

  return (
    <div className="container py-5">
      {/* ── Header ── */}
      <div className="d-flex justify-content-between align-items-start mb-5 flex-wrap gap-3">
        <div>
          <h1 className="mb-1 fw-bold" style={{ color: '#17324D' }}>
            {t('title')}
          </h1>
          <p className="text-secondary mb-0">{t('subtitle')}</p>
        </div>
        <div className="d-flex gap-2 align-items-center flex-shrink-0">
          <Link
            href="/it/admin/eventi/nuovo"
            className="btn btn-primary d-inline-flex align-items-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 2a1 1 0 0 1 1 1v4h4a1 1 0 1 1 0 2H9v4a1 1 0 1 1-2 0V9H3a1 1 0 0 1 0-2h4V3a1 1 0 0 1 1-1z" />
            </svg>
            {t('createEvent')}
          </Link>
          {showLogout && <AdminLogoutButton />}
        </div>
      </div>

      {/* ── Event grid or empty state ── */}
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
            <svg width="28" height="28" viewBox="0 0 24 24" fill="#0066CC">
              <path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z" />
            </svg>
          </div>
          <p className="lead text-muted mb-3">{t('noEvents')}</p>
          <Link
            href="/it/admin/eventi/nuovo"
            className="btn btn-primary btn-lg"
          >
            {t('createEvent')}
          </Link>
        </div>
      ) : (
        <AdminDashboardClient events={events} token={token} />
      )}
    </div>
  );
}
